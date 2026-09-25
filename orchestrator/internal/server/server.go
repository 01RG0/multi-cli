package server

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"time"

	"github.com/01rg0/orchestrator/internal/config"
	"github.com/01rg0/orchestrator/internal/hub"
	"github.com/01rg0/orchestrator/internal/provider"
)

//go:embed all:dist
var distFS embed.FS

type Server struct {
	router     *provider.Router
	cfg        *config.Config
	httpServer *http.Server
	Hub        *hub.Hub
}

func New(router *provider.Router, cfg *config.Config) *Server {
	h := hub.New()
	go h.Run()
	return &Server{router: router, cfg: cfg, Hub: h}
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

	// Serve embedded frontend (built dist/)
	stripped, err := fs.Sub(distFS, "dist")
	if err == nil {
		mux.Handle("/", http.FileServer(http.FS(stripped)))
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
