package dispatch

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

// TaskType classifies what kind of task to route
type TaskType string

const (
	TaskGeneralChat      TaskType = "general_chat"
	TaskWebResearch      TaskType = "web_research"
	TaskCodeGeneration   TaskType = "code_generation"
	TaskCodeReview       TaskType = "code_review"
	TaskFileEditing      TaskType = "file_editing"
	TaskComplexAutonomous TaskType = "complex_autonomous"
	TaskBrowserAuto      TaskType = "browser_automation"
	TaskFastCheap        TaskType = "fast_cheap"
	TaskReasoningHeavy   TaskType = "reasoning_heavy"
	TaskDeepSeekCode     TaskType = "deepseek_code"
	TaskSchedulingCron   TaskType = "scheduling_cron"
)

// CLIStatus represents the operational status of a CLI
type CLIStatus string

const (
	StatusWorking CLIStatus = "working"
	StatusPartial CLIStatus = "partial"
	StatusBroken  CLIStatus = "broken"
)

// CLICapabilities holds what a CLI can do
type CLICapabilities struct {
	WebSearch      bool `yaml:"web_search"`
	WebBrowser     bool `yaml:"web_browser"`
	FileEdit       bool `yaml:"file_edit"`
	CodeExecute    bool `yaml:"code_execute"`
	RepoContext    bool `yaml:"repo_context"`
	MCP            bool `yaml:"mcp_support"`
	Memory         bool `yaml:"memory_graph"`
	CronScheduling bool `yaml:"cron_scheduling"`
	DelegateTasks  bool `yaml:"delegate_tasks"`
	Reasoning      bool `yaml:"reasoning"`
	MultiProvider  bool `yaml:"multi_provider"`
	AsyncExec      bool `yaml:"async_execution"`
}

// CLIInfo holds all info about a CLI from the YAML
type CLIInfo struct {
	Name         string            `yaml:"-"`
	Version      string            `yaml:"version"`
	Binary       string            `yaml:"binary"`
	Status       CLIStatus         `yaml:"status"`
	HeadlessCmd  string            `yaml:"headless_cmd"`
	DefaultModel string            `yaml:"default_model"`
	Notes        string            `yaml:"notes"`
	Tags         []string          `yaml:"tags"`
	Caps         CLICapabilities   `yaml:"capabilities"`
	Invocations  map[string]string `yaml:"invocation_patterns"`
}

// RoutingEntry defines primary + fallback for a task type
type RoutingEntry struct {
	Primary   string   `yaml:"primary"`
	Fallback  []string `yaml:"fallback"`
	ModelHint string   `yaml:"model_hint"`
	Reason    string   `yaml:"reason"`
}

// Capabilities is the top-level YAML structure
type Capabilities struct {
	Version     string                     `yaml:"version"`
	CLIs        map[string]CLIInfo         `yaml:"clis"`
	Routing     map[string]RoutingEntry    `yaml:"routing"`
	CapIndex    map[string][]string        `yaml:"capability_index"`
	Priority    []string                   `yaml:"dispatch_priority"`
}

// CLIStats tracks runtime success/failure for adaptive re-ranking
type CLIStats struct {
	mu          sync.RWMutex
	SuccessCount map[string]int
	FailCount    map[string]int
	AvgLatencyMs map[string]float64
	LastUsed     map[string]time.Time
}

// Dispatcher routes tasks to the best available CLI
type Dispatcher struct {
	caps    *Capabilities
	stats   *CLIStats
	envPath string // path to .env for key lookups
}

// LoadCapabilities reads and parses cli_capabilities.yaml
func LoadCapabilities(path string) (*Capabilities, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read capabilities: %w", err)
	}
	var caps Capabilities
	if err := yaml.Unmarshal(data, &caps); err != nil {
		return nil, fmt.Errorf("parse capabilities: %w", err)
	}
	// Inject names
	for name, info := range caps.CLIs {
		info.Name = name
		caps.CLIs[name] = info
	}
	return &caps, nil
}

// NewDispatcher creates a dispatcher, loading capabilities from the YAML
func NewDispatcher(capsPath, envPath string) (*Dispatcher, error) {
	caps, err := LoadCapabilities(capsPath)
	if err != nil {
		return nil, err
	}
	return &Dispatcher{
		caps: caps,
		stats: &CLIStats{
			SuccessCount: make(map[string]int),
			FailCount:    make(map[string]int),
			AvgLatencyMs: make(map[string]float64),
			LastUsed:     make(map[string]time.Time),
		},
		envPath: envPath,
	}, nil
}

// DefaultCapsPath returns the standard path for the capability YAML
func DefaultCapsPath() string {
	exe, _ := os.Executable()
	dir := filepath.Dir(exe)
	return filepath.Join(dir, "internal", "dispatch", "cli_capabilities.yaml")
}

// Route returns the best CLI for a task type, applying stats-based re-ranking
func (d *Dispatcher) Route(taskType TaskType) (string, string, []string) {
	entry, ok := d.caps.Routing[string(taskType)]
	if !ok {
		entry = d.caps.Routing["general_chat"]
	}

	chain := append([]string{entry.Primary}, entry.Fallback...)
	// Filter to working-only
	working := d.workingCLIs()
	var filtered []string
	for _, name := range chain {
		if working[name] {
			filtered = append(filtered, name)
		}
	}
	if len(filtered) == 0 {
		filtered = d.caps.CapIndex["working_now"]
	}
	if len(filtered) == 0 {
		return "", "", nil
	}
	return filtered[0], entry.ModelHint, filtered[1:]
}

// workingCLIs returns a set of CLI names with status=working
func (d *Dispatcher) workingCLIs() map[string]bool {
	out := make(map[string]bool)
	for name, info := range d.caps.CLIs {
		if info.Status == StatusWorking {
			out[name] = true
		}
	}
	return out
}

// BuildCommand constructs the shell command to invoke a CLI with a prompt
func (d *Dispatcher) BuildCommand(cliName, prompt, modelHint string) (string, error) {
	info, ok := d.caps.CLIs[cliName]
	if !ok {
		return "", fmt.Errorf("unknown CLI: %s", cliName)
	}
	if info.HeadlessCmd == "" {
		return "", fmt.Errorf("CLI %s has no headless command", cliName)
	}

	model := info.DefaultModel
	if modelHint != "" {
		model = modelHint
	}

	cmd := info.HeadlessCmd
	cmd = strings.ReplaceAll(cmd, "{prompt}", prompt)
	cmd = strings.ReplaceAll(cmd, "{model}", model)

	// Expand env vars
	cmd = os.ExpandEnv(cmd)

	return cmd, nil
}

// InvokeResult holds the output of a CLI invocation
type InvokeResult struct {
	CLI      string
	Output   string
	Err      error
	LatencyMs int64
}

// Invoke runs a CLI with a prompt, recording stats
func (d *Dispatcher) Invoke(ctx context.Context, cliName, prompt, modelHint string) InvokeResult {
	cmd, err := d.BuildCommand(cliName, prompt, modelHint)
	if err != nil {
		return InvokeResult{CLI: cliName, Err: err}
	}

	start := time.Now()
	out, err := exec.CommandContext(ctx, "bash", "-c", cmd).Output()
	latency := time.Since(start).Milliseconds()

	d.recordStats(cliName, err == nil, latency)

	if err != nil {
		return InvokeResult{CLI: cliName, Err: fmt.Errorf("invoke %s: %w", cliName, err), LatencyMs: latency}
	}
	return InvokeResult{CLI: cliName, Output: strings.TrimSpace(string(out)), LatencyMs: latency}
}

// InvokeWithFallback tries the primary CLI then falls back on failure
func (d *Dispatcher) InvokeWithFallback(ctx context.Context, taskType TaskType, prompt string) InvokeResult {
	primary, modelHint, fallbacks := d.Route(taskType)
	if primary == "" {
		return InvokeResult{Err: fmt.Errorf("no working CLIs available for task type %s", taskType)}
	}

	chain := append([]string{primary}, fallbacks...)
	for _, name := range chain {
		result := d.Invoke(ctx, name, prompt, modelHint)
		if result.Err == nil {
			return result
		}
	}
	return InvokeResult{Err: fmt.Errorf("all CLIs failed for task type %s", taskType)}
}

func (d *Dispatcher) recordStats(name string, success bool, latencyMs int64) {
	d.stats.mu.Lock()
	defer d.stats.mu.Unlock()
	if success {
		d.stats.SuccessCount[name]++
	} else {
		d.stats.FailCount[name]++
	}
	d.stats.LastUsed[name] = time.Now()
	// Exponential moving average for latency
	prev := d.stats.AvgLatencyMs[name]
	d.stats.AvgLatencyMs[name] = prev*0.8 + float64(latencyMs)*0.2
}

// GetStats returns a snapshot of CLI runtime stats
func (d *Dispatcher) GetStats() map[string]map[string]interface{} {
	d.stats.mu.RLock()
	defer d.stats.mu.RUnlock()
	out := make(map[string]map[string]interface{})
	for name := range d.caps.CLIs {
		out[name] = map[string]interface{}{
			"success":     d.stats.SuccessCount[name],
			"fail":        d.stats.FailCount[name],
			"avg_latency": d.stats.AvgLatencyMs[name],
			"last_used":   d.stats.LastUsed[name],
		}
	}
	return out
}

// ListWorking returns CLI names currently operational
func (d *Dispatcher) ListWorking() []string {
	working := d.workingCLIs()
	var out []string
	for _, name := range d.caps.Priority {
		if working[name] {
			out = append(out, name)
		}
	}
	return out
}

// GetCapabilities returns the loaded capabilities for a CLI
func (d *Dispatcher) GetCapabilities(cliName string) (CLIInfo, bool) {
	info, ok := d.caps.CLIs[cliName]
	return info, ok
}

// AllCLIs returns all CLI names
func (d *Dispatcher) AllCLIs() map[string]CLIInfo {
	return d.caps.CLIs
}

// DetectTaskType uses simple heuristics to classify a prompt
func DetectTaskType(prompt string) TaskType {
	lower := strings.ToLower(prompt)

	switch {
	case contains(lower, "browse", "website", "navigate", "click", "screenshot", "web page"):
		return TaskBrowserAuto
	case contains(lower, "search", "research", "find info", "latest", "news", "what is"):
		return TaskWebResearch
	case contains(lower, "schedule", "cron", "every day", "every hour", "recurring"):
		return TaskSchedulingCron
	case contains(lower, "review", "audit", "check code", "security", "vulnerabilities"):
		return TaskCodeReview
	case contains(lower, "edit file", "refactor", "rename", "move file", "delete"):
		return TaskFileEditing
	case contains(lower, "write code", "implement", "create function", "add feature", "fix bug"):
		return TaskCodeGeneration
	case contains(lower, "think", "reason", "explain", "analyze", "solve", "proof"):
		return TaskReasoningHeavy
	case contains(lower, "deepseek", "math", "algorithm", "optimize"):
		return TaskDeepSeekCode
	case contains(lower, "autonomous", "workflow", "multi-step", "orchestrate"):
		return TaskComplexAutonomous
	case len(prompt) < 100:
		return TaskFastCheap
	default:
		return TaskGeneralChat
	}
}

func contains(s string, terms ...string) bool {
	for _, t := range terms {
		if strings.Contains(s, t) {
			return true
		}
	}
	return false
}
