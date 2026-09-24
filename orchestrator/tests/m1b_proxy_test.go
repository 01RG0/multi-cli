package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/01rg0/orchestrator/internal/config"
	"github.com/01rg0/orchestrator/internal/provider"
	"github.com/01rg0/orchestrator/internal/server"
)

// mockProvider always returns a fixed response.
type mockProvider struct{ name string }

func (m *mockProvider) Name() string { return m.name }
func (m *mockProvider) Complete(_ context.Context, _ provider.ChatRequest) (provider.ChatResponse, error) {
	return provider.ChatResponse{
		Content:      "Hello from mock",
		FinishReason: "stop",
		Usage:        provider.Usage{InputTokens: 5, OutputTokens: 4},
	}, nil
}
func (m *mockProvider) Stream(_ context.Context, _ provider.ChatRequest) (<-chan provider.StreamChunk, error) {
	ch := make(chan provider.StreamChunk, 3)
	ch <- provider.StreamChunk{Delta: "Hello "}
	ch <- provider.StreamChunk{Delta: "mock", Done: true}
	close(ch)
	return ch, nil
}

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	cfg := &config.Config{
		ProxyPort:     8080,
		FallbackChain: []string{"mock"},
	}
	mock := &mockProvider{name: "mock"}
	router := provider.NewRouter(mock, nil, 1, 10)
	srv := server.New(router, cfg)

	mux := http.NewServeMux()
	// Re-register handlers via exported test helper
	mux.HandleFunc("/v1/messages", srv.ServeMessages)
	mux.HandleFunc("/health", srv.ServeHealth)
	return httptest.NewServer(mux)
}

func TestProxyHealth(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("health: got %d want 200", resp.StatusCode)
	}
	var body map[string]any
	json.NewDecoder(resp.Body).Decode(&body)
	if body["status"] != "ok" {
		t.Fatalf("health status: %v", body)
	}
}

func TestProxyMessages(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()

	reqBody := map[string]any{
		"model":      "claude-sonnet-4-6",
		"max_tokens": 100,
		"messages":   []map[string]string{{"role": "user", "content": "Hi"}},
	}
	data, _ := json.Marshal(reqBody)

	resp, err := http.Post(ts.URL+"/v1/messages", "application/json", bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("messages: got %d: %s", resp.StatusCode, body)
	}

	var result map[string]any
	json.NewDecoder(resp.Body).Decode(&result)
	if result["type"] != "message" {
		t.Errorf("type: got %v want message", result["type"])
	}
	if result["role"] != "assistant" {
		t.Errorf("role: got %v want assistant", result["role"])
	}
	content, ok := result["content"].([]any)
	if !ok || len(content) == 0 {
		t.Fatalf("content missing: %v", result)
	}
}

func TestProxyStream(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()

	reqBody := map[string]any{
		"model": "claude-sonnet-4-6", "max_tokens": 100, "stream": true,
		"messages": []map[string]string{{"role": "user", "content": "Hi"}},
	}
	data, _ := json.Marshal(reqBody)

	resp, err := http.Post(ts.URL+"/v1/messages", "application/json", bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("content-type: got %q want text/event-stream", ct)
	}

	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), "message_stop") {
		t.Errorf("stream missing message_stop event:\n%s", body)
	}
}
