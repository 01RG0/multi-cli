# CLI-Anything — Auto-wrap Any Software as Agent CLI

**Repo:** https://github.com/HKUDS/CLI-Anything  
**Stars:** 50.2k | **Language:** Python + Click | **Daily commits**  
**Verdict:** Worthy — study before M4 tool interface and M7 swarm expansion

---

## What it does
Seven-phase automated pipeline that converts any software (Blender, GIMP, LibreOffice, ComfyUI, 100+ apps) into an agent-callable CLI. JSON-first structured output by default. Dual-mode: stateful REPL + subcommand. Explicitly supports Claude Code, Cursor, OpenCode, Codex — our sub-agents. CLI-Hub registry has 18+ ready-made app harnesses.

---

## Patterns to take

### 1. JSON-first tool output (M4)
Every tool's `Execute()` should return structured JSON, not raw text.  
Agents parse it reliably. Raw text → brittle string matching.
```go
// tools/tool.go — update return convention
type ToolResult struct {
    Output   any    `json:"output"`           // structured data
    Text     string `json:"text,omitempty"`   // human-readable summary
    ExitCode int    `json:"exit_code"`
    Duration int    `json:"duration_ms"`
}
```

### 2. SKILL.md capability manifest (M4/M7)
Each tool/CLI auto-generates a manifest describing what it can do, accepted inputs, example calls.  
Our router uses it for task routing decisions.
```
tools/
  file.SKILL.md    ← "ReadFile: read any file. WriteFile: write content to path..."
  shell.SKILL.md   ← "Execute shell commands. Allowed: git, go, npm. Network: denied."
  web.SKILL.md     ← "Fetch a URL and return plain text."
```

### 3. Ready-made app CLIs for M7 swarm
These CLI-Anything harnesses can drop directly into our `dispatch.py` or M7 Go dispatcher:
- `blender-cli`, `gimp-cli`, `libreoffice-cli`, `comfyui-cli`
- Any installed desktop app becomes a dispatchable sub-agent
- Expands swarm beyond coding agents to creative/productivity tools

### 4. Seven-phase generation pipeline
If we need to wrap a new tool for M7: Analysis → Design → Implement → Test → Document → Publish → Register.  
Use as checklist when adding a new CLI to the swarm.

---

## Read before: M4 tool interface design + M7 dispatch expansion
