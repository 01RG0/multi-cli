package tests

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/01rg0/orchestrator/internal/config"
	"github.com/01rg0/orchestrator/internal/provider"
	"github.com/01rg0/orchestrator/internal/server"
)

func newWSTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	cfg := &config.Config{ProxyPort: 8080, FallbackChain: []string{"mock"}}
	mock := &mockProvider{name: "mock"}
	router := provider.NewRouter(mock, nil, 1, 10)
	srv := server.New(router, cfg)

	ts := httptest.NewServer(http.HandlerFunc(srv.Hub.ServeWS))
	t.Cleanup(ts.Close)
	return ts
}

func TestWebSocketConnect(t *testing.T) {
	ts := newWSTestServer(t)
	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http")

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	// Connection established — no error means success
}

func TestWebSocketBroadcast(t *testing.T) {
	cfg := &config.Config{ProxyPort: 8080, FallbackChain: []string{"mock"}}
	mock := &mockProvider{name: "mock"}
	router := provider.NewRouter(mock, nil, 1, 10)
	srv := server.New(router, cfg)
	ts := httptest.NewServer(http.HandlerFunc(srv.Hub.ServeWS))
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http")
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	// Allow client registration
	time.Sleep(10 * time.Millisecond)

	event := map[string]any{"type": "stats", "pending": 3, "running": 1}
	srv.Hub.Broadcast(event)

	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, msg, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
	}

	var received map[string]any
	if err := json.Unmarshal(msg, &received); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if received["type"] != "stats" {
		t.Errorf("type: got %v want stats", received["type"])
	}
}

func TestWebSocketMultiClient(t *testing.T) {
	cfg := &config.Config{ProxyPort: 8080, FallbackChain: []string{"mock"}}
	mock := &mockProvider{name: "mock"}
	router := provider.NewRouter(mock, nil, 1, 10)
	srv := server.New(router, cfg)
	ts := httptest.NewServer(http.HandlerFunc(srv.Hub.ServeWS))
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http")

	var conns []*websocket.Conn
	for i := 0; i < 3; i++ {
		c, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
		if err != nil {
			t.Fatalf("dial %d: %v", i, err)
		}
		conns = append(conns, c)
		defer c.Close()
	}

	time.Sleep(20 * time.Millisecond)

	if count := srv.Hub.ClientCount(); count != 3 {
		t.Errorf("client count: got %d want 3", count)
	}

	srv.Hub.Broadcast(map[string]any{"type": "ping"})

	for i, c := range conns {
		c.SetReadDeadline(time.Now().Add(2 * time.Second))
		_, msg, err := c.ReadMessage()
		if err != nil {
			t.Fatalf("client %d read: %v", i, err)
		}
		if !strings.Contains(string(msg), "ping") {
			t.Errorf("client %d: got %s want ping event", i, msg)
		}
	}
}
