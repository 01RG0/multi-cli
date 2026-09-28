package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"
)

const maxGHOutput = 100 * 1024 // 100 KB cap on gh output

// ghEnv returns the process environment with HOME forced to /home/rootuser
// so that gh finds its auth config regardless of what systemd set HOME to.
func ghEnv() []string {
	env := os.Environ()
	out := make([]string, 0, len(env))
	for _, e := range env {
		if !strings.HasPrefix(e, "HOME=") {
			out = append(out, e)
		}
	}
	return append(out, "HOME=/home/rootuser")
}

// capGHOutput truncates gh output to maxGHOutput and re-wraps if JSON becomes invalid.
func capGHOutput(out []byte) []byte {
	if len(out) <= maxGHOutput {
		return out
	}
	truncated := out[:maxGHOutput]
	if json.Valid(truncated) {
		return truncated
	}
	wrapped, _ := json.Marshal(map[string]string{
		"truncated_output": string(truncated),
		"note":             fmt.Sprintf("output truncated from %d to %d bytes", len(out), maxGHOutput),
	})
	return wrapped
}

// handleGitHubAPI proxies to `gh api`: POST /api/github/api
// Body: { "method": "GET|POST|PATCH|PUT|DELETE", "endpoint": "/repos/...", "body": {...} }
func (s *Server) handleGitHubAPI(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if handleCORSPreflight(w, r, "POST") {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Method   string         `json:"method"`
		Endpoint string         `json:"endpoint"`
		Body     map[string]any `json:"body,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if req.Endpoint == "" {
		http.Error(w, "endpoint required", http.StatusBadRequest)
		return
	}
	if req.Method == "" {
		req.Method = "GET"
	}

	args := []string{"api", "--method", req.Method, req.Endpoint, "--header", "Accept: application/vnd.github+json"}

	var bodyJSON []byte
	if req.Body != nil {
		bodyJSON, _ = json.Marshal(req.Body)
		args = append(args, "--input", "-")
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "gh", args...)
	if bodyJSON != nil {
		cmd.Stdin = strings.NewReader(string(bodyJSON))
	}
	cmd.Env = ghEnv()

	out, err := cmd.Output()
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			w.WriteHeader(http.StatusBadGateway)
			json.NewEncoder(w).Encode(map[string]string{"error": string(ee.Stderr)})
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Write(capGHOutput(out))
}

// handleGitHubCLI runs arbitrary gh subcommands: POST /api/github/cli
// Body: { "args": ["pr", "list", ...], "cwd": "/optional/path" }
func (s *Server) handleGitHubCLI(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if handleCORSPreflight(w, r, "POST") {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Args []string `json:"args"`
		Cwd  string   `json:"cwd,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if len(req.Args) == 0 {
		http.Error(w, "args required", http.StatusBadRequest)
		return
	}
	blocked := map[string]bool{"auth": true, "config": true, "extension": true}
	if blocked[req.Args[0]] {
		http.Error(w, fmt.Sprintf("subcommand %q is not allowed", req.Args[0]), http.StatusForbidden)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "gh", req.Args...)
	cmd.Env = ghEnv()
	if req.Cwd != "" {
		cmd.Dir = req.Cwd
	}

	out, err := cmd.Output()
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			w.WriteHeader(http.StatusBadGateway)
			json.NewEncoder(w).Encode(map[string]string{"error": string(ee.Stderr), "stdout": string(out)})
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	out = capGHOutput(out)
	if json.Valid(out) {
		w.Write(out)
	} else {
		json.NewEncoder(w).Encode(map[string]string{"output": string(out)})
	}
}
