package tests

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/01rg0/orchestrator/internal/agent"
	"github.com/01rg0/orchestrator/internal/config"
	"github.com/01rg0/orchestrator/internal/logbuf"
	"github.com/01rg0/orchestrator/internal/provider"
	"github.com/01rg0/orchestrator/internal/server"
)

func TestAPILogsEndpoint(t *testing.T) {
	cfg := &config.Config{ProxyPort: 8080, FallbackChain: []string{"mock"}}
	mock := &mockProvider{name: "mock"}
	router := provider.NewRouter(mock, nil, 1, 10)
	srv := server.New(router, cfg, nil)

	lb := logbuf.New(100)
	lb.Append(logbuf.LogEntry{
		AgentID: "opencode",
		TaskID:  "task-123",
		Stream:  "stdout",
		Line:    "Building artifacts...",
		TS:      1700000000000,
	})
	lb.Append(logbuf.LogEntry{
		AgentID: "opencode",
		TaskID:  "task-123",
		Stream:  "stderr",
		Line:    "warning: deprecated flag",
		TS:      1700000001000,
	})
	lb.Append(logbuf.LogEntry{
		AgentID: "codex",
		TaskID:  "task-456",
		Stream:  "stdout",
		Line:    "Finished task 456",
		TS:      1700000002000,
	})
	srv.SetLogBuffer(lb)

	// 1. Test OPTIONS preflight
	reqOpts := httptest.NewRequest(http.MethodOptions, "/api/logs", nil)
	wOpts := httptest.NewRecorder()
	srv.ServeLogs(wOpts, reqOpts)
	if wOpts.Code != http.StatusNoContent {
		t.Fatalf("expected 204 No Content for OPTIONS, got %d", wOpts.Code)
	}

	// 2. Test GET all logs
	reqAll := httptest.NewRequest(http.MethodGet, "/api/logs?limit=10", nil)
	wAll := httptest.NewRecorder()
	srv.ServeLogs(wAll, reqAll)
	if wAll.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for GET all, got %d", wAll.Code)
	}
	var allEntries []logbuf.LogEntry
	if err := json.NewDecoder(wAll.Body).Decode(&allEntries); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(allEntries) != 3 {
		t.Errorf("expected 3 entries, got %d", len(allEntries))
	}

	// 3. Test GET task_id filtered
	reqTask := httptest.NewRequest(http.MethodGet, "/api/logs?task_id=task-123&limit=10", nil)
	wTask := httptest.NewRecorder()
	srv.ServeLogs(wTask, reqTask)
	if wTask.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for GET task_id, got %d", wTask.Code)
	}
	var taskEntries []logbuf.LogEntry
	if err := json.NewDecoder(wTask.Body).Decode(&taskEntries); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(taskEntries) != 2 {
		t.Fatalf("expected 2 entries for task-123, got %d", len(taskEntries))
	}
	if taskEntries[0].Line != "Building artifacts..." || taskEntries[1].Line != "warning: deprecated flag" {
		t.Errorf("unexpected task entries: %+v", taskEntries)
	}
}

func TestCLIAgentRunStreaming(t *testing.T) {
	// Test RunStreaming with a simple command, e.g. echo or go
	// We can use a CLIAgent with binary "go" or "powershell" or "cmd" depending on OS
	var a *agent.CLIAgent
	var prompt string
	a = agent.New("echoer", "cmd", 10*time.Second)
	// /c echo hello
	prompt = "/c echo hello stdout"

	var lines []string
	var streams []string
	onLine := func(agentID, taskID, stream, line string) {
		lines = append(lines, line)
		streams = append(streams, stream)
	}

	out, err := a.RunStreaming(context.Background(), "test-task-1", prompt, onLine)
	if err != nil {
		t.Fatalf("RunStreaming failed: %v", err)
	}
	if !strings.Contains(out, "hello stdout") {
		t.Errorf("expected output to contain 'hello stdout', got %q", out)
	}
	if len(lines) == 0 {
		t.Errorf("expected at least 1 line callback, got %d", len(lines))
	}
}
