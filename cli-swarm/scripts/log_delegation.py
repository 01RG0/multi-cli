#!/usr/bin/env python3
"""Append one delegation record to the sub-agent CLI swarm log.

Usage:
    python3 log_delegation.py --task "add input validation" --cli freebuff \
        --status success --loc-changed 42 [--duration-seconds 37] [--notes "..."]

Log location: .claude/cli-swarm-log.jsonl in the current project if a .claude/
directory (or .git) is found by walking up from cwd; otherwise
~/.cli-swarm/log.jsonl.
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone

VALID_CLIS = {"codex", "agy", "kilo", "freebuff", "claude", "other"}
VALID_STATUS = {"success", "partial", "fail"}

# Very rough heuristic: assume Claude would have spent about this many
# tokens per line of code if it had written the change itself.
TOKENS_PER_LOC_ESTIMATE = 15


def find_log_path():
    cwd = os.getcwd()
    d = cwd
    while True:
        if os.path.isdir(os.path.join(d, ".claude")) or os.path.isdir(os.path.join(d, ".git")):
            log_dir = os.path.join(d, ".claude")
            os.makedirs(log_dir, exist_ok=True)
            return os.path.join(log_dir, "cli-swarm-log.jsonl")
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    home_dir = os.path.join(os.path.expanduser("~"), ".cli-swarm")
    os.makedirs(home_dir, exist_ok=True)
    return os.path.join(home_dir, "log.jsonl")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--task", required=True, help="Short description of the delegated task")
    p.add_argument("--cli", required=True, choices=sorted(VALID_CLIS))
    p.add_argument("--status", required=True, choices=sorted(VALID_STATUS))
    p.add_argument("--loc-changed", type=int, default=0, help="Lines of code changed, for a rough savings estimate")
    p.add_argument("--duration-seconds", type=float, default=None)
    p.add_argument("--notes", default=None)
    args = p.parse_args()

    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "task": args.task,
        "cli": args.cli,
        "status": args.status,
        "loc_changed": args.loc_changed,
        "est_tokens_saved": args.loc_changed * TOKENS_PER_LOC_ESTIMATE if args.loc_changed else None,
        "duration_seconds": args.duration_seconds,
        "notes": args.notes,
    }

    log_path = find_log_path()
    with open(log_path, "a") as f:
        f.write(json.dumps(record) + "\n")

    print(f"Logged to {log_path}")


if __name__ == "__main__":
    sys.exit(main())
