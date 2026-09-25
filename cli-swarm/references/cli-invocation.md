# Sub-agent CLI invocation reference

Verified via web search, July 2026. These tools ship fast — **always cross-check with
`<cli> --help` or `<cli> exec --help` before trusting this file**, especially flag names.

---

## Jules (Google AI coding agent)

Install: `npm install -g @google/jules-cli` (binary is `jules`). Requires Google auth — run
`jules auth login` once to authenticate. Uses `GOOGLE_API_KEY` or Google account credentials.

Non-interactive / headless mode:

```bash
# One-shot task — Jules runs the job asynchronously in Google infrastructure
jules run "refactor the auth module to use async/await throughout"

# Point at a specific directory
jules run --dir /path/to/project "add unit tests for src/brain/tool_registry.py"

# Specify which files Jules may touch
jules run --include "src/**" "add JSDoc to all exported functions"

# Check status of a running job (Jules jobs run async)
jules status

# Get output / apply patch from a completed job
jules apply
```

**Notes:**
- Jules is Google's agentic coding CLI — tasks run *in Google's infrastructure*, not locally.
  The local CLI submits the job and polls for results.
- Best for large-scope, multi-file work (UI/UX rebuilds, full module rewrites) where async
  execution is a benefit rather than a drawback.
- Always verify with `jules --help` before relying on flags — the CLI ships frequently.
- Wrap the *polling* step in `timeout <N>`; the initial `jules run` returns quickly since it
  just submits the job.
- After `jules apply`, treat the result like any other sub-agent: `git diff` and review before
  accepting.

---

## Codex (OpenAI)

Install: see https://github.com/openai/codex (npm/brew, varies by platform).

Non-interactive/headless mode is `codex exec`:

```bash
# one-shot, prints final message to stdout, progress to stderr
codex exec "implement input validation on the signup form" 

# JSON Lines event stream (useful for logging/parsing)
codex exec --json "..." 

# sandbox control — default is read-only; use workspace-write to let it edit files
codex exec --sandbox workspace-write "..."

# don't persist session rollout files
codex exec --ephemeral "..."

# resume a prior session
codex exec resume --last "continue from where you left off"
```

No approval prompts in `exec` mode — it runs fully autonomously under whatever `--sandbox`
policy you set, so pick the sandbox level deliberately rather than defaulting to the widest one.

---

## agy (Antigravity CLI, Google — successor to Gemini CLI)

Install: Google's official installer (see current docs; distributed as a single binary named
`agy`).

Non-interactive mode:

```bash
agy -p "refactor the auth module for clarity"
# or
agy --print "..."
```

**Known bug (as of mid-2026):** `agy -p`/`--print` can silently produce *no* stdout output (exit
code 0, empty output) when run from a non-TTY context — i.e. exactly the subprocess/pipe context
this skill uses. Symptoms: `agy -p "..." > out.txt 2>&1` produces a 0-byte file, or the process
hangs indefinitely waiting for an approval prompt that never renders.

Mitigations, in order of preference:
1. Add `--mode=accept-edits` (or the current equivalent auto-approve flag) so it doesn't hang
   waiting for an interactive approval.
2. Always check that stdout is non-empty after the call completes; treat empty output + exit 0
   as a **failure**, not a success — retry once, then fall back to a different CLI.
3. If failures persist, a community pty-wrapper (`agy-headless-bridge` on PyPI) exists
   specifically to work around this by giving `agy` a real pseudo-terminal. Only reach for this
   if the user's environment needs `agy` specifically and the simple mitigations above don't
   work — it's an extra dependency to install and trust.
4. Always wrap the call in `timeout <seconds>` regardless, since hangs are the documented
   failure mode.

---

## Kilo Code (`kilo`, open source, 500+ models via OpenRouter or your own keys)

Install: `npm install -g @kilocode/cli` (binary is `kilo`).

Non-interactive/autonomous mode:

```bash
kilo run "add input validation to the signup form"

# fully autonomous, no prompts, good for scripting
kilo run --auto "implement feature X"

# pick an agent persona / mode
kilo run --agent debug --file log.txt "diagnose this failure"

# structured output
kilo run --format json "..."
```

In `--auto` mode, if the underlying model asks a follow-up question, Kilo Code auto-responds
that it's running non-interactively and should decide autonomously — good for unattended runs,
but means it may make a judgment call you'd want to double check.

---

## Freebuff (free, ad-supported, built on the Codebuff framework)

Install: `npm install -g freebuff`.

Freebuff is primarily built as an **interactive chat REPL** (`freebuff` with no args drops you
into a session). At time of writing there is no clearly documented one-shot/non-interactive CLI
flag equivalent to `codex exec` or `kilo run`. Before relying on a specific invocation:

1. Run `freebuff --help` and look for a one-shot/prompt/batch flag (naming may have changed).
2. If no true non-interactive flag exists, the practical fallback is piping a prompt via stdin
   and using `timeout` to bound the run, then parsing stdout — treat this as less reliable than
   Codex/Kilo Code's dedicated headless modes, and verify output carefully.
3. Because it's free, it's still worth using as the default first choice for low-stakes,
   mechanical work — just budget extra time for the invocation to need adjustment per version.

---

## Cursor CLI (`cursor`, Cursor Pro subscription)

Install: download Cursor from https://cursor.com and install the `cursor` shell command via
**Cursor → Settings → Install cursor command** (or the equivalent menu item for your OS).

Non-interactive / headless mode:

```bash
# Run a task headless (no UI window) — agent applies edits directly to the workspace
cursor --headless "refactor the auth module to use async/await throughout"

# Point at a specific workspace directory
cursor --headless --workspace /path/to/project "add unit tests for utils/parse.ts"

# Limit which files the agent may touch
cursor --headless --include "src/**" "add JSDoc to all exported functions"
```

**Notes:**
- Requires an active Cursor Pro (or higher) subscription — the headless agent feature is not
  available on the free tier.
- The `--headless` flag is the current non-interactive entrypoint; run `cursor --help` to verify
  the flag hasn't changed (Cursor ships frequently).
- Cursor agents have full IDE context (symbol index, go-to-definition, etc.) — best choice when
  the task needs accurate cross-file navigation rather than raw text generation.
- Like all sub-agents, wrap in `timeout <N>` and capture both stdout and stderr.

---

## Mistral Vibe CLI (`vibe`, Mistral account / API key)

Install: `npm install -g @mistral-ai/vibe-cli` (binary is `vibe`). Requires a
`MISTRAL_API_KEY` environment variable.

Non-interactive mode:

```bash
# One-shot prompt, outputs result to stdout
vibe run "implement a rate-limiter middleware for Express"

# Point at a file or directory for context
vibe run --context src/api "add input validation to all POST handlers"

# Choose a specific Mistral model (default is usually the latest small model)
vibe run --model mistral-medium "..."

# JSON output for easier parsing
vibe run --format json "..."
```

**Notes:**
- Good cost/quality ratio for straightforward generation tasks; `mistral-small` is very cheap
  and fast for boilerplate.
- Check `vibe --help` before relying on any flag — the CLI is young and flags change between
  minor versions.
- If `MISTRAL_API_KEY` is not set, the CLI will fail immediately with an auth error (loud, not
  silent) — easy to detect and surface to the user.
- Wrap in `timeout <N>` as with all CLIs.

---

## Grok CLI (`grok` / `agent`, xAI)

Install: `npm install -g @xai/grok-cli` or follow xAI's current install docs. The binary may be
`grok` or `agent` depending on the version — check both with `command -v`.

Requires `GROK_API_KEY` or `XAI_API_KEY` in the environment.

Non-interactive mode (verify flags with `grok --help` / `agent --help` first):

```bash
# One-shot prompt — binary name depends on install
grok "implement a rate-limiter middleware for Express"
# or
agent "implement a rate-limiter middleware for Express"

# With explicit non-interactive/headless flag (check --help for current name)
grok --print "add input validation to the signup form"
agent --print "add input validation to the signup form"
```

**Notes:**
- The binary name is ambiguous — detect both `grok` and `agent` at startup and prefer whichever
  is present. If both exist, prefer `grok` as the more specific name.
- Always wrap in `timeout <N>` and verify stdout is non-empty (exit 0 + empty output = treat as
  failure, same mitigation as `agy`).
- Check `grok --help` or `agent --help` before relying on any flag — the CLI is new and ships
  frequently.

---

## General safety defaults for all eight

- Wrap every call in `timeout <N>` — headless hangs are a real, documented failure mode for at
  least `agy` and are a risk for any of these tools when their assumptions about the terminal
  are wrong.
- Default to the most restrictive sandbox/permission mode that still lets the task complete
  (read-only or workspace-write, not full-auto-destructive) unless the user has asked for full
  autonomy on this project.
- Capture both stdout and stderr; don't assume exit code 0 means the task actually did anything
  (see the `agy` silent-empty-output bug above — this class of failure is not unique to `agy`,
  just best-documented there).
