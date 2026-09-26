package agent

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

// LineCallback is called for each line of output produced by RunStreaming.
// agentID is the agent name, taskID is the task being executed,
// stream is "stdout" or "stderr", and line is the text (ANSI stripped).
type LineCallback func(agentID, taskID, stream, line string)

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
	case "cursor":
		a.args = []string{"--headless"}
	case "kilo":
		a.args = []string{"--non-interactive"}
	case "jules":
		a.args = []string{"--no-interactive"}
	case "researcher":
		a.args = []string{"--query"}
	case "debugger":
		a.args = []string{"--prompt"}
	case "hermes":
		// Nous Research Hermes agent - deep tool-use, reasoning and autonomous workflows
		if a.binary == "" {
			a.binary = "hermes"
		}
		a.args = []string{"--prompt"}
	case "deepseek":
		// TODO: confirm headless flags for DeepSeek CLI client
		a.args = []string{"--prompt"}
	case "harness":
		// TODO: confirm headless flags for Harness AI coding assistant CLI
		a.args = []string{"--message"}
	case "kimocode":
		// TODO: confirm headless flags for Kimo Code CLI
		a.args = []string{"--prompt"}
	case "pi":
		// TODO: confirm headless flags for Pi.ai (Inflection AI) CLI
		a.args = []string{"--prompt"}
	}
	return a
}

// Name returns the agent identifier.
func (a *CLIAgent) Name() string { return a.name }

// resolveCommand resolves the executable binary and argv arguments to run.
// For hermes, if the bare "hermes" binary is not in PATH, it falls back to
// "hermes-agent", "python -m hermes", or "node".
func (a *CLIAgent) resolveCommand(prompt string) (string, []string) {
	binary := a.binary
	var argv []string
	if a.name == "hermes" {
		if _, err := exec.LookPath(binary); err != nil {
			if p, err2 := exec.LookPath("hermes-agent"); err2 == nil {
				binary = p
			} else if py, err3 := exec.LookPath("python"); err3 == nil {
				binary = py
				argv = append(argv, "-m", "hermes")
			} else if py3, err4 := exec.LookPath("python3"); err4 == nil {
				binary = py3
				argv = append(argv, "-m", "hermes")
			} else if node, err5 := exec.LookPath("node"); err5 == nil {
				binary = node
				argv = append(argv, "-e", `require("hermes")`)
			}
		}
	}
	argv = append(argv, a.args...)
	argv = append(argv, prompt)
	return binary, argv
}

// Run dispatches prompt to the CLI binary and returns (output, error).
// On Linux, CLIs are wrapped with `script -qc` to provide a PTY so that
// tools that check isatty(stdin) don't refuse to run headlessly.
func (a *CLIAgent) Run(ctx context.Context, prompt string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, a.timeout)
	defer cancel()

	var cmd *exec.Cmd
	bin, argv := a.resolveCommand(prompt)

	if runtime.GOOS == "linux" {
		fullCmd := shellQuote(bin) + " " + shellQuoteSlice(argv)
		cmd = exec.CommandContext(ctx, "script", "-qc", fullCmd, "/dev/null")
	} else {
		cmd = exec.CommandContext(ctx, bin, argv...)
	}
	cmd.Env = proxyEnv(a.name)

	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf

	if err := cmd.Run(); err != nil {
		return stripANSI(buf.String()), fmt.Errorf("agent %s: %w", a.name, err)
	}
	return strings.TrimSpace(stripANSI(buf.String())), nil
}

// RunStreaming dispatches prompt to the CLI binary and calls onLine for each line
// written to stdout or stderr in real time. It collects all lines into a slice,
// waits for process exit, and returns the trimmed combined output.
// Run() continues to work unchanged.
func (a *CLIAgent) RunStreaming(ctx context.Context, taskID, prompt string, onLine LineCallback) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, a.timeout)
	defer cancel()

	bin, argv := a.resolveCommand(prompt)
	cmd := exec.CommandContext(ctx, bin, argv...)
	cmd.Env = proxyEnv(a.name)

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return "", fmt.Errorf("agent %s: stdout pipe: %w", a.name, err)
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return "", fmt.Errorf("agent %s: stderr pipe: %w", a.name, err)
	}

	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("agent %s: start: %w", a.name, err)
	}

	var (
		mu       sync.Mutex
		allLines []string
		wg       sync.WaitGroup
	)

	scanPipe := func(r io.Reader, stream string) {
		defer wg.Done()
		scanner := bufio.NewScanner(r)
		for scanner.Scan() {
			line := stripANSI(scanner.Text())
			if onLine != nil {
				onLine(a.name, taskID, stream, line)
			}
			mu.Lock()
			allLines = append(allLines, line)
			mu.Unlock()
		}
	}

	wg.Add(2)
	go scanPipe(stdoutPipe, "stdout")
	go scanPipe(stderrPipe, "stderr")
	wg.Wait()

	if err := cmd.Wait(); err != nil {
		combined := strings.Join(allLines, "\n")
		return combined, fmt.Errorf("agent %s: %w", a.name, err)
	}
	return strings.TrimSpace(strings.Join(allLines, "\n")), nil
}

// Available reports whether the binary can be found in PATH or fallback.
func (a *CLIAgent) Available() bool {
	if _, err := exec.LookPath(a.binary); err == nil {
		return true
	}
	if a.name == "hermes" {
		if _, err := exec.LookPath("hermes-agent"); err == nil {
			return true
		}
		if _, err := exec.LookPath("python"); err == nil {
			return true
		}
		if _, err := exec.LookPath("python3"); err == nil {
			return true
		}
		if _, err := exec.LookPath("node"); err == nil {
			return true
		}
	}
	return false
}

// proxyEnv returns os.Environ() with ANTHROPIC_BASE_URL and OPENAI_BASE_URL set to the
// per-agent proxy path so each agent uses its own provider chain.
func proxyEnv(agentName string) []string {
	env := os.Environ()
	baseURL := fmt.Sprintf("http://localhost:8080/agent/%s", agentName)
	// Override any existing ANTHROPIC_BASE_URL and OPENAI_BASE_URL
	result := make([]string, 0, len(env)+2)
	for _, e := range env {
		if strings.HasPrefix(e, "ANTHROPIC_BASE_URL=") || strings.HasPrefix(e, "OPENAI_BASE_URL=") {
			continue
		}
		result = append(result, e)
	}
	result = append(result, "ANTHROPIC_BASE_URL="+baseURL)
	result = append(result, "OPENAI_BASE_URL="+baseURL)
	return result
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
