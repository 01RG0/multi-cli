package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/01rg0/orchestrator/internal/config"
	"github.com/01rg0/orchestrator/internal/hub"
	"github.com/01rg0/orchestrator/internal/memory"
	"github.com/01rg0/orchestrator/internal/provider"
	"github.com/01rg0/orchestrator/internal/queue"
)

type Server struct {
	router     *provider.Router
	cfg        *config.Config
	httpServer *http.Server
	Hub        *hub.Hub
	q          *queue.Queue  // optional; nil when workers are disabled
	graph      *memory.Graph
}

// New creates a Server. g may be nil when memory is not needed (e.g. in tests).
func New(router *provider.Router, cfg *config.Config, g *memory.Graph) *Server {
	h := hub.New()
	go h.Run()
	return &Server{router: router, cfg: cfg, Hub: h, graph: g}
}

// SetQueue attaches a live queue to the server, enabling /api/tasks and
// /api/tasks/enqueue, and wiring an init-snapshot on every WS connect.
// Must be called before Start().
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
				"runningCount":   stats[string(queue.StatusRunning)],
				"pendingCount":   stats[string(queue.StatusPending)],
				"tasksToday":     stats[string(queue.StatusCompleted)] + stats[string(queue.StatusFailed)],
			},
		})
		return b
	}
}

// ServeMessages is the exported handler for testing.
func (s *Server) ServeMessages(w http.ResponseWriter, r *http.Request) {
	s.handleMessages(w, r)
}

// ServeHealth is the exported handler for testing.
func (s *Server) ServeHealth(w http.ResponseWriter, r *http.Request) {
	s.handleHealth(w, r)
}

func (s *Server) Start() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/messages", s.handleMessages)
	mux.HandleFunc("/messages", s.handleMessages) // SDK compat: some versions omit /v1 prefix
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/ws", s.Hub.ServeWS)

	if s.q != nil {
		mux.HandleFunc("/api/tasks", s.handleAPITasks)
		mux.HandleFunc("/api/tasks/enqueue", s.handleAPIEnqueue)
	}

	addr := fmt.Sprintf(":%d", s.cfg.ProxyPort)
	s.httpServer = &http.Server{
		Addr:         addr,
		Handler:      mux,
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

// handleAPITasks returns queue stats as JSON.
func (s *Server) handleAPITasks(w http.ResponseWriter, r *http.Request) {
	stats, err := s.q.Stats(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	json.NewEncoder(w).Encode(stats)
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

	if err := s.q.Enqueue(r.Context(), t); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

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
