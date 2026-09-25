# google/ax — Kubernetes-Native Agent Orchestrator (Go)

**Repo:** https://github.com/google/ax  
**Stars:** 10k | **Language:** Go | **Active, pre-stable**  
**Verdict:** Reference ★ — read before M2 task state machine and M4 shell sandboxing

---

## What it does
Google's declarative orchestrator for running autonomous agent workloads. Four primitives: Task (sandboxed execution), Workspace (pre-wired Git + MCP environment), Gateway (network allowlist), Model (LLM provider config). kubectl-style CLI, Redis + gRPC control plane, Docker sandboxes. Pre-stable — don't adopt infra, study the design patterns.

---

## Patterns to take

### 1. Suspend/resume task state machine (M2)
ax tasks can be suspended mid-execution and resumed later. Our current state machine is missing this.

**Update M2 task state machine:**
```
pending → running → suspended → running (resumed)
                 ↘ completed
                 ↘ failed
```

**SQLite addition:**
```sql
-- tasks table: add suspend support
ALTER TABLE tasks ADD COLUMN suspended_at INTEGER;
ALTER TABLE tasks ADD COLUMN resume_token TEXT; -- opaque state blob for resuming

-- status values: 'pending' | 'running' | 'suspended' | 'completed' | 'failed'
```

### 2. Gateway spec — tool network sandboxing (M4)
ax's Gateway resource defines an explicit allowlist of domains/commands a task can access.  
Apply to our `ShellExec` and `WebFetch` tools.

**Config addition for M4:**
```yaml
# config.yaml
tools:
  shell:
    timeout_seconds: 30
    allowed_commands: [git, go, npm, python, node]
    deny_network: true       # shell tool has no outbound network
  web:
    timeout_seconds: 15
    allowed_domains: []      # empty = allow all; populate to restrict
    max_response_bytes: 1048576
```

**Go enforcement:**
```go
// tools/shell.go
func (t *ShellTool) Execute(ctx context.Context, params json.RawMessage) (string, error) {
    var p struct{ Command string `json:"command"` }
    json.Unmarshal(params, &p)
    cmd := strings.Fields(p.Command)[0]
    if !t.isAllowed(cmd) {
        return "", fmt.Errorf("command %q not in allowlist", cmd)
    }
    // ...
}
```

### 3. Workspace concept (M2 task metadata)
ax pre-warms a task environment (clone repo, install deps, mount MCP tools) before the agent runs.  
Map to our task `metadata` JSON field — store workspace setup as part of task definition:
```json
{
  "workspace": {
    "cwd": "D:/pRoG/multi cli/orchestrator",
    "env": {"GOPATH": "..."},
    "tools": ["file", "shell", "web"]
  }
}
```

---

## What to skip
- Kubernetes, Redis, gRPC, Docker — opposite of our local-first SQLite design
- Their Model resource — we have a better provider system already

## Read before: M2 worker.go + M4 shell.go
