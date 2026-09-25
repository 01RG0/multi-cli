package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/01rg0/orchestrator/internal/agent"
	"github.com/01rg0/orchestrator/internal/config"
	"github.com/01rg0/orchestrator/internal/db"
	"github.com/01rg0/orchestrator/internal/memory"
	"github.com/01rg0/orchestrator/internal/provider"
	"github.com/01rg0/orchestrator/internal/queue"
	"github.com/01rg0/orchestrator/internal/server"
)

func main() {
	loadDotEnv()

	serve := false
	cfgPath := "config.yaml"
	for _, arg := range os.Args[1:] {
		switch arg {
		case "--serve", "-serve", "serve":
			serve = true
		default:
			cfgPath = arg
		}
	}

	cfg, err := config.Load(cfgPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	// Open SQLite database (shared by queue and memory graph).
	database, err := db.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer database.Close()

	// Migrate queue schema.
	if err := db.Migrate(database); err != nil {
		log.Fatalf("db migrate: %v", err)
	}

	// Migrate memory schema and construct the graph.
	if err := memory.Migrate(database); err != nil {
		log.Fatalf("memory migrate: %v", err)
	}
	g := memory.New(database)

	providerMap := buildProviders(cfg)

	if len(cfg.FallbackChain) == 0 {
		log.Fatal("fallback_chain is empty")
	}
	primary := providerMap[cfg.FallbackChain[0]]
	if primary == nil {
		log.Fatalf("primary provider %q not found in config", cfg.FallbackChain[0])
	}
	var fallbacks []provider.Provider
	for _, name := range cfg.FallbackChain[1:] {
		if p := providerMap[name]; p != nil {
			fallbacks = append(fallbacks, p)
		}
	}
	router := provider.NewRouter(primary, fallbacks, cfg.MaxRetries, cfg.CooldownSeconds)

	if serve || cfg.ProxyPort > 0 {
		srv := server.New(router, cfg, g)
		fmt.Printf("Proxy listening on :%d (chain: %v)\n", cfg.ProxyPort, cfg.FallbackChain)
		fmt.Printf("Set ANTHROPIC_BASE_URL=http://localhost:%d to route Claude Code through this proxy.\n", cfg.ProxyPort)

		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		// Build the known CLI agent map.
		agentNames := []string{
			"opencode", "codex", "vibe", "agy", "grok",
			"kilo", "cline", "researcher", "debugger", "jules", "cursor",
		}
		agents := make(map[string]*agent.CLIAgent, len(agentNames))
		for _, name := range agentNames {
			agents[name] = agent.New(name, name, 5*time.Minute)
		}

		// Worker handler: pick agent, run prompt, write episode.
		handler := func(hctx context.Context, task queue.Task) (string, error) {
			agentKey := task.Type
			if agentKey == "" {
				agentKey = task.AgentID
			}
			a, ok := agents[agentKey]
			if !ok {
				a = agents["opencode"]
			}

			result, runErr := a.Run(hctx, task.Prompt)

			// Log episode regardless of success or failure.
			epAgentID := task.AgentID
			if epAgentID == "" {
				epAgentID = task.Type
			}
			var epContent string
			if runErr != nil {
				epContent = runErr.Error()
			} else {
				epContent = result
			}
			if _, epErr := g.AppendEpisode(context.Background(), memory.Episode{
				AgentID: epAgentID,
				Kind:    "task",
				Content: epContent,
			}); epErr != nil {
				log.Printf("memory: task episode: %v", epErr)
			}

			return result, runErr
		}

		// Wire queue and worker pool.
		q := queue.New(database)
		concurrency := cfg.Concurrency
		if concurrency <= 0 {
			concurrency = 4
		}
		wp := queue.NewWorkerPool(concurrency, q, handler)
		go wp.Start(ctx)

		quit := make(chan os.Signal, 1)
		signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

		go func() {
			if err := srv.Start(); err != nil {
				log.Printf("server stopped: %v", err)
			}
		}()

		<-quit
		fmt.Println("\nShutting down...")
		cancel()
		srv.Shutdown(context.Background())
		return
	}

	// One-shot test prompt
	req := provider.ChatRequest{
		Messages:  []provider.Message{{Role: "user", Content: "Reply with exactly: OK"}},
		MaxTokens: 16,
	}
	fmt.Printf("Sending test prompt via router (primary: %s, fallbacks: %d)...\n", primary.Name(), len(fallbacks))
	resp, err := router.Complete(context.Background(), req)
	if err != nil {
		log.Fatalf("complete: %v", err)
	}
	fmt.Printf("Response: %q\n", resp.Content)
	fmt.Printf("Finish reason: %s\n", resp.FinishReason)
	fmt.Printf("Tokens: in=%d out=%d\n", resp.Usage.InputTokens, resp.Usage.OutputTokens)
}

func buildProviders(cfg *config.Config) map[string]provider.Provider {
	m := make(map[string]provider.Provider)
	for _, pc := range cfg.Providers {
		switch pc.Type {
		case "anthropic":
			if pc.APIKey != "" {
				m[pc.Name] = provider.NewAnthropic(pc.Name, pc.BaseURL, pc.APIKey, pc.Model)
			}
		case "openai_compat":
			m[pc.Name] = provider.NewOpenAI(pc.Name, pc.BaseURL, pc.APIKey, pc.Model)
		case "bedrock":
			if pc.AccessKey != "" && pc.SecretKey != "" {
				m[pc.Name] = provider.NewBedrock(pc.Name, pc.Region, pc.Model, pc.AccessKey, pc.SecretKey)
			}
		default:
			log.Printf("unknown provider type %q for %s — skipping", pc.Type, pc.Name)
		}
	}
	return m
}

func loadDotEnv() {
	cwd, _ := os.Getwd()
	var paths []string
	dir := cwd
	for i := 0; i < 5; i++ {
		paths = append(paths, filepath.Join(dir, ".env"))
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		for _, line := range splitLines(string(data)) {
			line = trimComment(line)
			if line == "" || line[0] == '#' {
				continue
			}
			idx := indexByte(line, '=')
			if idx < 0 {
				continue
			}
			key, val := line[:idx], line[idx+1:]
			if os.Getenv(key) == "" {
				_ = os.Setenv(key, val)
			}
		}
		break
	}
}

func splitLines(s string) []string {
	var lines []string
	start := 0
	for i, c := range s {
		if c == '\n' {
			lines = append(lines, s[start:i])
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}

func trimComment(s string) string {
	for i, c := range s {
		if c == '#' {
			return s[:i]
		}
	}
	return s
}

func indexByte(s string, b byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return i
		}
	}
	return -1
}
