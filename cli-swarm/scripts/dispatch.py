#!/usr/bin/env python3
"""Dispatch a task to a sub-agent CLI or API provider with automatic fallback.

Usage:
    # Single provider
    python3 dispatch.py --cli atessa-swe --task "add validation" --prompt "..." --log

    # Named chain from providers.json
    python3 dispatch.py --chain code --task "add validation" --prompt "..."

    # Custom chain
    python3 dispatch.py --chain groq,cerebras,atessa-swe,openrouter-deepseek-r1,aws-bedrock \\
        --task "..." --prompt "..."

    # Load keys from jarvis .env automatically
    python3 dispatch.py --env-file D:/pRoG/jarvis/.env --chain code --prompt "..."

    # Interactive
    python3 dispatch.py --interactive --log

    # List all providers / chains
    python3 dispatch.py --list-providers
    python3 dispatch.py --list-chains

Named chains (defined in references/providers.json):
    default       free→cheap→strong proxy→cloud
    code          SWE+code-specialist models first
    strongest     best models regardless of cost
    fastest_free  groq + cerebras only
    reasoning     deepseek-r1 and reasoning models
    proxy_explore all proxy aggregators

Auto env loading: looks for D:/pRoG/jarvis/.env, then cwd/.env, then ~/.env
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

SKILL_DIR = Path(__file__).parent.parent
DETECT_SH = SKILL_DIR / "scripts" / "detect_agents.sh"
LOG_SCRIPT = SKILL_DIR / "scripts" / "log_delegation.py"
PROVIDERS_JSON = SKILL_DIR / "references" / "providers.json"

# Jarvis .env default locations (checked in order)
DEFAULT_ENV_PATHS = [
    r"D:\pRoG\jarvis\.env",
    Path.home() / "pRoG" / "jarvis" / ".env",
    Path.cwd() / ".env",
]

KNOWN_CLIS = [
    "freebuff", "kilo", "codex", "agy", "cursor",
    "vibe", "grok", "jules", "cline", "hermes", "opencode",
]

LIMIT_PATTERNS = [
    "rate limit", "ratelimit", "rate_limit",
    "quota exceeded", "quota_exceeded",
    "too many requests", "429",
    "unauthorized", "401", "invalid api key",
    "authentication failed", "auth failed",
    "billing", "out of credits", "insufficient credits",
    "resource exhausted", "insufficient_quota",
    "exceeded your current quota", "account suspended",
    "invalid_api_key", "access denied",
]

CLI_INVOCATION = {
    "codex":    lambda p, cwd: ["codex", "exec", "--approve-for-me", p],
    "kilo":     lambda p, cwd: ["kilo", "run", "--auto", "--model", "kilo/nvidia/nemotron-3-ultra-550b-a55b:free", p],
    "agy":      lambda p, cwd: ["agy", "--dangerously-skip-permissions", "--model", "gemini-3.8-flash-low", "--add-dir", str(cwd), "--print", p],
    "freebuff": lambda p, cwd: ["freebuff", p],
    "cursor":   lambda p, cwd: ["cursor-agent", "--headless", p],
    "vibe":     lambda p, cwd: ["vibe", "-p", p, "--auto-approve"],
    "grok":     lambda p, cwd: ["grok", "--always-approve", "-p", p],
    "jules":    lambda p, cwd: ["jules", "new", p],
    "cline":    lambda p, cwd: ["cline", "--act", "--yolo", p],
    "hermes":   lambda p, cwd: ["hermes", p],
    "opencode": lambda p, cwd: ["opencode", "run", "--model", "opencode/space-bunny-free", p],
}

# Per-CLI env overrides applied on top of os.environ.
# Use empty string "" to unset a key (prevents loaded .env values from interfering).
CLI_ENV_OVERRIDES: dict[str, dict] = {
    "vibe": {"MISTRAL_API_KEY": ""},   # force vibe to use its built-in free model
    "cline": {"CI": "true"},           # suppress Ink TUI renderer crash without real TTY
}

CODING_SYSTEM_PROMPT = (
    "You are a coding sub-agent. Implement the requested task directly and completely. "
    "For file changes, output each file in a fenced code block with the path as the language tag:\n"
    "```path/to/file.py\n<full file content>\n```\n"
    "Output code only. No explanations unless the task explicitly asks for them."
)


# ── .env loader ────────────────────────────────────────────────────────────────

def load_env_file(path: str | Path | None = None):
    """Load a .env file into os.environ (does not overwrite already-set vars)."""
    candidates = [path] if path else DEFAULT_ENV_PATHS
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            with open(candidate) as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, _, v = line.partition("=")
                    k, v = k.strip(), v.strip()
                    if k and v and not os.environ.get(k):
                        os.environ[k] = v
            return str(candidate)
    return None


# ── Provider registry ──────────────────────────────────────────────────────────

def load_providers() -> dict:
    try:
        data = json.loads(PROVIDERS_JSON.read_text())
        return {p["id"]: p for p in data.get("providers", []) if "id" in p}
    except Exception:
        return {}


def load_chains(providers_data: dict | None = None) -> dict:
    if providers_data is None:
        try:
            providers_data = json.loads(PROVIDERS_JSON.read_text())
        except Exception:
            return {}
    return providers_data.get("fallback_chains", {})


def provider_is_available(prov: dict) -> bool:
    env = prov.get("api_key_env")
    if not env:
        return False
    if not os.environ.get(env):
        return False
    # For aws-bedrock, also check the extra env vars
    for extra in prov.get("extra_env", []):
        if not os.environ.get(extra):
            return False
    return True


def get_detected_clis() -> dict:
    try:
        result = subprocess.run(["bash", str(DETECT_SH)], capture_output=True, text=True, timeout=15)
        return json.loads(result.stdout)
    except Exception:
        pass
    # Python-native fallback (works on Windows where the bash script times out)
    import shutil
    aliases = {"kilo": ["kilo", "kilocode"], "grok": ["grok", "agent"]}
    return {cli: any(shutil.which(c) for c in aliases.get(cli, [cli])) for cli in KNOWN_CLIS}


def get_available_clis(detected: dict) -> list:
    available = [c for c in KNOWN_CLIS if detected.get(c)]
    dynamic = detected.get("dynamic_agents", {})
    if isinstance(dynamic, dict):
        available.extend(k for k in dynamic if k not in available)
    return available


def get_available_providers(providers: dict) -> list:
    return [pid for pid, p in providers.items() if provider_is_available(p)]


# ── Handlers ───────────────────────────────────────────────────────────────────

def call_openai_compat(prov: dict, prompt: str, cwd: Path, timeout: int) -> dict:
    try:
        import openai
    except ImportError:
        return {"exit_code": 1, "stdout": "", "stderr": "pip install openai", "duration": 0}

    api_key = os.environ.get(prov["api_key_env"], "")
    if not api_key:
        return {"exit_code": 1, "stdout": "", "stderr": f"{prov['api_key_env']} not set", "duration": 0}

    start = time.time()
    try:
        client = openai.OpenAI(api_key=api_key, base_url=prov["base_url"])
        resp = client.chat.completions.create(
            model=prov["model"],
            messages=[
                {"role": "system", "content": CODING_SYSTEM_PROMPT},
                {"role": "user", "content": f"Working directory: {cwd}\n\nTask: {prompt}"},
            ],
            timeout=timeout,
        )
        out = resp.choices[0].message.content or ""
        return {"exit_code": 0, "stdout": out, "stderr": "", "duration": round(time.time()-start, 1)}
    except Exception as e:
        return {"exit_code": 1, "stdout": "", "stderr": str(e), "duration": round(time.time()-start, 1)}


def call_anthropic_sdk(prov: dict, prompt: str, cwd: Path, timeout: int) -> dict:
    try:
        import anthropic
    except ImportError:
        return {"exit_code": 1, "stdout": "", "stderr": "pip install anthropic", "duration": 0}

    api_key = os.environ.get(prov.get("api_key_env", "ANTHROPIC_API_KEY"), "")
    if not api_key:
        return {"exit_code": 1, "stdout": "", "stderr": "ANTHROPIC_API_KEY not set", "duration": 0}

    start = time.time()
    try:
        client = anthropic.Anthropic(api_key=api_key)
        resp = client.messages.create(
            model=prov.get("model", "claude-opus-5"),
            max_tokens=8096,
            system=CODING_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": f"Working directory: {cwd}\n\nTask: {prompt}"}],
        )
        out = resp.content[0].text if resp.content else ""
        return {"exit_code": 0, "stdout": out, "stderr": "", "duration": round(time.time()-start, 1)}
    except Exception as e:
        return {"exit_code": 1, "stdout": "", "stderr": str(e), "duration": round(time.time()-start, 1)}


def call_aws_bedrock(prov: dict, prompt: str, cwd: Path, timeout: int) -> dict:
    try:
        import boto3, json as _json
    except ImportError:
        return {"exit_code": 1, "stdout": "", "stderr": "pip install boto3", "duration": 0}

    region = os.environ.get("AWS_REGION_NAME", "us-east-1")
    start = time.time()
    try:
        client = boto3.client(
            "bedrock-runtime",
            region_name=region,
            aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
        )
        body = _json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 8096,
            "system": CODING_SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": f"Working directory: {cwd}\n\nTask: {prompt}"}],
        })
        resp = client.invoke_model(modelId=prov["model"], body=body)
        result = _json.loads(resp["body"].read())
        out = result.get("content", [{}])[0].get("text", "")
        return {"exit_code": 0, "stdout": out, "stderr": "", "duration": round(time.time()-start, 1)}
    except Exception as e:
        return {"exit_code": 1, "stdout": "", "stderr": str(e), "duration": round(time.time()-start, 1)}


def call_api_provider(prov: dict, prompt: str, cwd: Path, timeout: int, dry_run: bool) -> dict:
    if dry_run:
        _print_status(f"[dry-run] API call: {prov['label']} / {prov['model']}")
        return {"exit_code": 0, "stdout": "[dry-run]", "stderr": "", "duration": 0}

    handler = prov.get("handler", "openai-compat")
    if handler == "anthropic-sdk":
        return call_anthropic_sdk(prov, prompt, cwd, timeout)
    elif handler == "aws-bedrock":
        return call_aws_bedrock(prov, prompt, cwd, timeout)
    else:
        return call_openai_compat(prov, prompt, cwd, timeout)


def run_cli(cli: str, prompt: str, cwd: Path, timeout: int, dry_run: bool) -> dict:
    import shutil as _shutil
    cmd_fn = CLI_INVOCATION.get(cli)
    if not cmd_fn:
        return {"exit_code": 1, "stdout": "", "stderr": f"No invocation for '{cli}'", "duration": 0}
    cmd = list(cmd_fn(prompt, cwd))
    # Resolve the binary to its full path so Python subprocess finds .cmd/.exe on Windows
    resolved = _shutil.which(cmd[0])
    if resolved:
        cmd[0] = resolved
    if dry_run:
        _print_status(f"[dry-run] CLI: {' '.join(str(c) for c in cmd)}")
        return {"exit_code": 0, "stdout": "[dry-run]", "stderr": "", "duration": 0}
    start = time.time()
    try:
        extra_env = {"PYTHONIOENCODING": "utf-8", **CLI_ENV_OVERRIDES.get(cli, {})}
        merged_env = {k: v for k, v in {**os.environ, **extra_env}.items() if v != ""}
        r = subprocess.run(cmd, capture_output=True, stdin=subprocess.DEVNULL,
                           timeout=timeout, cwd=str(cwd), env=merged_env)
        stdout = (r.stdout or b"").decode("utf-8", errors="replace")
        stderr = (r.stderr or b"").decode("utf-8", errors="replace")
        return {"exit_code": r.returncode, "stdout": stdout, "stderr": stderr,
                "duration": round(time.time()-start, 1), "cmd": cmd}
    except subprocess.TimeoutExpired:
        return {"exit_code": -1, "stdout": "", "stderr": f"Timed out after {timeout}s",
                "duration": round(time.time()-start, 1)}
    except FileNotFoundError:
        return {"exit_code": 127, "stdout": "", "stderr": f"CLI '{cli}' not found", "duration": 0}


def run_single(name: str, prompt: str, cwd: Path, timeout: int, dry_run: bool, providers: dict) -> dict:
    if name in providers:
        return call_api_provider(providers[name], prompt, cwd, timeout, dry_run)
    return run_cli(name, prompt, cwd, timeout, dry_run)


# ── Failure detection ──────────────────────────────────────────────────────────

def is_limit_error(result: dict) -> bool:
    combined = (result.get("stdout", "") + result.get("stderr", "")).lower()
    return any(p in combined for p in LIMIT_PATTERNS)


def is_empty_success(result: dict) -> bool:
    return (result["exit_code"] == 0
            and not result.get("stdout", "").strip()
            and not result.get("stderr", "").strip())


# ── Chain execution ────────────────────────────────────────────────────────────

def run_with_chain(chain: list, prompt: str, cwd: Path, timeout: int,
                   dry_run: bool, providers: dict) -> tuple:
    last_result = None
    for i, name in enumerate(chain):
        is_last = i == len(chain) - 1
        label = providers[name]["label"] if name in providers else name
        _print_status(f"[{i+1}/{len(chain)}] {label}{'  (last)' if is_last else ''}...")

        result = run_single(name, prompt, cwd, timeout, dry_run, providers)
        last_result = result

        if dry_run:
            return name, result

        ok = result["exit_code"] == 0 and not is_empty_success(result)
        if ok:
            _print_status(f"  ✓ {label} succeeded in {result.get('duration', 0):.1f}s")
            return name, result

        if is_empty_success(result):
            reason = "empty output (silent-success bug)"
        elif is_limit_error(result):
            reason = "rate limit / quota / auth error"
        else:
            reason = f"exit {result['exit_code']}"
            if result.get("stderr"):
                reason += f": {result['stderr'][:120]}"

        _print_status(f"  ✗ {label}: {reason}", warn=True)
        if not is_last:
            next_label = providers[chain[i+1]]["label"] if chain[i+1] in providers else chain[i+1]
            _print_status(f"  → falling back to {next_label}")

    _print_status("  ✗ all providers exhausted", warn=True)
    return chain[-1], last_result


# ── Output & UI ────────────────────────────────────────────────────────────────

def _print_status(msg: str, warn: bool = False):
    try:
        from rich.console import Console
        Console().print(f"[yellow]{msg}[/yellow]" if warn else f"[dim]{msg}[/dim]")
    except ImportError:
        print(msg, file=sys.stderr)


def print_result(name: str, result: dict, providers: dict):
    label = providers[name]["label"] if name in providers else name
    try:
        from rich.console import Console
        from rich.panel import Panel
        console = Console()
        sc = "green" if result["exit_code"] == 0 else "red"
        st = "success" if result["exit_code"] == 0 else f"exit {result['exit_code']}"
        console.print(f"\n[bold]Result:[/bold] [cyan]{label}[/cyan] [{sc}]{st}[/{sc}] in {result.get('duration', 0):.1f}s\n")
        stdout = result.get("stdout", "").strip()
        stderr = result.get("stderr", "").strip()
        if stdout:
            preview = stdout[:5000] + ("[…truncated]" if len(stdout) > 5000 else "")
            console.print(Panel(preview, title="[green]output[/green]", border_style="green"))
        if stderr:
            console.print(Panel(stderr[:2000], title="[yellow]stderr[/yellow]", border_style="yellow"))
        if not stdout and not stderr:
            console.print("[dim](no output)[/dim]")
        if result["exit_code"] == 0 and not stdout:
            console.print("[yellow]⚠ exit 0, empty output — verify changes were applied[/yellow]")
    except ImportError:
        print(f"\n{label}  exit={result['exit_code']}  {result.get('duration', 0):.1f}s")
        if result.get("stdout"):
            print(result["stdout"])
        if result.get("stderr"):
            print("STDERR:", result["stderr"])


def list_providers_cmd(providers: dict, available_clis: list):
    try:
        from rich.console import Console
        from rich.table import Table
        from rich import box
        console = Console()
        table = Table(title="[bold cyan]All Providers[/bold cyan]", box=box.ROUNDED)
        table.add_column("ID", style="bold cyan", no_wrap=True)
        table.add_column("Label")
        table.add_column("Model", style="dim")
        table.add_column("Type", justify="center")
        table.add_column("Ready", justify="center")
        table.add_column("Cost")
        for cli in KNOWN_CLIS:
            avail = "[green]✓[/green]" if cli in available_clis else "[red]✗[/red]"
            table.add_row(cli, cli, "", "[dim]CLI[/dim]", avail, "[dim]-[/dim]")
        for pid, p in providers.items():
            ok = provider_is_available(p)
            key_env = p.get("api_key_env", "")
            avail = "[green]✓[/green]" if ok else f"[red]✗[/red] [dim](set {key_env})[/dim]"
            ct = p.get("cost_tier", "?")
            cc = {"free": "green", "cheap": "green", "moderate": "yellow",
                  "paid": "red", "unknown": "dim"}.get(ct, "white")
            table.add_row(pid, p.get("label", ""), p.get("model", ""), "[cyan]API[/cyan]",
                          avail, f"[{cc}]{ct}[/{cc}]")
        console.print(table)
        ready = sum(1 for p in providers.values() if provider_is_available(p))
        console.print(f"\n[dim]{ready}/{len(providers)} API providers ready | Edit references/providers.json to add more.[/dim]\n")
    except ImportError:
        for pid, p in providers.items():
            ok = "✓" if provider_is_available(p) else "✗"
            print(f"  {ok} {pid:30} {p.get('label', '')}")


def list_chains_cmd():
    try:
        data = json.loads(PROVIDERS_JSON.read_text())
    except Exception:
        print("Could not load providers.json")
        return
    chains = data.get("fallback_chains", {})
    try:
        from rich.console import Console
        from rich.table import Table
        from rich import box
        console = Console()
        table = Table(title="[bold cyan]Named Fallback Chains[/bold cyan]", box=box.ROUNDED)
        table.add_column("Chain", style="bold cyan")
        table.add_column("Providers (in order)")
        for name, members in chains.items():
            table.add_row(name, " → ".join(members))
        console.print(table)
        console.print("\n[dim]Use with: python3 dispatch.py --chain <name>[/dim]\n")
    except ImportError:
        for name, members in chains.items():
            print(f"  {name}: {' → '.join(members)}")


def pick_interactive(all_available: list, providers: dict) -> str:
    def label(n): return providers[n]["label"] if n in providers else n
    try:
        from rich.console import Console
        from rich.prompt import Prompt
        console = Console()
        console.print("\n[bold cyan]Available:[/bold cyan]")
        for i, n in enumerate(all_available, 1):
            kind = "[cyan]API[/cyan]" if n in providers else "[dim]CLI[/dim]"
            console.print(f"  [dim]{i}.[/dim] {kind} [green]{label(n)}[/green]")
        choice = Prompt.ask("Pick", choices=[str(i) for i in range(1, len(all_available)+1)])
        return all_available[int(choice)-1]
    except ImportError:
        for i, n in enumerate(all_available, 1):
            print(f"  {i}. {label(n)}")
        return all_available[int(input("Pick: ").strip())-1]


# ── Logging ────────────────────────────────────────────────────────────────────

def log_result(name: str, task: str, result: dict, loc_changed: int):
    status = "success" if result["exit_code"] == 0 else "fail"
    if result["exit_code"] == 0 and not result.get("stdout", "").strip():
        status = "partial"
    log_cli = name if name in {"codex", "agy", "kilo", "freebuff", "claude"} else "other"
    try:
        subprocess.run([
            sys.executable, str(LOG_SCRIPT),
            "--task", task, "--cli", log_cli, "--status", status,
            "--loc-changed", str(loc_changed),
            "--duration-seconds", str(result.get("duration", 0)),
            "--notes", f"actual_provider={name}; exit={result['exit_code']}",
        ], check=False)
    except Exception as e:
        print(f"[warn] log failed: {e}", file=sys.stderr)


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(
        description="Dispatch a task to a sub-agent CLI or API provider",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--cli", help="Single provider/CLI (e.g. atessa-swe, groq, deepseek)")
    ap.add_argument("--chain", help="Named chain OR comma-separated IDs (e.g. code, groq,cerebras,atessa-swe)")
    ap.add_argument("--task", help="Short task description")
    ap.add_argument("--prompt", help="Full prompt for the sub-agent")
    ap.add_argument("--timeout", type=int, default=300)
    ap.add_argument("--dir", default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--log", action="store_true", help="Append to delegation log")
    ap.add_argument("--loc-changed", type=int, default=0)
    ap.add_argument("--interactive", action="store_true")
    ap.add_argument("--list-providers", action="store_true")
    ap.add_argument("--list-chains", action="store_true")
    ap.add_argument("--env-file", default=None, help="Path to .env file (default: D:/pRoG/jarvis/.env)")
    args = ap.parse_args()

    # Load .env (jarvis path auto-detected)
    loaded_env = load_env_file(args.env_file)
    if loaded_env:
        _print_status(f"Loaded env: {loaded_env}")

    providers_raw = json.loads(PROVIDERS_JSON.read_text()) if PROVIDERS_JSON.exists() else {}
    providers = {p["id"]: p for p in providers_raw.get("providers", []) if "id" in p}
    chains = providers_raw.get("fallback_chains", {})

    detected = get_detected_clis()
    available_clis = get_available_clis(detected)
    available_providers = get_available_providers(providers)
    all_available = available_clis + [p for p in available_providers if p not in available_clis]

    if args.list_providers:
        list_providers_cmd(providers, available_clis)
        return
    if args.list_chains:
        list_chains_cmd()
        return

    prompt = args.prompt
    task = args.task

    if args.interactive or (not args.cli and not args.chain and not prompt):
        if not args.cli and not args.chain:
            if not all_available:
                print("No providers available.")
                sys.exit(1)
            args.cli = pick_interactive(all_available, providers)
        prompt = prompt or input("Prompt: ").strip()
        task = task or input("Task description: ").strip() or prompt[:60]

    if not prompt:
        print("--prompt required")
        sys.exit(1)

    cwd = Path(args.dir) if args.dir else Path.cwd()

    # Resolve chain
    if args.chain:
        # Check if it's a named chain first
        if args.chain in chains:
            chain = chains[args.chain]
            _print_status(f"Using named chain '{args.chain}': {' → '.join(chain)}")
        else:
            chain = [c.strip() for c in args.chain.split(",") if c.strip()]
    elif args.cli:
        chain = [args.cli]
    else:
        # Use default chain from providers.json
        default_chain = chains.get("default", [])
        chain = [c for c in default_chain if c in all_available] or all_available[:5]

    # Warn and filter unavailable entries (skip for dry-run)
    if not args.dry_run:
        for c in chain:
            if c not in all_available:
                if c in providers:
                    p_info = providers[c]
                    _print_status(f"[skip] '{c}' — set {p_info.get('api_key_env', '?')} to enable", warn=True)
                else:
                    _print_status(f"[skip] '{c}' not installed", warn=True)
        chain = [c for c in chain if c in all_available]
        if not chain:
            print("No available providers. Run --list-providers to see options.")
            sys.exit(1)

    used, result = run_with_chain(chain, prompt, cwd, args.timeout, args.dry_run, providers)
    if result is None:
        result = {"exit_code": 1, "stdout": "", "stderr": "no result returned", "duration": 0}
    print_result(used, result, providers)

    if args.log and not args.dry_run:
        log_result(used, task or prompt, result, args.loc_changed)
        print("[logged]")

    sys.exit(0 if result["exit_code"] == 0 else 1)


if __name__ == "__main__":
    main()
