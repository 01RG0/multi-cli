#!/usr/bin/env python3
"""Live-tail the sub-agent delegation log.

Usage:
    python3 stream.py [--log-path PATH] [--last N]

Watches the JSONL log file and prints new entries as they arrive.
Press Ctrl-C to stop.
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path


def find_log_path() -> Path | None:
    cwd = Path.cwd()
    d = cwd
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


def format_record_plain(r: dict) -> str:
    ts = r.get("timestamp", "?")[:19].replace("T", " ")
    cli = r.get("cli", "?")
    status = r.get("status", "?")
    task = r.get("task", "?")
    dur = r.get("duration_seconds")
    dur_str = f" {dur:.0f}s" if dur else ""
    return f"[{ts}] {cli:10} {status:8}{dur_str}  {task}"


def format_record_rich(r: dict, console) -> None:
    from rich.text import Text
    ts = r.get("timestamp", "?")[:19].replace("T", " ")
    cli = r.get("cli", "?")
    status = r.get("status", "?")
    task = r.get("task", "?")
    dur = r.get("duration_seconds")
    dur_str = f" {dur:.0f}s" if dur else ""

    status_styles = {"success": "green", "partial": "yellow", "fail": "red"}
    style = status_styles.get(status, "white")

    line = Text()
    line.append(f"[{ts}] ", style="dim")
    line.append(f"{cli:10} ", style="cyan")
    line.append(f"{status:8}", style=style)
    line.append(f"{dur_str}  ", style="dim")
    line.append(task)
    console.print(line)


def tail_log(log_path: Path, use_rich: bool, last: int):
    console = None
    if use_rich:
        try:
            from rich.console import Console
            console = Console()
        except ImportError:
            use_rich = False

    # Print last N lines first
    if log_path.is_file() and last > 0:
        lines = log_path.read_text().strip().splitlines()
        for line in lines[-last:]:
            try:
                r = json.loads(line)
                if use_rich:
                    format_record_rich(r, console)
                else:
                    print(format_record_plain(r))
            except json.JSONDecodeError:
                pass

    if use_rich:
        console.print(f"\n[dim]Watching {log_path} — Ctrl-C to stop[/dim]\n")
    else:
        print(f"\nWatching {log_path} — Ctrl-C to stop\n")

    with open(log_path, "r") as f:
        f.seek(0, 2)  # jump to end
        try:
            while True:
                line = f.readline()
                if line:
                    line = line.strip()
                    if line:
                        try:
                            r = json.loads(line)
                            if use_rich:
                                format_record_rich(r, console)
                            else:
                                print(format_record_plain(r))
                        except json.JSONDecodeError:
                            pass
                else:
                    time.sleep(0.5)
        except KeyboardInterrupt:
            pass


def main():
    p = argparse.ArgumentParser(description="Live-tail the sub-agent delegation log")
    p.add_argument("--log-path", default=None)
    p.add_argument("--last", type=int, default=10, help="Show last N entries before tailing (default 10)")
    p.add_argument("--plain", action="store_true", help="Plain text output, no rich formatting")
    args = p.parse_args()

    log_path = Path(args.log_path) if args.log_path else find_log_path()

    if not log_path or not log_path.is_file():
        # Wait for it to appear
        if not log_path:
            log_path = Path.home() / ".cli-swarm" / "log.jsonl"
        print(f"Log not found yet at {log_path}, waiting...")
        try:
            while not log_path.is_file():
                time.sleep(1)
        except KeyboardInterrupt:
            sys.exit(0)

    use_rich = not args.plain
    tail_log(log_path, use_rich, args.last)


if __name__ == "__main__":
    main()
