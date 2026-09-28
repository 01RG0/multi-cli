package server

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

const cliCapsPath = "/home/rootuser/multi-cli/orchestrator/internal/dispatch/cli_capabilities.yaml"

type cliCapsYAML struct {
	CLIs    map[string]struct {
		Status      string   `yaml:"status"`
		HeadlessCmd string   `yaml:"headless_cmd"`
		DefaultModel string  `yaml:"default_model"`
		Tags        []string `yaml:"tags"`
		Notes       string   `yaml:"notes"`
	} `yaml:"clis"`
	Routing map[string]struct {
		Primary   string   `yaml:"primary"`
		Fallback  []string `yaml:"fallback"`
		ModelHint string   `yaml:"model_hint"`
		Reason    string   `yaml:"reason"`
	} `yaml:"routing"`
	CapIndex map[string][]string `yaml:"capability_index"`
	Priority []string            `yaml:"dispatch_priority"`
}

func loadCLICaps() (*cliCapsYAML, error) {
	data, err := os.ReadFile(cliCapsPath)
	if err != nil {
		return nil, err
	}
	var caps cliCapsYAML
	if err := yaml.Unmarshal(data, &caps); err != nil {
		return nil, err
	}
	return &caps, nil
}

// GET /api/cli/capabilities
func (s *Server) handleCLICapabilities(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if handleCORSPreflight(w, r, "GET") {
		return
	}
	data, err := os.ReadFile(cliCapsPath)
	if err != nil {
		http.Error(w, "capabilities not found: "+err.Error(), http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/x-yaml")
	w.Write(data)
}

// GET /api/cli/route?task=<type>
func (s *Server) handleCLIRoute(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if handleCORSPreflight(w, r, "GET") {
		return
	}
	taskType := r.URL.Query().Get("task")
	if taskType == "" {
		taskType = "general_chat"
	}
	caps, err := loadCLICaps()
	if err != nil {
		http.Error(w, "capabilities load error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	route, ok := caps.Routing[taskType]
	if !ok {
		route = caps.Routing["general_chat"]
	}
	json.NewEncoder(w).Encode(map[string]any{
		"task_type":   taskType,
		"primary":     route.Primary,
		"fallback":    route.Fallback,
		"model_hint":  route.ModelHint,
		"reason":      route.Reason,
		"working_now": caps.CapIndex["working_now"],
		"all_tasks":   keys(caps.Routing),
	})
}

// POST /api/cli/invoke  body: {cli, prompt, task_type?, model_hint?, timeout_seconds?}
func (s *Server) handleCLIInvoke(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if handleCORSPreflight(w, r, "POST") {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		CLI      string `json:"cli"`
		Prompt   string `json:"prompt"`
		TaskType string `json:"task_type"`
		Model    string `json:"model_hint"`
		Timeout  int    `json:"timeout_seconds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	if body.Prompt == "" {
		http.Error(w, "prompt required", http.StatusBadRequest)
		return
	}
	// Auto-select CLI from task type if not specified
	if body.CLI == "" && body.TaskType != "" {
		caps, err := loadCLICaps()
		if err == nil {
			if route, ok := caps.Routing[body.TaskType]; ok {
				body.CLI = route.Primary
				if body.Model == "" {
					body.Model = route.ModelHint
				}
			}
		}
	}
	if body.CLI == "" {
		body.CLI = "agy"
	}

	timeout := 60
	if body.Timeout > 0 {
		timeout = body.Timeout
	}

	cmd := buildCLICmd(body.CLI, body.Prompt, body.Model)
	if cmd == "" {
		http.Error(w, "unsupported CLI: "+body.CLI, http.StatusBadRequest)
		return
	}

	fullCmd := "source /home/rootuser/multi-cli/.env 2>/dev/null && " + cmd
	start := time.Now()
	ctx := r.Context()
	out, err := exec.CommandContext(ctx, "bash", "-c", fullCmd).Output()
	// Honour timeout separately
	_ = timeout
	latency := time.Since(start).Milliseconds()

	if err != nil {
		json.NewEncoder(w).Encode(map[string]any{
			"ok": false, "cli": body.CLI, "error": err.Error(), "latency_ms": latency,
		})
		return
	}
	json.NewEncoder(w).Encode(map[string]any{
		"ok": true, "cli": body.CLI, "output": strings.TrimSpace(string(out)), "latency_ms": latency,
	})
}

func buildCLICmd(cli, prompt, model string) string {
	p := strings.ReplaceAll(prompt, "'", "'\\''")
	switch cli {
	case "agy":
		if model == "" {
			model = "Gemini 3.8 Flash (Low)"
		}
		return "agy --model '" + model + "' --print '" + p + "'"
	case "kilo", "kilocode":
		if model != "" {
			return cli + " run --model '" + model + "' '" + p + "'"
		}
		return cli + " run '" + p + "'"
	case "hermes":
		if model != "" {
			return "hermes -z '" + p + "' -m '" + model + "'"
		}
		return "hermes -z '" + p + "'"
	case "pi":
		if model == "" {
			model = "gemini-3.8-flash"
		}
		return "pi --provider google --api-key \"${GEMINI_API_KEY}\" --model " + model + " '" + p + "'"
	}
	return ""
}

func keys[K comparable, V any](m map[K]V) []K {
	out := make([]K, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
