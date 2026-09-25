package tests

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/01rg0/orchestrator/internal/db"
	"github.com/01rg0/orchestrator/internal/mcp"
	"github.com/01rg0/orchestrator/internal/skills"
)

// ─── Skills Registry Tests ───────────────────────────────────────────────────

func openSkillsDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open in-memory db: %v", err)
	}
	if err := skills.Migrate(database); err != nil {
		t.Fatalf("skills migrate: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

func TestSkillsUpsertAndGet(t *testing.T) {
	database := openSkillsDB(t)
	ctx := context.Background()

	// 1. Create a new skill
	newSkill := skills.Skill{
		Name:           "code-review",
		Description:    "Automated code review expert",
		PromptTemplate: "Review this code: {{input}}\nRelevant architecture: {{context}}",
		Tools:          []string{"git", "shell"},
		AgentID:        "codex",
	}

	id, err := skills.UpsertSkill(ctx, database, newSkill)
	if err != nil {
		t.Fatalf("UpsertSkill create failed: %v", err)
	}
	if id == "" {
		t.Fatal("expected generated skill ID, got empty string")
	}

	// 2. GetSkill and verify fields
	fetched, err := skills.GetSkill(ctx, database, id)
	if err != nil {
		t.Fatalf("GetSkill failed: %v", err)
	}
	if fetched.ID != id {
		t.Errorf("got ID %q, want %q", fetched.ID, id)
	}
	if fetched.Name != newSkill.Name {
		t.Errorf("got Name %q, want %q", fetched.Name, newSkill.Name)
	}
	if fetched.Description != newSkill.Description {
		t.Errorf("got Description %q, want %q", fetched.Description, newSkill.Description)
	}
	if fetched.PromptTemplate != newSkill.PromptTemplate {
		t.Errorf("got PromptTemplate %q, want %q", fetched.PromptTemplate, newSkill.PromptTemplate)
	}
	if fetched.AgentID != newSkill.AgentID {
		t.Errorf("got AgentID %q, want %q", fetched.AgentID, newSkill.AgentID)
	}
	if len(fetched.Tools) != 2 || fetched.Tools[0] != "git" || fetched.Tools[1] != "shell" {
		t.Errorf("got Tools %+v, want [git shell]", fetched.Tools)
	}
	if fetched.CreatedAt == 0 || fetched.UpdatedAt == 0 {
		t.Errorf("expected non-zero timestamps: created=%d, updated=%d", fetched.CreatedAt, fetched.UpdatedAt)
	}

	// 3. Update existing skill
	fetched.Description = "Updated description"
	fetched.PromptTemplate = "New template: {{input}}"
	fetched.Tools = []string{"git", "shell", "web"}
	updateID, err := skills.UpsertSkill(ctx, database, fetched)
	if err != nil {
		t.Fatalf("UpsertSkill update failed: %v", err)
	}
	if updateID != id {
		t.Errorf("expected same skill ID on update: got %q, want %q", updateID, id)
	}

	updated, err := skills.GetSkill(ctx, database, id)
	if err != nil {
		t.Fatalf("GetSkill after update failed: %v", err)
	}
	if updated.Description != "Updated description" {
		t.Errorf("got Description %q, want updated", updated.Description)
	}
	if updated.PromptTemplate != "New template: {{input}}" {
		t.Errorf("got PromptTemplate %q, want new template", updated.PromptTemplate)
	}
	if len(updated.Tools) != 3 || updated.Tools[2] != "web" {
		t.Errorf("got Tools %+v, want 3 tools with web", updated.Tools)
	}
}

func TestSkillsList(t *testing.T) {
	database := openSkillsDB(t)
	ctx := context.Background()

	// Initial empty list
	initialList, err := skills.ListSkills(ctx, database)
	if err != nil {
		t.Fatalf("ListSkills on empty db: %v", err)
	}
	if len(initialList) != 0 {
		t.Errorf("expected 0 skills on empty db, got %d", len(initialList))
	}

	// Insert multiple skills
	skillA := skills.Skill{
		ID:             "skill-a",
		Name:           "alpha-skill",
		Description:    "Alpha skill",
		PromptTemplate: "Alpha {{input}}",
		CreatedAt:      1000,
	}
	skillB := skills.Skill{
		ID:             "skill-b",
		Name:           "beta-skill",
		Description:    "Beta skill",
		PromptTemplate: "Beta {{input}}",
		CreatedAt:      2000,
	}

	if _, err := skills.UpsertSkill(ctx, database, skillA); err != nil {
		t.Fatalf("upsert skill A: %v", err)
	}
	if _, err := skills.UpsertSkill(ctx, database, skillB); err != nil {
		t.Fatalf("upsert skill B: %v", err)
	}

	list, err := skills.ListSkills(ctx, database)
	if err != nil {
		t.Fatalf("ListSkills: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("expected 2 skills, got %d", len(list))
	}

	// Check ordering: created_at DESC (skillB created at 2000 should come first)
	if list[0].ID != "skill-b" || list[1].ID != "skill-a" {
		t.Errorf("expected order [skill-b, skill-a], got [%s, %s]", list[0].ID, list[1].ID)
	}
}

func TestSkillsDelete(t *testing.T) {
	database := openSkillsDB(t)
	ctx := context.Background()

	s := skills.Skill{
		ID:             "skill-del",
		Name:           "delete-me",
		PromptTemplate: "template",
	}
	id, err := skills.UpsertSkill(ctx, database, s)
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}

	// Verify it exists
	if _, err := skills.GetSkill(ctx, database, id); err != nil {
		t.Fatalf("GetSkill before delete: %v", err)
	}

	// Delete skill
	if err := skills.DeleteSkill(ctx, database, id); err != nil {
		t.Fatalf("DeleteSkill: %v", err)
	}

	// GetSkill should now fail
	_, err = skills.GetSkill(ctx, database, id)
	if err == nil {
		t.Fatal("expected error getting deleted skill, got nil")
	}

	// List should be empty
	list, err := skills.ListSkills(ctx, database)
	if err != nil {
		t.Fatalf("ListSkills after delete: %v", err)
	}
	if len(list) != 0 {
		t.Errorf("expected 0 skills after delete, got %d", len(list))
	}
}

func TestSkillsRender(t *testing.T) {
	sk := skills.Skill{
		Name:           "refactor-helper",
		PromptTemplate: "Analyze input: {{input}}\nApply to: {{context}}\nRe-check input: {{input}}",
	}

	rendered := skills.RenderSkill(sk, "refactor auth logic", "internal/server/auth.go")
	expected := "Analyze input: refactor auth logic\nApply to: internal/server/auth.go\nRe-check input: refactor auth logic"
	if rendered != expected {
		t.Errorf("RenderSkill mismatch:\ngot:\n%s\nwant:\n%s", rendered, expected)
	}

	// Test template without placeholders
	skStatic := skills.Skill{
		PromptTemplate: "Just a static prompt.",
	}
	if out := skills.RenderSkill(skStatic, "foo", "bar"); out != "Just a static prompt." {
		t.Errorf("static template render got %q", out)
	}
}

// ─── MCP Client & Manager Tests ──────────────────────────────────────────────

func TestMCPManagerEmptyConfigs(t *testing.T) {
	ctx := context.Background()

	// NewManager with nil or empty configs should not panic
	m := mcp.NewManager(nil, ctx)
	if m == nil {
		t.Fatal("expected non-nil Manager")
	}

	tools := m.AllTools()
	if len(tools) != 0 {
		t.Errorf("expected 0 tools for empty manager, got %d", len(tools))
	}

	names := m.ServerNames()
	if len(names) != 0 {
		t.Errorf("expected 0 server names, got %d", len(names))
	}

	_, exists := m.GetClient("unknown")
	if exists {
		t.Error("expected GetClient to return false for nonexistent server")
	}

	_, err := m.CallTool(ctx, "unknown", "some_tool", nil)
	if err == nil {
		t.Error("expected error when calling tool on nonexistent server")
	}

	// StopAll should be a safe no-op
	m.StopAll()
}

func TestMCPManagerWithMockHTTPServer(t *testing.T) {
	ctx := context.Background()

	// Mock MCP HTTP Server
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		switch r.URL.Path {
		case "/tools/list":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{
				"tools": [
					{
						"name": "calculate",
						"description": "Performs math calculation",
						"inputSchema": {
							"type": "object",
							"properties": {
								"expr": {"type": "string"}
							}
						}
					},
					{
						"name": "ping",
						"description": "Ping test tool",
						"inputSchema": {"type": "object"}
					}
				]
			}`))

		case "/tools/call":
			var req struct {
				Name      string                 `json:"name"`
				Arguments map[string]interface{} `json:"arguments"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}

			if req.Name == "error_tool" {
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte(`{
					"content": [{"type": "text", "text": "division by zero"}],
					"isError": true
				}`))
				return
			}

			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{
				"content": [
					{"type": "text", "text": "result: 42"}
				],
				"isError": false
			}`))

		default:
			http.NotFound(w, r)
		}
	}))
	defer mockServer.Close()

	// Configure Manager with the mock HTTP server
	cfgs := []mcp.ServerConfig{
		{
			Name:    "mock-calc",
			BaseURL: mockServer.URL,
		},
	}

	mgr := mcp.NewManager(cfgs, ctx)
	defer mgr.StopAll()

	// Verify ServerNames
	names := mgr.ServerNames()
	if len(names) != 1 || names[0] != "mock-calc" {
		t.Fatalf("expected server names [mock-calc], got %+v", names)
	}

	// Verify AllTools aggregates tools from running servers
	allTools := mgr.AllTools()
	if len(allTools) != 2 {
		t.Fatalf("expected 2 tools, got %d", len(allTools))
	}
	toolMap := make(map[string]mcp.Tool)
	for _, tool := range allTools {
		toolMap[tool.Name] = tool
	}
	if calc, ok := toolMap["calculate"]; !ok || calc.Description != "Performs math calculation" {
		t.Errorf("expected calculate tool with description, got %+v", calc)
	}
	if _, ok := toolMap["ping"]; !ok {
		t.Errorf("expected ping tool to be present")
	}

	// Call tool successfully via HTTP
	res, err := mgr.CallTool(ctx, "mock-calc", "calculate", map[string]interface{}{"expr": "6*7"})
	if err != nil {
		t.Fatalf("CallTool failed: %v", err)
	}
	if !strings.Contains(res, "result: 42") {
		t.Errorf("CallTool got %q, want it to contain 'result: 42'", res)
	}

	// Call tool on non-existent server should return error
	_, err = mgr.CallTool(ctx, "nonexistent-server", "calculate", nil)
	if err == nil {
		t.Error("expected error for non-existent server")
	} else if !strings.Contains(err.Error(), "not found or not running") {
		t.Errorf("unexpected error message: %v", err)
	}

	// Verify GetClient works
	client, ok := mgr.GetClient("mock-calc")
	if !ok || client == nil {
		t.Fatal("expected GetClient to return mock-calc client")
	}
	if client.Config().BaseURL != mockServer.URL {
		t.Errorf("client BaseURL mismatch: got %q, want %q", client.Config().BaseURL, mockServer.URL)
	}
}

func TestMCPServerConfigValidation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	// 1. Stdio transport missing command should return validation error
	emptyCmdClient := mcp.New(mcp.ServerConfig{
		Name: "missing-command",
	})
	err := emptyCmdClient.Start(ctx)
	if err == nil {
		t.Error("expected error when Command is empty for stdio transport")
	} else if !strings.Contains(err.Error(), "command required for stdio transport") {
		t.Errorf("unexpected error message: %v", err)
	}

	// 2. HTTP transport with unreachable BaseURL should return error
	badHTTPClient := mcp.New(mcp.ServerConfig{
		Name:    "unreachable-http",
		BaseURL: "http://127.0.0.1:59999/unreachable",
	})
	err = badHTTPClient.Start(ctx)
	if err == nil {
		t.Error("expected error for unreachable HTTP MCP server")
	} else if !strings.Contains(err.Error(), "unreachable") {
		t.Errorf("expected error to mention unreachable, got %v", err)
	}

	// 3. NewManager with invalid server configs skips failures gracefully
	cfgs := []mcp.ServerConfig{
		{Name: "invalid-stdio-1"},
		{Name: "unreachable-http-2", BaseURL: "http://127.0.0.1:59999"},
	}
	mgr := mcp.NewManager(cfgs, ctx)
	if mgr == nil {
		t.Fatal("expected non-nil manager even when all servers fail to start")
	}
	if len(mgr.AllTools()) != 0 {
		t.Errorf("expected 0 tools when all servers fail, got %d", len(mgr.AllTools()))
	}
	if len(mgr.ServerNames()) != 0 {
		t.Errorf("expected 0 running server names, got %d", len(mgr.ServerNames()))
	}
}
