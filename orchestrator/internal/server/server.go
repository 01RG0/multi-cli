package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/01rg0/orchestrator/internal/config"
	"github.com/01rg0/orchestrator/internal/hub"
	"github.com/01rg0/orchestrator/internal/logbuf"
	"github.com/01rg0/orchestrator/internal/mcp"
	"github.com/01rg0/orchestrator/internal/memory"
	"github.com/01rg0/orchestrator/internal/provider"
	"github.com/01rg0/orchestrator/internal/queue"
)

// Server handles HTTP and WebSocket traffic for the orchestrator.
type Server struct {
	router      *provider.Router
	cfg         *config.Config
	httpServer  *http.Server
	Hub         *hub.Hub
	q           *queue.Queue // optional; nil when workers are disabled
	graph       *memory.Graph
	db          *sql.DB
	providerMap map[string]provider.Provider
	mcpManager  *mcp.Manager // optional; nil when no MCP servers configured
	logBuf      *logbuf.LogBuffer
	uploadDir   string
}

// New creates a Server. g may be nil when memory is not needed (e.g. in tests).
func New(router *provider.Router, cfg *config.Config, g *memory.Graph) *Server {
	h := hub.New()
	go h.Run()
	return &Server{router: router, cfg: cfg, Hub: h, graph: g}
}

// SetLogBuffer attaches a log buffer to the server, enabling GET /api/logs.
// Must be called before Start().
func (s *Server) SetLogBuffer(lb *logbuf.LogBuffer) {
	s.logBuf = lb
}

// SetQueue attaches a live queue to the server, enabling /api/tasks and
// /api/tasks/enqueue, and wiring an init-snapshot on every WS connect.
// Must be called before Start().
// SetQueue attaches a live queue, enabling /api/tasks endpoints and wiring an
// init-snapshot on every WS connect. Must be called before Start().
func (s *Server) SetQueue(q *queue.Queue) {
	s.q = q
	s.Hub.OnConnect = func() []byte {
		stats, err := q.Stats(context.Background())
		if err != nil {
			return nil
		}
		b, _ := json.Marshal(map[string]any{
			"type": "stats",
			"stats": map[string]any{
				"runningCount": stats[string(queue.StatusRunning)],
				"pendingCount": stats[string(queue.StatusPending)],
				"tasksToday":   stats[string(queue.StatusCompleted)] + stats[string(queue.StatusFailed)],
			},
		})
		return b
	}
}

// RegisterUltronRoutes stores the database connection and enables the full
// Ultron API surface. Must be called before Start().
func (s *Server) RegisterUltronRoutes(db *sql.DB, graph *memory.Graph, q *queue.Queue) {
	s.db = db
	if graph != nil {
		s.graph = graph
	}
	if q != nil {
		s.q = q
	}
}

// SetProviderMap stores the provider map for per-agent routing.
func (s *Server) SetProviderMap(m map[string]provider.Provider) {
	s.providerMap = m
}

// SetMCPManager attaches an MCP manager, enabling MCP API routes.
// Must be called before Start().
func (s *Server) SetMCPManager(m *mcp.Manager) {
	s.mcpManager = m
}

// buildAgentRouter returns a per-agent router if AgentProviders is configured,
// falling back to the global router.
func (s *Server) buildAgentRouter(agentID string) *provider.Router {
	if s.providerMap == nil || s.cfg.AgentProviders == nil {
		return s.router
	}
	chain, ok := s.cfg.AgentProviders[agentID]
	if !ok || len(chain) == 0 {
		// Try "default" key
		chain = s.cfg.AgentProviders["default"]
	}
	if len(chain) == 0 {
		return s.router
	}
	var providers []provider.Provider
	for _, name := range chain {
		if p, ok := s.providerMap[name]; ok {
			providers = append(providers, p)
		}
	}
	if len(providers) == 0 {
		return s.router
	}
	primary := providers[0]
	var fallbacks []provider.Provider
	if len(providers) > 1 {
		fallbacks = providers[1:]
	}
	return provider.NewRouter(primary, fallbacks, s.cfg.MaxRetries, s.cfg.CooldownSeconds)
}

// ServeMessages is the exported handler for testing.
func (s *Server) ServeMessages(w http.ResponseWriter, r *http.Request) {
	s.handleMessages(w, r)
}

// ServeHealth is the exported handler for testing.
func (s *Server) ServeHealth(w http.ResponseWriter, r *http.Request) {
	s.handleHealth(w, r)
}

// ServeLogs is the exported handler for testing.
func (s *Server) ServeLogs(w http.ResponseWriter, r *http.Request) {
	s.handleAPILogs(w, r)
}

// Handler returns the configured http.Handler with all registered routes.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/messages", s.handleMessages)
	mux.HandleFunc("/messages", s.handleMessages) // SDK compat
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/ws", s.Hub.ServeWS)
	mux.HandleFunc("/api/logs", s.handleAPILogs)

	// File uploads & static serving
	mux.HandleFunc("/api/upload", s.handleUpload)
	uploadDir := s.getUploadDir()
	_ = os.MkdirAll(uploadDir, 0755)
	fileServer := http.StripPrefix("/uploads/", http.FileServer(http.Dir(uploadDir)))
	mux.HandleFunc("/uploads/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		fileServer.ServeHTTP(w, r)
	})

	// Per-agent provider routing: /agent/{agentId}/v1/messages
	mux.HandleFunc("/agent/", s.handleAgentProxy)

	if s.q != nil {
		mux.HandleFunc("/api/tasks", s.handleAPITasks)
		mux.HandleFunc("/api/tasks/enqueue", s.handleAPIEnqueue)
	}

	// Ultron API routes — enabled when db is wired via RegisterUltronRoutes.
	if s.db != nil {
		// Memory
		mux.HandleFunc("/api/memory/search", s.handleMemorySearch)
		mux.HandleFunc("/api/memory/upsert", s.handleMemoryUpsert)
		mux.HandleFunc("/api/memory/graph", s.handleMemoryGraph)
		mux.HandleFunc("/api/memory/nodes/{id}", s.handleMemoryNodeDelete)
		mux.HandleFunc("/api/memory/edges", s.handleMemoryEdgeAdd)
		mux.HandleFunc("/api/memory/core", s.handleMemoryCore)
		mux.HandleFunc("/api/memory/episodes", s.handleMemoryEpisodes)

		// Task control (additional routes beyond /api/tasks)
		mux.HandleFunc("/api/tasks/{id}/cancel", s.handleTaskCancel)
		mux.HandleFunc("/api/tasks/{id}/retry", s.handleTaskRetry)

		// Agent status and provider chains
		mux.HandleFunc("/api/agents/status", s.handleAgentStatus)
		mux.HandleFunc("/api/agents/fallbacks", s.handleAgentFallbacks)
		mux.HandleFunc("/api/agents/provider-chains", s.handleAgentProviderChains)

		// Cron scheduling
		mux.HandleFunc("/api/cron/schedule", s.handleCronSchedule)
		mux.HandleFunc("/api/cron/jobs", s.handleCronJobs)
		mux.HandleFunc("/api/cron/jobs/{id}", s.handleCronJobByID)

		// Routing rules
		mux.HandleFunc("/api/routing/rules", s.handleRoutingRules)
		mux.HandleFunc("/api/routing/rules/{id}", s.handleRoutingRuleByID)

		// Feedback
		mux.HandleFunc("/api/feedback", s.handleFeedback)

		// Skills
		mux.HandleFunc("/api/skills", s.handleSkills)
		mux.HandleFunc("/api/skills/{id}", s.handleSkillByID)
		mux.HandleFunc("/api/skills/{id}/run", s.handleSkillRun)

		// MCP
		mux.HandleFunc("/api/mcp/servers", s.handleMCPServers)
		mux.HandleFunc("/api/mcp/servers/{name}/tools", s.handleMCPServerTools)
		mux.HandleFunc("/api/mcp/call", s.handleMCPCall)
	}

	mux.HandleFunc("/api/providers", s.handleProviderHealth)

	// Serve React frontend — SPA fallback: unknown paths → index.html
	distDir := "frontend/dist"
	fs := http.FileServer(http.Dir(distDir))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Let the file server try first; if the file doesn't exist serve index.html
		path := distDir + r.URL.Path
		if _, err := os.Stat(path); os.IsNotExist(err) {
			http.ServeFile(w, r, distDir+"/index.html")
			return
		}
		fs.ServeHTTP(w, r)
	})

	return mux
}

func (s *Server) Start() error {
	addr := fmt.Sprintf(":%d", s.cfg.ProxyPort)
	s.httpServer = &http.Server{
		Addr:         addr,
		Handler:      s.Handler(),
		ReadTimeout:  120 * time.Second,
		WriteTimeout: 180 * time.Second,
		IdleTimeout:  60 * time.Second,
	}
	return s.httpServer.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	if s.httpServer == nil {
		return nil
	}
	return s.httpServer.Shutdown(ctx)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":    "ok",
		"providers": len(s.cfg.FallbackChain),
		"chain":     s.cfg.FallbackChain,
	})
}

// handleAPILogs returns buffered log lines for a given task_id (or all tasks).
// GET /api/logs?task_id=<id>&limit=<n>
func (s *Server) handleAPILogs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	taskID := r.URL.Query().Get("task_id")
	limit := 200
	if ls := r.URL.Query().Get("limit"); ls != "" {
		if n, err := strconv.Atoi(ls); err == nil && n > 0 {
			limit = n
		}
	}

	var entries []logbuf.LogEntry
	if s.logBuf != nil {
		if taskID != "" {
			entries = s.logBuf.Get(taskID, limit)
		} else {
			entries = s.logBuf.All(limit)
		}
	}
	if entries == nil {
		entries = []logbuf.LogEntry{}
	}
	json.NewEncoder(w).Encode(entries)
}

// handleAPITasks returns the full list of tasks as JSON (latest 200, desc).
func (s *Server) handleAPITasks(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	tasks, err := s.q.List(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(tasks)
}

// handleAPIEnqueue accepts a POST body with {agentId, prompt, priority, type}
// and enqueues it for the worker pool.
func (s *Server) handleAPIEnqueue(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var t queue.Task
	if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
		http.Error(w, "parse body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if t.Prompt == "" {
		http.Error(w, "prompt is required", http.StatusBadRequest)
		return
	}
	if t.Type == "" {
		t.Type = "prompt"
	}
	t.CreatedAt = time.Now().UnixMilli()

	taskID, err := s.q.Enqueue(r.Context(), t)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	t.ID = taskID

	// Broadcast task_created so all WS clients see it immediately.
	s.Hub.Broadcast(map[string]any{
		"type": "task_created",
		"task": map[string]any{
			"id":        t.ID,
			"prompt":    t.Prompt,
			"status":    string(queue.StatusPending),
			"agentId":   t.AgentID,
			"priority":  t.Priority,
			"createdAt": fmt.Sprintf("%d", t.CreatedAt),
		},
	})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"id": t.ID})
}

// corsJSON sets CORS + Content-Type headers shared by all Ultron handlers.
func corsJSON(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
}

// handleCORSPreflight returns 204 for OPTIONS requests.
func handleCORSPreflight(w http.ResponseWriter, r *http.Request, methods string) bool {
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", methods+", OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.WriteHeader(http.StatusNoContent)
		return true
	}
	return false
}
