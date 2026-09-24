package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/01rg0/orchestrator/internal/config"
	"github.com/01rg0/orchestrator/internal/provider"
)

type Server struct {
	router     *provider.Router
	cfg        *config.Config
	httpServer *http.Server
}

func New(router *provider.Router, cfg *config.Config) *Server {
	return &Server{router: router, cfg: cfg}
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
	mux.HandleFunc("/health", s.handleHealth)

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
