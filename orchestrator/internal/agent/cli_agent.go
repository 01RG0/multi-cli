package agent

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
	"time"
)

// CLIAgent dispatches tasks to a named CLI sub-agent binary.
type CLIAgent struct {
	name    string
	binary  string
	args    []string // extra flags prepended before the prompt
	timeout time.Duration
}

// New creates a CLIAgent.
// binary is the executable name (looked up via PATH).
func New(name, binary string, timeout time.Duration) *CLIAgent {
	if timeout == 0 {
		timeout = 5 * time.Minute
	}
	a := &CLIAgent{name: name, binary: binary, timeout: timeout}
	// Per-CLI headless flags so TUI CLIs run non-interactively
	switch name {
	case "vibe":
		a.args = []string{"--yolo", "--output", "text"}
	case "codex":
		a.args = []string{"--approve-for-me"}
	case "agy":
		a.args = []string{"--prompt"}
	case "grok", "agent":
		a.args = []string{"-p"}
	case "cline":
		a.args = []string{"--message"}
	}
	return a
}

// Name returns the agent identifier.
func (a *CLIAgent) Name() string { return a.name }

// Run dispatches prompt to the CLI binary and returns (output, error).
// On Linux, CLIs are wrapped with `script -qc` to provide a PTY so that
// tools that check isatty(stdin) don't refuse to run headlessly.
func (a *CLIAgent) Run(ctx context.Context, prompt string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, a.timeout)
	defer cancel()

	var cmd *exec.Cmd
	argv := append(a.args, prompt)

	if runtime.GOOS == "linux" {
		// `script -qc "<cmd>" /dev/null` allocates a PTY without needing
		// an external Go library — available on all Linux distros.
		fullCmd := shellQuote(a.binary) + " " + shellQuoteSlice(argv)
		cmd = exec.CommandContext(ctx, "script", "-qc", fullCmd, "/dev/null")
	} else {
		cmd = exec.CommandContext(ctx, a.binary, argv...)
	}
	cmd.Env = proxyEnv()

	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf

	if err := cmd.Run(); err != nil {
		return stripANSI(buf.String()), fmt.Errorf("agent %s: %w", a.name, err)
	}
	return strings.TrimSpace(stripANSI(buf.String())), nil
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
	return append(env, "ANTHROPIC_BASE_URL=http://localhost:8080")
}

var ansiEscape = regexp.MustCompile(`\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][A-Za-z0-9]`)

// stripANSI removes ANSI escape sequences from TUI output.
func stripANSI(s string) string {
	return ansiEscape.ReplaceAllString(s, "")
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

func shellQuoteSlice(args []string) string {
	quoted := make([]string, len(args))
	for i, a := range args {
		quoted[i] = shellQuote(a)
	}
	return strings.Join(quoted, " ")
}
