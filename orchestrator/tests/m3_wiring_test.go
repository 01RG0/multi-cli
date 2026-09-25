//go:build integration

// Package tests — end-to-end memory wiring assertions.
//
// These tests verify that the memory graph is wired into the server:
//   - Search results surface in the system prompt (Test A)
//   - Episodes are persisted after a request (Test B)
//   - AppendEpisode runs asynchronously and never blocks the response (Test C)
//
// Build tag rationale: server.New() does not yet accept a *memory.Graph — that
// wiring is handled by a parallel agent branch. Until it lands, these tests
// use "//go:build integration" so the default `go test ./tests/ -v` run is
// unaffected. Run with: go test ./tests/ -v -tags integration
//
// Expected final server interface (to be added by the parallel agent):
//
//	type MemoryGraph interface {
//	    Search(ctx context.Context, query string, limit int) ([]memory.SearchResult, error)
//	    AppendEpisode(ctx context.Context, ep memory.Episode) (string, error)
//	}
//
//	func NewWithMemory(router *provider.Router, cfg *config.Config,
//	                   g MemoryGraph, retrievalK int) *Server
//
// Alternatively, server.New may be extended to accept an optional graph via
// functional options or a separate setter: srv.SetGraph(g, retrievalK).
package tests

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/01rg0/orchestrator/internal/config"
	"github.com/01rg0/orchestrator/internal/db"
	"github.com/01rg0/orchestrator/internal/memory"
	"github.com/01rg0/orchestrator/internal/provider"
	"github.com/01rg0/orchestrator/internal/server"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// recordingProvider wraps mockProvider and captures the last ChatRequest.
type recordingProvider struct {
	mockProvider
	lastReq atomic.Value // stores provider.ChatRequest
}

func (r *recordingProvider) Complete(ctx context.Context, req provider.ChatRequest) (provider.ChatResponse, error) {
	r.lastReq.Store(req)
	return r.mockProvider.Complete(ctx, req)
}

func (r *recordingProvider) lastRequest() provider.ChatRequest {
	if v := r.lastReq.Load(); v != nil {
		return v.(provider.ChatRequest)
	}
	return provider.ChatRequest{}
}

// openTestMemoryDB creates an in-memory SQLite DB with both the task queue
// schema and the memory schema applied.
func openTestMemoryDB(t *testing.T) (*memory.Graph, *sql.DB) {
	t.Helper()
	database, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.Migrate(database); err != nil {
		t.Fatalf("db.Migrate: %v", err)
	}
	if err := memory.Migrate(database); err != nil {
		t.Fatalf("memory.Migrate: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return memory.New(database), database
}

// newMemoryTestServer creates an httptest.Server wired with a memory graph.
// It uses server.NewWithMemory (expected final API from the parallel agent).
func newMemoryTestServer(t *testing.T, g server.MemoryGraph, retrievalK int) (*httptest.Server, *recordingProvider) {
	t.Helper()
	cfg := &config.Config{
		ProxyPort:     8080,
		FallbackChain: []string{"mock"},
	}
	rec := &recordingProvider{mockProvider: mockProvider{name: "mock"}}
	router := provider.NewRouter(rec, nil, 1, 10)
	srv := server.NewWithMemory(router, cfg, g, retrievalK)

	mux := http.NewServeMux()
	mux.HandleFunc("/v1/messages", srv.ServeMessages)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)
	return ts, rec
}

// postMessages sends a POST /v1/messages request with the given user content.
func postMessages(t *testing.T, ts *httptest.Server, userMsg string) *http.Response {
	t.Helper()
	body, _ := json.Marshal(map[string]any{
		"model":      "claude-sonnet-4-6",
		"max_tokens": 50,
		"messages":   []map[string]string{{"role": "user", "content": userMsg}},
	})
	resp, err := http.Post(ts.URL+"/v1/messages", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST /v1/messages: %v", err)
	}
	return resp
}

// ---------------------------------------------------------------------------
// TEST A — Search result appears in system prompt when memory_enabled
// ---------------------------------------------------------------------------

func TestMemoryWiring_SearchInSystemPrompt(t *testing.T) {
	g, _ := openTestMemoryDB(t)
	ctx := context.Background()

	// Insert a node with a distinctive label
	const distinctLabel = "ultron-test-node-XYZ"
	if _, err := g.UpsertNode(ctx, memory.Node{
		Label:      distinctLabel,
		Type:       "concept",
		Source:     "user_stated",
		Confidence: 1.0,
	}); err != nil {
		t.Fatalf("UpsertNode: %v", err)
	}

	ts, rec := newMemoryTestServer(t, g, 5)

	resp := postMessages(t, ts, "tell me about "+distinctLabel)
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status: got %d want 200", resp.StatusCode)
	}

	req := rec.lastRequest()
	// The server should have injected memory search results into the system prompt.
	// Check that the distinctive label appears somewhere in the system message text.
	systemText := req.System
	if systemText == "" {
		// Some server implementations pass memory as the first message with role=system.
		for _, m := range req.Messages {
			if m.Role == "system" {
				systemText = m.Content
				break
			}
		}
	}
	if systemText == "" {
		t.Fatal("system prompt is empty — memory results were not injected")
	}
	if !bytes.Contains([]byte(systemText), []byte(distinctLabel)) {
		t.Errorf("system prompt does not contain %q\ngot: %s", distinctLabel, systemText)
	}
}

// ---------------------------------------------------------------------------
// TEST B — Episode row exists after a request completes
// ---------------------------------------------------------------------------

func TestMemoryWiring_EpisodePersistedAfterRequest(t *testing.T) {
	g, database := openTestMemoryDB(t)

	ts, _ := newMemoryTestServer(t, g, 5)

	resp := postMessages(t, ts, "hello episode test")
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status: got %d want 200", resp.StatusCode)
	}

	// Give the goroutine time to write the episode asynchronously.
	time.Sleep(50 * time.Millisecond)

	var count int
	if err := database.QueryRow(`SELECT COUNT(*) FROM episodes WHERE kind='message'`).Scan(&count); err != nil {
		t.Fatalf("count episodes: %v", err)
	}
	if count < 1 {
		t.Errorf("expected at least 1 episode with kind='message', got %d", count)
	}
}

// ---------------------------------------------------------------------------
// TEST C — Response must not be delayed by a slow AppendEpisode
// ---------------------------------------------------------------------------

// slowGraph wraps a real *memory.Graph but sleeps 500ms in AppendEpisode to
// simulate a slow write. It implements server.MemoryGraph.
type slowGraph struct {
	real  *memory.Graph
	delay time.Duration
}

func (s *slowGraph) Search(ctx context.Context, query string, limit int) ([]memory.SearchResult, error) {
	return s.real.Search(ctx, query, limit)
}

func (s *slowGraph) AppendEpisode(ctx context.Context, ep memory.Episode) (string, error) {
	time.Sleep(s.delay) // simulate slow write
	return s.real.AppendEpisode(ctx, ep)
}

func TestMemoryWiring_ResponseNotDelayedByEpisodeWrite(t *testing.T) {
	g, _ := openTestMemoryDB(t)

	slow := &slowGraph{real: g, delay: 500 * time.Millisecond}
	ts, _ := newMemoryTestServer(t, slow, 5)

	start := time.Now()
	resp := postMessages(t, ts, "timing test")
	elapsed := time.Since(start)
	if resp != nil {
		resp.Body.Close()
	}

	// The response must arrive well before the 500ms AppendEpisode sleep.
	const maxAllowed = 200 * time.Millisecond
	if elapsed > maxAllowed {
		t.Errorf("round-trip %v exceeds %v — AppendEpisode is blocking the response path",
			elapsed, maxAllowed)
	}
}
