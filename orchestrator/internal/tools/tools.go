package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"
)

// ToolResult is the JSON-first result returned by every tool.
type ToolResult struct {
	ToolName string `json:"tool_name"`
	OK       bool   `json:"ok"`
	Output   string `json:"output,omitempty"`
	Error    string `json:"error,omitempty"`
}

func (r ToolResult) String() string {
	b, _ := json.Marshal(r)
	return string(b)
}

// Tool is the common interface for all agent tools.
type Tool interface {
	Name() string
	Run(ctx context.Context, input string) ToolResult
}

// ShellConfig configures the shell tool sandbox.
type ShellConfig struct {
	TimeoutSecs int      `yaml:"timeout_secs"`
	Allowlist   []string `yaml:"allowlist"`
}

// ShellTool runs sandboxed shell commands.
type ShellTool struct {
	cfg ShellConfig
}

func NewShellTool(cfg ShellConfig) *ShellTool {
	if cfg.TimeoutSecs == 0 {
		cfg.TimeoutSecs = 30
	}
	return &ShellTool{cfg: cfg}
}

func (s *ShellTool) Name() string { return "shell" }

func (s *ShellTool) Run(ctx context.Context, input string) ToolResult {
	// Allowlist check: reject if the command doesn't start with an allowed prefix
	if len(s.cfg.Allowlist) > 0 {
		allowed := false
		cmd := strings.TrimSpace(input)
		for _, prefix := range s.cfg.Allowlist {
			if strings.HasPrefix(cmd, prefix) {
				allowed = true
				break
			}
		}
		if !allowed {
			return ToolResult{ToolName: "shell", OK: false, Error: fmt.Sprintf("command not in allowlist: %q", cmd)}
		}
	}

	timeout := time.Duration(s.cfg.TimeoutSecs) * time.Second
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	var cmd *exec.Cmd
	if isWindows() {
		cmd = exec.CommandContext(ctx, "cmd", "/C", input)
	} else {
		cmd = exec.CommandContext(ctx, "sh", "-c", input)
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return ToolResult{ToolName: "shell", OK: false, Output: string(out), Error: err.Error()}
	}
	return ToolResult{ToolName: "shell", OK: true, Output: string(out)}
}

func isWindows() bool {
	return os.PathSeparator == '\\'
}

// FileTool reads files within an allowed root directory.
type FileTool struct {
	root string
}

func NewFileTool(root string) *FileTool {
	return &FileTool{root: root}
}

func (f *FileTool) Name() string { return "file" }

func (f *FileTool) Run(ctx context.Context, input string) ToolResult {
	// input is the relative path
	path := strings.TrimSpace(input)
	if strings.Contains(path, "..") {
		return ToolResult{ToolName: "file", OK: false, Error: "path traversal not allowed"}
	}
	fullPath := f.root + string(os.PathSeparator) + path
	data, err := os.ReadFile(fullPath)
	if err != nil {
		return ToolResult{ToolName: "file", OK: false, Error: err.Error()}
	}
	return ToolResult{ToolName: "file", OK: true, Output: string(data)}
}

// WebConfig configures the web fetch tool.
type WebConfig struct {
	TimeoutSecs int      `yaml:"timeout_secs"`
	Allowlist   []string `yaml:"allowlist"`
}

// WebTool fetches URLs, optionally restricted to an allowlist of host prefixes.
type WebTool struct {
	cfg    WebConfig
	client *http.Client
}

func NewWebTool(cfg WebConfig) *WebTool {
	if cfg.TimeoutSecs == 0 {
		cfg.TimeoutSecs = 15
	}
	return &WebTool{
		cfg:    cfg,
		client: &http.Client{Timeout: time.Duration(cfg.TimeoutSecs) * time.Second},
	}
}

func (w *WebTool) Name() string { return "web" }

func (w *WebTool) Run(ctx context.Context, input string) ToolResult {
	url := strings.TrimSpace(input)

	if len(w.cfg.Allowlist) > 0 {
		allowed := false
		for _, prefix := range w.cfg.Allowlist {
			if strings.HasPrefix(url, prefix) {
				allowed = true
				break
			}
		}
		if !allowed {
			return ToolResult{ToolName: "web", OK: false, Error: fmt.Sprintf("URL not in allowlist: %q", url)}
		}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return ToolResult{ToolName: "web", OK: false, Error: err.Error()}
	}
	req.Header.Set("User-Agent", "orchestrator/1.0")

	resp, err := w.client.Do(req)
	if err != nil {
		return ToolResult{ToolName: "web", OK: false, Error: err.Error()}
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20)) // 1MB cap
	if err != nil {
		return ToolResult{ToolName: "web", OK: false, Error: err.Error()}
	}
	if resp.StatusCode >= 400 {
		return ToolResult{ToolName: "web", OK: false, Error: fmt.Sprintf("HTTP %d", resp.StatusCode), Output: string(body)}
	}
	return ToolResult{ToolName: "web", OK: true, Output: string(body)}
}

// Registry maps tool names to Tool implementations.
type Registry map[string]Tool

// NewRegistry creates a registry from a list of tools.
func NewRegistry(tools ...Tool) Registry {
	r := make(Registry, len(tools))
	for _, t := range tools {
		r[t.Name()] = t
	}
	return r
}

// Run dispatches a tool call by name.
func (r Registry) Run(ctx context.Context, name, input string) ToolResult {
	t, ok := r[name]
	if !ok {
		return ToolResult{ToolName: name, OK: false, Error: fmt.Sprintf("unknown tool: %q", name)}
	}
	return t.Run(ctx, input)
}
