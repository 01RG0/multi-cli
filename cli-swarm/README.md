# Sub-Agent CLI Swarm

A Python dispatch system that fans out coding tasks to installed AI coding CLIs as sub-agents,
running them headless/non-interactively via subprocess.

---

## Verified CLI table (September 2026)

| CLI | Binary | Free model | Status | Notes |
|-----|--------|-----------|--------|-------|
| **codex** | `codex` | OpenAI free tier | Working | `--approve-for-me` flag; no `-s workspace-write` |
| **agy** | `agy` | Gemini 3.8 Flash | Working | `--dangerously-skip-permissions --model gemini-3.8-flash-low --print` |
| **kilo** | `kilo` | nvidia/nemotron-550b:free | Working | `run --auto --model kilo/nvidia/nemotron-3-ultra-550b-a55b:free` |
| **vibe** | `vibe` | Built-in free | Working | Must strip `MISTRAL_API_KEY` from env; use `CLI_ENV_OVERRIDES` |
| **grok** | `grok` | xAI free tier | Working | Flag is `-p` (short for `--single`), **not** `--print` |
| **opencode** | `opencode` | space-bunny-free | Working | `run --model opencode/space-bunny-free` |
| **cline** | `cline` | Needs valid key | Partial | Set `CI=true` env to suppress Ink TUI crash; returns 401 with expired groq key |
| **freebuff** | `freebuff` | Built-in (ad-supported) | No headless | Interactive TUI only; binary at `C:/Users/ahmed/.config/manicode/freebuff.exe`; no one-shot flag |
| **jules** | `jules` | Google account | Not tested | Async — submits to Google infra; `jules run` + `jules apply` |

---

## Key fixes discovered during testing

### Windows subprocess binary resolution
All npm CLIs install as `.CMD` files on Windows. Python `subprocess` cannot find them by bare
name. Fix: resolve via `shutil.which()` before building the command list.

```python
resolved = shutil.which(cmd[0])
if resolved:
    cmd[0] = resolved
```

### stdin blocking
CLIs that expect a TTY will block indefinitely when run from subprocess. Always pass
`stdin=subprocess.DEVNULL`.

### Unicode decode errors (cp1252)
CLIs emit ANSI/UTF-8 bytes; Windows default encoding is cp1252. Fix: use `capture_output=True`
(bytes mode) and decode manually.

```python
stdout = (r.stdout or b"").decode("utf-8", errors="replace")
stderr = (r.stderr or b"").decode("utf-8", errors="replace")
```

### vibe uses paid Mistral API when `MISTRAL_API_KEY` is in env
`MISTRAL_API_KEY` from `jarvis.env` causes vibe to route through the paid Mistral API instead
of its built-in free model. Strip it via `CLI_ENV_OVERRIDES`:

```python
CLI_ENV_OVERRIDES = {
    "vibe": {"MISTRAL_API_KEY": ""},   # "" = unset from subprocess env
    "cline": {"CI": "true"},           # suppress Ink/React TUI crash
}
```

### grok flag
Correct flag is `-p` (short for `--single`). The `--print` flag does not exist in grok CLI.

### cline Ink/React TUI crash
Error: `Text must be created inside of a text node`. This is React/Ink crashing because there's
no real TTY. Fix: set `CI=true` in the subprocess environment. cline still needs a valid API
key — the groq key in jarvis.env was expired/invalid at time of testing.

### kilo model
Default model `kilo/minimax/minimax-m2.1:free` not found. Use
`kilo/nvidia/nemotron-3-ultra-550b-a55b:free` with `--auto` flag for automatic free model
fallback.

### providers.json `_section` dividers
`providers.json` contains `_section` divider objects without an `id` key. Guard against them:

```python
if "id" not in p:
    continue
```

### detect_agents.sh times out on Windows
The bash script iterates all PATH directories, which is too slow on Windows (>15s). Fall back
to `shutil.which()` in Python:

```python
try:
    result = subprocess.run(["bash", str(DETECT_SH)], capture_output=True, text=True, timeout=15)
    return json.loads(result.stdout)
except Exception:
    import shutil
    return {cli: shutil.which(cli) is not None for cli in CLI_META}
```

---

## File layout

```
cli-swarm/
├── scripts/
│   ├── dispatch.py          # core dispatcher — invoke a CLI on a prompt
│   ├── status.py            # check which CLIs and providers are available
│   ├── log_delegation.py    # append a delegation record to the JSONL log
│   ├── dashboard.py         # Rich-formatted summary of the delegation log
│   ├── stream.py            # live-tail the delegation log
│   └── probe_provider.py    # probe a provider's /models endpoint, rank by code fitness
└── references/
    ├── providers.json        # all API providers with fallback chains
    └── cli-invocation.md     # verified headless invocation flags per CLI
```

The canonical source lives in `C:/Users/ahmed/.claude/skills/sub-agent-cli-swarm/`. This copy
is a snapshot for reference — update it when the skill is changed.

---

## Quick start

```bash
# Check what's installed and which providers have valid keys
python scripts/status.py

# Dispatch a task to the best available CLI
python scripts/dispatch.py "add input validation to the signup form"

# Dispatch to a specific CLI
python scripts/dispatch.py --cli kilo "refactor auth module"

# Use a provider chain instead of a CLI
python scripts/dispatch.py --chain code "add unit tests for utils/parse.py"

# View delegation history
python scripts/dashboard.py

# Probe which models are available on a provider
python scripts/probe_provider.py atessa-swe
```
