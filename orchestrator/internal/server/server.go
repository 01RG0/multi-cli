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
)

type Server struct {
	router     *provider.Router
	cfg        *config.Config
	httpServer *http.Server
	Hub        *hub.Hub
	graph      *memory.Graph
}

// New creates a Server. g may be nil when memory is not needed (e.g. in tests).
func New(router *provider.Router, cfg *config.Config, g *memory.Graph) *Server {
	h := hub.New()
	go h.Run()
	return &Server{router: router, cfg: cfg, Hub: h, graph: g}
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
