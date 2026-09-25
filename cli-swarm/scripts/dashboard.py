#!/usr/bin/env python3
"""Print a Rich-formatted summary dashboard of the sub-agent CLI swarm log.

Usage:
    python3 dashboard.py [--log-path PATH] [--live] [--plain]

    --live   Refresh every 3s (auto-stops if log is idle for 60s)
    --plain  Plain text, no rich formatting
"""
import argparse
import json
import os
import time
from collections import defaultdict
from pathlib import Path


def find_log_path() -> Path | None:
    d = Path.cwd()
    while True:
        candidate = d / ".claude" / "cli-swarm-log.jsonl"
        if candidate.is_file():
            return candidate
        parent = d.parent
        if parent == d:
            break
        d = parent
    home = Path.home() / ".cli-swarm" / "log.jsonl"
    return home if home.is_file() else None


def load_records(log_path: Path) -> list:
    records = []
    try:
        with open(log_path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    except OSError:
        pass
    return records


def build_stats(records: list) -> dict:
    per_cli = defaultdict(lambda: {"total": 0, "success": 0, "partial": 0, "fail": 0,
                                    "tokens_saved": 0, "total_duration": 0.0})
    for r in records:
        cli = r.get("cli", "unknown")
        s = per_cli[cli]
        s["total"] += 1
        status = r.get("status", "unknown")
        if status in ("success", "partial", "fail"):
            s[status] += 1
        tokens = r.get("est_tokens_saved") or 0
        s["tokens_saved"] += tokens
        dur = r.get("duration_seconds") or 0
        s["total_duration"] += dur
    return dict(per_cli)


def render_plain(records: list, log_path: Path):
    if not records:
        print(f"Log at {log_path} is empty.")
        return
    stats = build_stats(records)
    total_tokens = sum(s["tokens_saved"] for s in stats.values())
    print(f"\nSub-Agent CLI Swarm — {len(records)} task(s)  |  {log_path}\n")
    header = f"{'CLI':<12} {'Total':>6} {'Success':>8} {'Partial':>8} {'Fail':>6} {'SuccRate':>9} {'Est.tokens':>12} {'Avg.dur':>8}"
    print(header)
    print("-" * len(header))
    for cli, s in sorted(stats.items(), key=lambda kv: -kv[1]["total"]):
        rate = f"{s['success']/s['total']*100:.0f}%" if s["total"] else "-"
        avg_dur = f"{s['total_duration']/s['total']:.0f}s" if s["total"] else "-"
        print(f"{cli:<12} {s['total']:>6} {s['success']:>8} {s['partial']:>8} {s['fail']:>6} {rate:>9} {s['tokens_saved']:>12,} {avg_dur:>8}")
    print("-" * len(header))
    print(f"{'TOTAL':<12} {len(records):>6} {'':>8} {'':>8} {'':>6} {'':>9} {total_tokens:>12,}")
    print("\n(Token figures are rough heuristics — 15 tokens/LOC estimate, not exact billing.)\n")


def render_rich(records: list, log_path: Path):
    try:
        from rich.console import Console
        from rich.table import Table
        from rich import box
        from rich.text import Text
        from rich.panel import Panel
    except ImportError:
        render_plain(records, log_path)
        return

    console = Console()

    if not records:
        console.print(f"[dim]No delegation records yet at {log_path}[/dim]")
        return

    stats = build_stats(records)
    total_tokens = sum(s["tokens_saved"] for s in stats.values())
    total_tasks = len(records)
    successes = sum(s["success"] for s in stats.values())
    overall_rate = f"{successes/total_tasks*100:.0f}%" if total_tasks else "-"

    # Summary panel
    summary = (
        f"[bold white]{total_tasks}[/bold white] tasks delegated  "
        f"[green]{successes} success[/green]  "
        f"[cyan]{overall_rate} rate[/cyan]  "
        f"[yellow]{total_tokens:,}[/yellow] est. tokens saved"
    )
    console.print(Panel(summary, title="[bold cyan]Sub-Agent CLI Swarm[/bold cyan]", border_style="cyan"))

    table = Table(box=box.ROUNDED, highlight=True, show_lines=False)
    table.add_column("CLI", style="bold cyan", no_wrap=True)
    table.add_column("Total", justify="right")
    table.add_column("Success", justify="right", style="green")
    table.add_column("Partial", justify="right", style="yellow")
    table.add_column("Fail", justify="right", style="red")
    table.add_column("Rate", justify="right")
    table.add_column("Est. tokens", justify="right", style="dim")
    table.add_column("Avg dur", justify="right", style="dim")

    for cli, s in sorted(stats.items(), key=lambda kv: -kv[1]["total"]):
        rate = f"{s['success']/s['total']*100:.0f}%" if s["total"] else "-"
        rate_color = "green" if s["total"] and s["success"]/s["total"] >= 0.8 else "yellow" if s["total"] and s["success"]/s["total"] >= 0.5 else "red"
        avg_dur = f"{s['total_duration']/s['total']:.0f}s" if s["total"] else "-"
        table.add_row(
            cli,
            str(s["total"]),
            str(s["success"]),
            str(s["partial"]),
            str(s["fail"]),
            f"[{rate_color}]{rate}[/{rate_color}]",
            f"{s['tokens_saved']:,}",
            avg_dur,
        )

    console.print(table)

    # Recent tasks
    recent = records[-5:]
    if recent:
        console.print("\n[bold]Recent tasks:[/bold]")
        for r in reversed(recent):
            ts = r.get("timestamp", "?")[:16].replace("T", " ")
            cli = r.get("cli", "?")
            status = r.get("status", "?")
            task = r.get("task", "?")
            color = {"success": "green", "partial": "yellow", "fail": "red"}.get(status, "white")
            console.print(f"  [dim]{ts}[/dim]  [cyan]{cli:<10}[/cyan] [{color}]{status}[/{color}]  {task}")

    console.print(f"\n[dim]Log: {log_path}  |  Token figures are rough heuristics (15 tok/LOC).[/dim]\n")


def render(records: list, log_path: Path, plain: bool):
    if plain:
        render_plain(records, log_path)
    else:
        render_rich(records, log_path)


def main():
    p = argparse.ArgumentParser(description="Sub-agent CLI swarm dashboard")
    p.add_argument("--log-path", default=None)
    p.add_argument("--live", action="store_true", help="Auto-refresh every 3s")
    p.add_argument("--plain", action="store_true", help="Plain text output")
    args = p.parse_args()

    log_path = Path(args.log_path) if args.log_path else find_log_path()
    if not log_path:
        print("No delegation log found. Nothing has been delegated yet.")
        return

    if not args.live:
        records = load_records(log_path)
        render(records, log_path, args.plain)
        return

    # Live mode
    last_mtime = None
    idle_since = time.time()
    try:
        try:
            from rich.console import Console
            Console().print("[dim]Live mode — refreshing every 3s. Ctrl-C to stop.[/dim]")
        except ImportError:
            print("Live mode — refreshing every 3s. Ctrl-C to stop.")

        while True:
            mtime = log_path.stat().st_mtime if log_path.exists() else None
            if mtime != last_mtime:
                last_mtime = mtime
                idle_since = time.time()
                try:
                    from rich.console import Console
                    Console().clear()
                except ImportError:
                    print("\033[2J\033[H", end="")  # ANSI clear
                records = load_records(log_path)
                render(records, log_path, args.plain)
            elif time.time() - idle_since > 60:
                print("No new entries for 60s, stopping live mode.")
                break
            time.sleep(3)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
