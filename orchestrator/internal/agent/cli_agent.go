package agent

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

// CLIAgent dispatches tasks to a named CLI sub-agent binary.
type CLIAgent struct {
	name    string
	binary  string
	timeout time.Duration
}

// New creates a CLIAgent.
// binary is the executable name (looked up via PATH).
func New(name, binary string, timeout time.Duration) *CLIAgent {
	if timeout == 0 {
		timeout = 5 * time.Minute
	}
	return &CLIAgent{name: name, binary: binary, timeout: timeout}
}

// Name returns the agent identifier.
func (a *CLIAgent) Name() string { return a.name }

// Run dispatches prompt to the CLI binary and returns (output, error).
// The CLI is invoked as: <binary> <prompt>
// The ANTHROPIC_BASE_URL environment variable is passed through so sub-agents
// route through the orchestrator proxy instead of hitting Anthropic directly.
func (a *CLIAgent) Run(ctx context.Context, prompt string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, a.timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, a.binary, prompt)
	cmd.Env = proxyEnv()

	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("agent %s: %w: %s", a.name, err, out)
	}
	return strings.TrimSpace(string(out)), nil
}

// Available reports whether the binary can be found in PATH.
func (a *CLIAgent) Available() bool {
	_, err := exec.LookPath(a.binary)
	return err == nil
}

// proxyEnv returns os.Environ() with ANTHROPIC_BASE_URL set from environment
// or defaulting to the local proxy.
func proxyEnv() []string {
	env := os.Environ()
	for _, e := range env {
		if strings.HasPrefix(e, "ANTHROPIC_BASE_URL=") {
			return env
		}
	}
	// Default to local proxy
	return append(env, "ANTHROPIC_BASE_URL=http://localhost:8080")
}
