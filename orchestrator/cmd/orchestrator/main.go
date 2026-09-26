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
	"github.com/01rg0/orchestrator/internal/improvement"
	"github.com/01rg0/orchestrator/internal/logbuf"
	"github.com/01rg0/orchestrator/internal/mcp"
	"github.com/01rg0/orchestrator/internal/memory"
	"github.com/01rg0/orchestrator/internal/provider"
	"github.com/01rg0/orchestrator/internal/queue"
	"github.com/01rg0/orchestrator/internal/server"
	"github.com/01rg0/orchestrator/internal/skills"
)

func main() {
	loadDotEnv()

	serve := false
	workers := false
	cfgPath := "config.yaml"
	for _, arg := range os.Args[1:] {
		switch arg {
		case "--serve", "-serve", "serve":
			serve = true
		case "--workers", "-workers", "workers":
			workers = true
		default:
			cfgPath = arg
		}
	}

	cfg, err := config.Load(cfgPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	if workers {
		cfg.EnableWorkers = true
	}

	// Open SQLite database (shared by queue, memory graph, and Ultron routes).
	database, err := db.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer database.Close()

	if err := db.Migrate(database); err != nil {
		log.Fatalf("db migrate: %v", err)
	}
	if err := memory.Migrate(database); err != nil {
		log.Fatalf("memory migrate: %v", err)
	}
	if err := skills.Migrate(database); err != nil {
		log.Fatalf("skills migrate: %v", err)
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
		srv.SetProviderMap(providerMap)

		lb := logbuf.New(1000)
		srv.SetLogBuffer(lb)

		ctx, cancel := context.WithCancel(context.Background())

		// Build CLI agent map — all known agents registered; config.yaml cli_agents
		// entries override the binary path with an absolute path when provided.
		agentNames := []string{
			"opencode", "codex", "vibe", "agy", "grok",
			"kilo", "kilocode", "cline", "researcher", "debugger", "jules", "cursor",
			"hermes", "deepseek", "harness", "pi",
		}
		// Build binary overrides from config.yaml cli_agents
		binaryOverrides := make(map[string]string, len(cfg.CLIAgents))
		for _, ac := range cfg.CLIAgents {
			if ac.Command != "" {
				binaryOverrides[ac.Name] = ac.Command
			}
		}
		agents := make(map[string]*agent.CLIAgent, len(agentNames))
		for _, name := range agentNames {
			binary := name // default: look up by name in PATH
			if override, ok := binaryOverrides[name]; ok {
				binary = override
			}
			agents[name] = agent.New(name, binary, 5*time.Minute)
		}

		obs := improvement.NewObserver(200)
		ref := improvement.NewReflector(3)
		loop := improvement.NewLoop(obs, ref, 30*time.Second)

		q := queue.New(database)
		srv.SetQueue(q)
		srv.RegisterUltronRoutes(database, g, q)

		// Start MCP servers (soft failure — errors are logged, not fatal).
		if len(cfg.MCPServers) > 0 {
			mcpCfgs := make([]mcp.ServerConfig, len(cfg.MCPServers))
			for i, sc := range cfg.MCPServers {
				mcpCfgs[i] = mcp.ServerConfig{
					Name:    sc.Name,
					Command: sc.Command,
					Args:    sc.Args,
					Env:     sc.Env,
					BaseURL: sc.BaseURL,
				}
			}
			mgr := mcp.NewManager(mcpCfgs, ctx)
			srv.SetMCPManager(mgr)
			defer mgr.StopAll()
		}

		if cfg.EnableWorkers {
			handler := func(hctx context.Context, task queue.Task) (string, error) {
				agentKey := task.AgentID
				if agentKey == "" {
					agentKey = task.Type
				}
				a, ok := agents[agentKey]
				if !ok {
					a = agents["opencode"]
				}

				srv.Hub.Broadcast(map[string]any{
					"type": "task_update",
					"task": map[string]any{
						"id":      task.ID,
						"status":  string(queue.StatusRunning),
						"agentId": task.AgentID,
					},
				})
				srv.Hub.Broadcast(map[string]any{
					"type": "agent_update",
					"agent": map[string]any{
						"id":            task.AgentID,
						"status":        "running",
						"currentTaskId": task.ID,
					},
				})

				onLine := func(agentID, taskID, stream, line string) {
					ts := time.Now().UnixMilli()
					lb.Append(logbuf.LogEntry{
						AgentID: agentID,
						TaskID:  taskID,
						Stream:  stream,
						Line:    line,
						TS:      ts,
					})
					srv.Hub.Broadcast(map[string]any{
						"type":     "log",
						"agent_id": agentID,
						"task_id":  taskID,
						"stream":   stream,
						"line":     line,
						"ts":       ts,
					})
				}

				result, runErr := a.RunStreaming(hctx, task.ID, task.Prompt, onLine)
				latencyMs := time.Now().UnixMilli() - task.StartedAt

				if runErr != nil {
					obs.Record(improvement.Observation{
						AgentID:   task.AgentID,
						TaskID:    task.ID,
						Prompt:    task.Prompt,
						Error:     runErr.Error(),
						LatencyMs: latencyMs,
					})
					srv.Hub.Broadcast(map[string]any{
						"type": "task_update",
						"task": map[string]any{
							"id":     task.ID,
							"status": string(queue.StatusFailed),
							"error":  runErr.Error(),
						},
					})
					srv.Hub.Broadcast(map[string]any{
						"type": "agent_update",
						"agent": map[string]any{
							"id":            task.AgentID,
							"status":        "idle",
							"currentTaskId": "",
						},
					})
					return "", runErr
				}

				obs.Record(improvement.Observation{
					AgentID:   task.AgentID,
					TaskID:    task.ID,
					Prompt:    task.Prompt,
					Result:    result,
					LatencyMs: latencyMs,
				})

				go func() {
					if _, epErr := g.AppendEpisode(context.Background(), memory.Episode{
						AgentID: task.AgentID,
						Kind:    "task",
						Content: result,
					}); epErr != nil {
						log.Printf("memory: task episode: %v", epErr)
					}
				}()

				srv.Hub.Broadcast(map[string]any{
					"type": "task_update",
					"task": map[string]any{
						"id":     task.ID,
						"status": string(queue.StatusCompleted),
					},
				})
				srv.Hub.Broadcast(map[string]any{
					"type": "agent_update",
					"agent": map[string]any{
						"id":            task.AgentID,
						"status":        "idle",
						"currentTaskId": "",
					},
				})
				return result, nil
			}

			concurrency := cfg.Concurrency
			if concurrency <= 0 {
				concurrency = 4
			}
			wp := queue.NewWorkerPool(concurrency, q, handler)
			go wp.Start(ctx)
			go loop.Start(ctx)
			log.Printf("workers: %d goroutines draining queue (db=%s)", concurrency, cfg.DBPath)
		}

		go runCronRunner(ctx, database, q, srv)

		fmt.Printf("Proxy listening on :%d (chain: %v)\n", cfg.ProxyPort, cfg.FallbackChain)
		fmt.Printf("Set ANTHROPIC_BASE_URL=http://localhost:%d to route Claude Code through this proxy.\n", cfg.ProxyPort)
		fmt.Printf("Per-agent routing: ANTHROPIC_BASE_URL=http://localhost:%d/agent/<name>\n", cfg.ProxyPort)

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
