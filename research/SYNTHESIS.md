# M7 Research Synthesis — AI Agent Orchestrator

*Compiled: 2026-09-24 | Sources: 7 CLI agents + 4 Claude web-research agents*

---

## Research Coverage

| Topic | File | Source |
|---|---|---|
| Agent frameworks | agent-frameworks/agy.md | agy CLI |
| Go coding patterns | go-patterns/codex.md | codex CLI |
| Go embedding options | go-patterns/embeddings.md | Claude agent |
| Self-improvement loops | self-improvement/vibe.md | vibe CLI |
| Zep / Graphiti memory | graph-memory/zep.md | Claude agent |
| Hybrid graph+vector search | graph-memory/hybrid-search.md | Claude agent (pending) |
| SQLite graph design | knowledge-graph/sqlite-graph-design.md | Claude agent |
| Provider routing & Go interfaces | provider-routing/litellm-and-go-patterns.md | Claude agent |
| React dashboard & visualization | dashboard/react-realtime-viz.md | Claude agent |
| Agent-Git checkpoint/rollback model | references/agent-git.md | Claude agent (2026-09-24) |
| hindsight — bank isolation + observation consolidation | references/hindsight.md | Claude agent (2026-09-24) |
| ai-memory — source-authority RRF + episodes fallback | references/ai-memory.md | Claude agent (2026-09-24) |
| google/ax — suspend/resume tasks + gateway sandboxing | references/google-ax.md | Claude agent (2026-09-24) |
| CLI-Anything — JSON-first tools + SKILL.md manifest | references/cli-anything.md | Claude agent (2026-09-24) |

---

## Section 1: Go Backend Architecture

### Provider Abstraction (M1)

**Decision: Build a thin Go provider interface, not wrap a Python library.**

The recommended Go provider interface:
```go
type Provider interface {
    Complete(ctx context.Context, req ChatRequest) (ChatResponse, error)
    Stream(ctx context.Context, req ChatRequest) (<-chan StreamChunk, error)
    Name() string
}
```

- Model addressing: `"provider:model"` string, split on `:` to registry lookup
- OpenAI wire format works for Groq, Together, Ollama, OpenRouter — **one HTTP client handles them all**
- Anthropic needs a separate adapter (different request/response shape)
- For multi-provider routing fast path: **LiteLLM proxy sidecar** — Go calls `http://litellm:4000/v1/chat/completions`, zero Python in the hot path

### Fallback & Circuit Breaker Pattern
```go
// Router wraps Provider chain with retry + cooldown
type Router struct {
    primary    Provider
    fallbacks  []Provider
    maxRetries int
    backoff    BackoffPolicy
    cooldowns  map[string]time.Time  // provider name → cooldown-until
}
```
- HTTP 429 + Anthropic `overloaded_error` → rate limit
- Exponential backoff with jitter, cap at 4–5 attempts per provider
- After threshold failures: cooldown for N seconds (configurable)
- **Reference:** LiteLLM's `allowed_fails=3` + `cooldown_time=60` pattern

### Go Embedding Options
**Primary:** Ollama Go client (`github.com/ollama/ollama/api`) — `client.Embed()`, `nomic-embed-text` model, no CGo, no daemon except Ollama itself.
**Offline fallback:** `github.com/grumpylabs/fastembed-go` — pure Go + ONNX Runtime, BGE-small-en-v1.5, no daemon.

---

## Section 2: Graph Memory (M3)

### Architecture Decision: SQLite-native graph, Graphiti-inspired schema

**Do NOT use Neo4j for the initial build.** Full Graphiti/Neo4j is overkill for a single-user local orchestrator. Instead: SQLite with a graph schema inspired by Graphiti's temporal knowledge graph.

### Core Tables (from `knowledge-graph/sqlite-graph-design.md`)

```sql
-- Entity nodes
CREATE TABLE nodes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,          -- "file", "function", "concept", "agent", "task"
    summary TEXT,
    name_embedding BLOB,         -- float32[] stored as binary
    group_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Facts / relationships (temporal)
CREATE TABLE edges (
    id TEXT PRIMARY KEY,
    source_node_id TEXT NOT NULL REFERENCES nodes(id),
    target_node_id TEXT NOT NULL REFERENCES nodes(id),
    relation TEXT NOT NULL,      -- "CALLS", "DEPENDS_ON", "OUTPUTS", "RESOLVES"
    fact TEXT,                   -- natural language description
    fact_embedding BLOB,         -- float32[] for semantic edge search
    valid_at INTEGER,
    invalid_at INTEGER,          -- NULL = currently valid
    episode_ids TEXT,            -- JSON array of provenance episode IDs
    created_at INTEGER NOT NULL
);

-- Raw provenance (episodes)
CREATE TABLE episodes (
    id TEXT PRIMARY KEY,
    source_type TEXT,            -- "message", "task", "file_change"
    content TEXT NOT NULL,
    valid_at INTEGER NOT NULL,
    metadata TEXT                -- JSON key-value filters
);
```

### Key Design Insights from Graphiti Research + Agent-Git
1. **Store `fact_embedding` on the edge itself** — not in a separate vector table
2. **Temporal validity windows** (`valid_at` / `invalid_at`) on facts — critical for accurate memory as state changes
3. **Provenance (episodes)** trace every derived fact back to source
4. **Three search methods:** cosine similarity on embeddings + BM25 full-text + BFS graph traversal
5. **Rerank with RRF** (Reciprocal Rank Fusion) when combining multiple search methods
6. **Two-level rollback** (from Agent-Git): distinguish *internal session revert* (undo within a task) vs *external session revert* (undo across sessions) — map this to task-level vs session-level undo in M2/M3
7. **Tool revert pattern** (from Agent-Git): track how to undo side effects of tool calls (DB writes, API calls) — relevant for M4 tool safety

### SQLite-specific Implementation
- Store `float32[]` as BLOB; decode in Go with `encoding/binary`
- Use SQLite FTS5 extension for BM25 search on `fact` and `content` fields
- BFS via recursive CTE: `WITH RECURSIVE traverse AS (...)`
- `sqlite-vec` extension (https://github.com/asg017/sqlite-vec) for cosine similarity search in SQL
- WAL mode for concurrent reads during search + writes during ingestion

---

## Section 3: Self-Improvement Loop (M5)

**Source: self-improvement/vibe.md**

Core loop pattern:
1. **Observe:** Capture task outcomes, latencies, error rates, provider health
2. **Reflect:** LLM analyzes patterns in recent history (last N tasks)
3. **Propose:** Generate config mutation (e.g., change fallback order, adjust timeout)
4. **Validate:** Test mutation on synthetic benchmark or shadow traffic
5. **Apply:** Commit mutation if validated, rollback if degraded

Key findings:
- Store all task outcomes in a structured log (SQLite); self-improvement reads from this
- Reflection prompt should include: success rate per provider, avg latency, error taxonomy
- Safety: changes should be bounded (no provider removal, only ordering changes)
- Feedback cycle: at minimum daily, ideally per-session

---

## Section 4: Agent Frameworks Survey

**Source: agent-frameworks/agy.md**

Top Go-compatible orchestration patterns:
- **AgenticGoKit:** Event-driven, DAG orchestration, OpenTelemetry, plugin LLM architecture
- **go-agent (Protocol-Lattice):** Production agent framework with memory, tools, multi-agent
- **laconic (smhanov):** Minimal research orchestrator, stdlib-only, zero vendor deps
- **orloj:** YAML-declarative multi-agent runtime (Kubernetes-style manifests)

**Recommendation for this project:** Start with the `laconic` interface pattern (minimal) then layer in AgenticGoKit's plugin approach for provider registration. The PRD's architecture already covers the key patterns.

For sub-agent patterns:
- Agent specialization by task type (research, code, analysis)
- Each agent gets a scoped memory view (not full graph)
- Inter-agent communication via shared SQLite task queue
- Parent agent monitors child agents via WebSocket event stream

---

## Section 5: Dashboard (M6)

**Source: dashboard/react-realtime-viz.md**

### Final Stack Decision

```
React Flow        → Task/agent dependency graph (primary view)
Cosmos.gl         → Living neural-network background overlay (WebGL2 GPU)
shadcn/ui         → Structural layout (sidebar, panels, cards)
Tremor            → Data components (KPI, provider status, spark charts)
Zustand           → State management (subscribeWithSelector for panel isolation)
react-use-websocket → Single shared WS connection (share: true)
dnd-kit           → Priority queue drag-and-drop (vertical sort)
```

**DO NOT USE:** react-beautiful-dnd (deprecated/archived by Atlassian)

### Go WebSocket Events (discriminated union)
```json
{ "type": "task.started",   "taskId": "...", "agentId": "...", "ts": 0 }
{ "type": "task.completed", "taskId": "...", "duration": 1200 }
{ "type": "agent.status",   "agentId": "...", "status": "running|idle|error" }
{ "type": "queue.reorder",  "items": [...] }
{ "type": "provider.health","provider": "openai", "latency": 42, "status": "ok" }
```

Go WS library: `gorilla/websocket` (22k stars) — most mature, best docs.

---

## Section 6: Provider Routing (M1)

**Source: provider-routing/litellm-and-go-patterns.md**

### Provider Priority (default chain)
1. Anthropic Claude (primary — most capable)
2. OpenRouter (fallback — routes to many providers)
3. Groq (fast, free tier, OpenAI-compatible)
4. Ollama local (offline fallback)

### OpenAI-Compatible Shortcut
These providers accept OpenAI wire format with just a `BaseURL` swap:
- Groq, Together AI, Fireworks, Ollama, LM Studio, OpenRouter
- One `http.Client` wrapper handles all of them
- Only Anthropic needs a dedicated adapter

---

## Section 7: Implementation Sequence

Based on all research, recommended build order:

### M1: Go skeleton + provider abstraction
- `Provider` interface + OpenAI-compatible adapter (covers Groq/Ollama/OpenRouter)
- Anthropic adapter
- `Router` with fallback chain + exponential backoff
- Config file: YAML, provider list with credentials

### M2: Task queue + agent dispatch
- SQLite task queue (WAL mode)
- Agent worker pool (goroutine per agent, bounded)
- Task state machine: pending → running → completed/failed

### M3: Graph memory
- SQLite schema (nodes, edges, episodes)
- Embedding ingestion (Ollama `nomic-embed-text`)
- Hybrid search: sqlite-vec (cosine) + FTS5 (BM25) + recursive CTE (BFS)
- RRF reranking in Go

### M4: Tool system
- Tool interface: `Execute(ctx, params) → result`
- Built-in: file read/write, shell exec, web fetch
- Tool call parsing from LLM response

### M5: Self-improvement loop
- Task outcome logging → structured metrics
- Reflection LLM call (daily/session boundary)
- Config mutation with safety bounds
- A/B testing on synthetic benchmarks

### M6: WebSocket dashboard
- Go event bus: fan-out orchestrator events to all WS clients
- React frontend: React Flow + Cosmos.gl + Zustand + dnd-kit
- Real-time task flow graph + neural network overlay

### M7: CLI swarm integration *(this research sweep)*
- dispatch.py → Go equivalent (or keep Python wrapper)
- Sub-agent routing: delegate tasks to external CLIs (codex, agy, grok, etc.)
- Merge CLI output back into graph memory

---

## Key Technology Decisions Summary

| Decision | Choice | Rationale |
|---|---|---|
| Go provider interface | Minimal interface + Router | Laconic pattern; LiteLLM proxy optional |
| Embedding | Ollama Go client (`nomic-embed-text`) | No CGo, excellent maturity |
| Graph DB | SQLite with vec + FTS5 | No separate service, sufficient for local use |
| Memory schema | Graphiti-inspired temporal facts | Proven in Zep production; valid_at/invalid_at critical |
| Search | cosine + BM25 + BFS + RRF | Graphiti gold standard |
| Frontend state | Zustand + subscribeWithSelector | 10–100 events/sec without Redux overhead |
| Task graph viz | React Flow (@xyflow) | Native React nodes, CSS glow, dagre/D3 layouts |
| Neural overlay | Cosmos.gl OR react-force-graph | GPU for scale; react-force-graph simpler |
| DnD queue | dnd-kit SortableContext | react-beautiful-dnd is deprecated |
| WS Go lib | gorilla/websocket | Most mature, best docs |
| RRF scoring | Source-authority weighted (ai-memory) | Flat k=1 loses trust signal; weight by source+confidence |
| Tool output | JSON-first ToolResult struct (CLI-Anything) | Raw text output is brittle for agent parsing |
| Task states | +suspended (google/ax) | Tasks must be pausable, not just pending/running/done |
| Shell sandboxing | Allowlist per tool (google/ax Gateway) | Deny-by-default network + command list in config.yaml |

---

## Design Deltas from Post-M1 Research

Concrete changes each reference repo adds to the original PRD plan:

### M2 additions (google/ax)
- Task status: add `suspended` + `resume_token` columns
- Task metadata: add `workspace` JSON (cwd, env, allowed tools)

### M3 additions (ai-memory ★★ + hindsight + Agent-Git)
- RRF scorer: weight by `source` authority (`user_stated=1.0`, `agent_observed=0.7`, `agent_derived=0.5`) × `confidence`
- Fallback search: if graph search returns 0 results, scan `episodes_fts` (add FTS5 virtual table on episodes)
- Observation consolidation: `UpsertNode()` checks near-duplicate before insert (title similarity threshold 0.85)
- Bank isolation: enforce `scope` filter at query time on every search path
- Episodes schema: add `parent_episode_id` + `checkpoint_type` columns (from Agent-Git)
- Add `episodes_fts` virtual table: `CREATE VIRTUAL TABLE episodes_fts USING fts5(content, content=episodes, content_rowid=rowid)`

### M4 additions (CLI-Anything + google/ax)
- Tool return type: `ToolResult{Output any, Text string, ExitCode int, Duration int}` instead of raw string
- Tool interface: add optional `Revert(ctx, params) error` (from Agent-Git)
- Shell tool: `allowed_commands` + `deny_network` from config
- Web tool: `allowed_domains` + `max_response_bytes` from config
- Each tool emits a `SKILL.md` capability manifest

### M7 additions (CLI-Anything)
- CLI-Anything harnesses (Blender, GIMP, ComfyUI, etc.) can be added to dispatch chain
- Sub-agent outputs standardized to JSON-first format
- Use 7-phase pipeline as checklist when wrapping new tools

---

## Research Rules

Rules for evaluating new repos going forward:

1. **Verdict must be one of three:** `worthy` (copy patterns, high priority) / `reference` (read before relevant milestone) / `skip` (nothing novel for our stack)
2. **Stack incompatibility is not a skip reason.** Python/Rust repos can have better design patterns than Go ones. Evaluate the *ideas*, not the code.
3. **A repo is only reference-worthy if it covers something we haven't designed yet.** If we already handle it better, skip — don't collect for completeness.
4. **Every reference gets a concrete "take"** — specific columns, function signatures, or config fields. "Interesting architecture" with no actionable output = skip.
5. **Assign to a milestone.** If a repo doesn't map to M1–M7, it's not useful yet.
6. **Stars are a weak signal.** 56k stars on a Python proxy we already built in Go = skip. 8.3k stars on a Rust memory system with novel RRF weighting = ★★.
7. **No docs for docs' sake.** Only save to research files if the finding changes something in the plan. Observations without design impact don't get a file.
