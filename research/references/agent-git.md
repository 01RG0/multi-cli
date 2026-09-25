# Agent-Git — Checkpoint & Rollback Model for AI Agents

**Repo:** https://github.com/MAS-Infra-Layer/Agent-Git  
*(mirrors to https://github.com/KataDavidXD/Agent-Git)*  
**Stars:** Low hundreds | **Language:** Python | **Status:** v0.2.0-alpha (Nov 2025)  
**Paper:** Agent_Git.pdf — AAAI 2026 workshop  
**Verdict:** Reference only — Python/LangGraph stack incompatible, but data model is directly on-topic for M3.

---

## What it does

Git-style version control for AI agent conversations. Wraps LangGraph with SQLite-backed checkpoints so you can commit, branch, and revert agent state — including undoing tool call side effects (DB writes, API calls). Non-destructive: rollbacks create new branches rather than destroying history.

---

## Concepts worth stealing (for Go orchestrator)

### 1. Two-level rollback model
- **Internal session revert** — undo within a running task (e.g. a tool call went wrong mid-task)
- **External session revert** — undo across sessions (restore agent to state from N sessions ago)

**How to apply in M2/M3:**
```
Task-level undo   → mark task status = 'reverted', restore prior graph edges (set invalid_at = now)
Session-level undo → rewind episodes table to a prior checkpoint_id, re-derive active edges
```

### 2. Tool revert pattern
Each tool call that has side effects registers an `undo` action alongside its `execute` action.  
Store as JSON in the task's `metadata` column:
```json
{
  "tool": "WriteFile",
  "executed_at": 1790000000,
  "undo": { "action": "RestoreFile", "path": "src/main.go", "backup_hash": "abc123" }
}
```
**Relevant for M4 tool system** — add optional `Revert(ctx, params) error` to the `Tool` interface.

### 3. SQLite checkpoint schema pattern
Agent-Git uses a `session_history` table where each row is an immutable snapshot of agent state. Maps to our `episodes` table design — every episode is a checkpoint, never mutated.

Key invariant they enforce: **checkpoints are append-only; rollback = new branch, not deletion.**  
This matches our `invalid_at`-based temporal edges exactly.

### 4. MDP-based formal model (from the paper)
They model agent execution as a Markov Decision Process where each state is a (context, tool_calls, memory) tuple. Rollback = transition to a prior state in the MDP trajectory.

**Practical takeaway for M3 `episodes` table:**
- Add `parent_episode_id TEXT` column — forms a linked list / DAG of episode history
- Add `checkpoint_type TEXT` — `'task_start' | 'tool_call' | 'task_end' | 'session_start'`
- Enables BFS traversal backwards through episode history for rollback

---

## Schema delta to consider for M3

Current M3 `episodes` design:
```sql
CREATE TABLE episodes (
    id          TEXT PRIMARY KEY,
    source_type TEXT,
    content     TEXT NOT NULL,
    valid_at    INTEGER NOT NULL,
    metadata    TEXT
);
```

Agent-Git-inspired addition:
```sql
ALTER TABLE episodes ADD COLUMN parent_episode_id TEXT REFERENCES episodes(id);
ALTER TABLE episodes ADD COLUMN checkpoint_type TEXT DEFAULT 'task_end';
-- checkpoint_type: 'task_start' | 'tool_call' | 'task_end' | 'session_start' | 'revert'
```

This costs two columns and enables full session replay and rollback without breaking the existing design.

---

## What to skip

- All Python/LangGraph code — not portable to Go
- Their CLI interface (`agent-git commit`, `agent-git checkout`) — we'll expose this via WebSocket events in M6 instead

---

## Read before: M3 (episodes table finalization) and M4 (Tool interface)
