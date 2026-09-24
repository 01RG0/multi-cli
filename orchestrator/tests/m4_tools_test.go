package tests

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/01rg0/orchestrator/internal/tools"
)

func TestShellToolBasic(t *testing.T) {
	tool := tools.NewShellTool(tools.ShellConfig{TimeoutSecs: 5})
	ctx := context.Background()

	result := tool.Run(ctx, "echo hello")
	if !result.OK {
		t.Fatalf("shell: %s", result.Error)
	}
	if result.Output == "" {
		t.Error("shell: expected non-empty output")
	}
}

func TestShellToolAllowlist(t *testing.T) {
	tool := tools.NewShellTool(tools.ShellConfig{
		TimeoutSecs: 5,
		Allowlist:   []string{"echo"},
	})
	ctx := context.Background()

	ok := tool.Run(ctx, "echo hello")
	if !ok.OK {
		t.Errorf("allowed command should succeed: %s", ok.Error)
	}

	denied := tool.Run(ctx, "rm -rf /")
	if denied.OK {
		t.Error("blocked command should fail")
	}
}

func TestFileToolRead(t *testing.T) {
	dir := t.TempDir()
	err := os.WriteFile(filepath.Join(dir, "test.txt"), []byte("hello file"), 0600)
	if err != nil {
		t.Fatal(err)
	}

	tool := tools.NewFileTool(dir)
	ctx := context.Background()

	result := tool.Run(ctx, "test.txt")
	if !result.OK {
		t.Fatalf("file: %s", result.Error)
	}
	if result.Output != "hello file" {
		t.Errorf("content: got %q want hello file", result.Output)
	}
}

func TestFileToolTraversal(t *testing.T) {
	dir := t.TempDir()
	tool := tools.NewFileTool(dir)
	result := tool.Run(context.Background(), "../etc/passwd")
	if result.OK {
		t.Error("path traversal should be denied")
	}
}

func TestWebTool(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte("ok"))
	}))
	defer ts.Close()

	tool := tools.NewWebTool(tools.WebConfig{TimeoutSecs: 5})
	result := tool.Run(context.Background(), ts.URL)
	if !result.OK {
		t.Fatalf("web: %s", result.Error)
	}
	if result.Output != "ok" {
		t.Errorf("body: got %q want ok", result.Output)
	}
}

func TestWebToolAllowlist(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	}))
	defer ts.Close()

	tool := tools.NewWebTool(tools.WebConfig{
		TimeoutSecs: 5,
		Allowlist:   []string{"http://127.0.0.1"},
	})

	allowed := tool.Run(context.Background(), "http://127.0.0.1"+ts.URL[len("http://127.0.0.1"):])
	if !allowed.OK {
		t.Errorf("allowed URL failed: %s", allowed.Error)
	}

	blocked := tool.Run(context.Background(), "https://example.com")
	if blocked.OK {
		t.Error("blocked URL should fail")
	}
}

func TestRegistry(t *testing.T) {
	shell := tools.NewShellTool(tools.ShellConfig{TimeoutSecs: 5})
	reg := tools.NewRegistry(shell)

	result := reg.Run(context.Background(), "shell", "echo registry")
	if !result.OK {
		t.Fatalf("registry dispatch: %s", result.Error)
	}

	unknown := reg.Run(context.Background(), "nonexistent", "")
	if unknown.OK {
		t.Error("unknown tool should fail")
	}
}
