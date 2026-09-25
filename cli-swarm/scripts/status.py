#!/usr/bin/env python3
"""Show a Rich-formatted agent status panel.

Usage:
    python3 status.py [--json]

Runs detect_agents.sh and displays a table of which CLIs are installed,
their auth state (if detectable), and quick-check tips.
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


SKILL_DIR = Path(__file__).parent.parent
DETECT_SH = SKILL_DIR / "scripts" / "detect_agents.sh"
PROVIDERS_JSON = SKILL_DIR / "references" / "providers.json"

CLI_META = {
    "codex":    {"label": "Codex (OpenAI)",      "auth_env": "OPENAI_API_KEY",    "cost": "paid"},
    "agy":      {"label": "agy (Google/Gemini)", "auth_env": None,                "cost": "quota"},
    "kilo":     {"label": "Kilo Code",           "auth_env": "OPENROUTER_API_KEY","cost": "free/cheap"},
    "freebuff": {"label": "Freebuff",            "auth_env": None,                "cost": "free"},
    "cursor":   {"label": "Cursor CLI",          "auth_env": None,                "cost": "subscription"},
    "vibe":     {"label": "Mistral Vibe",        "auth_env": "MISTRAL_API_KEY",   "cost": "quota"},
    "grok":     {"label": "Grok (xAI)",          "auth_env": ["GROK_API_KEY", "XAI_API_KEY"], "cost": "quota"},
    "jules":    {"label": "Jules (Google)",      "auth_env": None,                "cost": "quota"},
    "hermes":   {"label": "Hermes",              "auth_env": None,                "cost": "unknown"},
    "cline":    {"label": "Cline",               "auth_env": None,                "cost": "unknown"},
    "opencode": {"label": "OpenCode",            "auth_env": None,                "cost": "unknown"},
}


def load_api_providers() -> list:
    try:
        data = json.loads(PROVIDERS_JSON.read_text())
        return data.get("providers", [])
    except Exception:
        return []


def run_detect() -> dict:
    try:
        result = subprocess.run(
            ["bash", str(DETECT_SH)],
            capture_output=True, text=True, timeout=15
        )
        return json.loads(result.stdout)
    except Exception as e:
        print(f"[warn] detect_agents.sh failed: {e}", file=sys.stderr)

    # Python-native fallback (works on Windows where the bash script times out)
    import shutil
    detected: dict = {}
    aliases = {"kilo": ["kilo", "kilocode"], "grok": ["grok", "agent"]}
    for cli in CLI_META:
        candidates = aliases.get(cli, [cli])
        detected[cli] = any(shutil.which(c) is not None for c in candidates)
    return detected


def check_auth(cli: str) -> str:
    meta = CLI_META.get(cli, {})
    env_key = meta.get("auth_env")
    if env_key is None:
        return "n/a"
    if isinstance(env_key, list):
        return "ok" if any(os.environ.get(k) for k in env_key) else "missing"
    return "ok" if os.environ.get(env_key) else "missing"


def print_plain(detected: dict):
    print(f"\n{'CLI':<14} {'Label':<26} {'Installed':<12} {'Auth':<10} {'Cost'}")
    print("-" * 76)
    for cli, meta in CLI_META.items():
        installed = detected.get(cli, False)
        auth = check_auth(cli) if installed else "-"
        mark = "yes" if installed else "no"
        print(f"{cli:<14} {meta['label']:<26} {mark:<12} {auth:<10} {meta['cost']}")
    dynamic = detected.get("dynamic_agents", {})
    if dynamic:
        print("\nDynamically detected:")
        for cli in dynamic:
            print(f"  {cli}")
    print()


def print_rich(detected: dict):
    try:
        from rich.console import Console
        from rich.table import Table
        from rich import box
    except ImportError:
        print("[info] rich not installed, falling back to plain output (pip install rich)")
        print_plain(detected)
        return

    console = Console()
    table = Table(
        title="[bold cyan]Sub-Agent CLI Status[/bold cyan]",
        box=box.ROUNDED,
        highlight=True,
        show_lines=False,
    )
    table.add_column("CLI", style="bold", no_wrap=True)
    table.add_column("Label", style="dim")
    table.add_column("Installed", justify="center")
    table.add_column("Auth", justify="center")
    table.add_column("Cost", justify="right")

    for cli, meta in CLI_META.items():
        installed = detected.get(cli, False)
        auth = check_auth(cli) if installed else "-"

        inst_cell = "[green]✓ yes[/green]" if installed else "[red]✗ no[/red]"
        if auth == "ok":
            auth_cell = "[green]ok[/green]"
        elif auth == "missing":
            auth_cell = "[yellow]missing[/yellow]"
        else:
            auth_cell = "[dim]-[/dim]"

        cost_colors = {"free": "green", "free/cheap": "green", "paid": "red",
                       "quota": "yellow", "subscription": "magenta", "unknown": "dim"}
        cost_color = cost_colors.get(meta["cost"], "white")
        cost_cell = f"[{cost_color}]{meta['cost']}[/{cost_color}]"

        table.add_row(cli, meta["label"], inst_cell, auth_cell, cost_cell)

    dynamic = detected.get("dynamic_agents", {})
    if isinstance(dynamic, dict) and dynamic:
        for cli in dynamic:
            table.add_row(cli, "[italic]auto-detected[/italic]", "[green]✓ yes[/green]", "[dim]-[/dim]", "[dim]?[/dim]")

    console.print()
    console.print(table)

    installed_count = sum(1 for k in CLI_META if detected.get(k))
    if installed_count == 0:
        console.print("[bold red]No CLIs installed.[/bold red] Run install commands from references/cli-invocation.md\n")
    else:
        console.print(f"[dim]{installed_count} CLI(s) available. Use [bold]dispatch.py[/bold] to send a task.[/dim]\n")


def print_api_providers_rich(providers: list):
    try:
        from rich.console import Console
        from rich.table import Table
        from rich import box
        console = Console()

        table = Table(
            title="[bold cyan]API Providers (references/providers.json)[/bold cyan]",
            box=box.ROUNDED, highlight=True, show_lines=False,
        )
        table.add_column("ID", style="bold", no_wrap=True)
        table.add_column("Label", style="dim")
        table.add_column("Model")
        table.add_column("Key set", justify="center")
        table.add_column("Cost", justify="right")

        for p in providers:
            if "id" not in p:  # skip _section dividers
                continue
            env = p.get("api_key_env", "")
            key_set = "[green]✓[/green]" if (env and os.environ.get(env)) else f"[red]✗[/red] [dim]{env}[/dim]"
            cost_colors = {"free": "green", "cheap": "green", "moderate": "yellow",
                           "paid": "red", "varies": "dim"}
            ct = p.get("cost_tier", "?")
            cc = cost_colors.get(ct, "white")
            table.add_row(p["id"], p["label"], p.get("model", ""), key_set, f"[{cc}]{ct}[/{cc}]")

        console.print()
        console.print(table)
        available = sum(1 for p in providers if p.get("api_key_env") and os.environ.get(p["api_key_env"]))
        console.print(f"[dim]{available}/{len(providers)} API providers ready. Edit providers.json to add more.[/dim]\n")
    except ImportError:
        for p in providers:
            if "id" not in p:
                continue
            env = p.get("api_key_env", "")
            ok = "✓" if (env and os.environ.get(env)) else "✗"
            print(f"  {ok} {p['id']:20} {p['label']} [{p.get('cost_tier','')}]")


def main():
    p = argparse.ArgumentParser(description="Show sub-agent CLI and API provider status panel")
    p.add_argument("--json", action="store_true", help="Output raw JSON from detect_agents.sh")
    p.add_argument("--providers-only", action="store_true", help="Show only API providers table")
    p.add_argument("--clis-only", action="store_true", help="Show only installed CLIs table")
    args = p.parse_args()

    detected = run_detect()
    if args.json:
        print(json.dumps(detected, indent=2))
        return

    providers = load_api_providers()

    if not args.providers_only:
        print_rich(detected)
    if not args.clis_only and providers:
        print_api_providers_rich(providers)


if __name__ == "__main__":
    main()
