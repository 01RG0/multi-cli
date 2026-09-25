# Knowledge Graph Design for AI Agent Memory

**Type:** research report (design document, no implementation code)
**Date:** 2026-09-24
**Scope:** local-first, SQLite-backed knowledge-graph memory for CLI coding agents — the context is a multi-agent dispatcher (`cli-swarm/`) where several headless coding CLIs share one durable memory store.
**Convention:** verify model names/versions against vendor pages before shipping; the CLI toolchain in this repo moves fast, and so do embedding models.

## Table of contents

1. [Design goals & assumptions](#0-design-goals--assumptions)
2. [Node schema design](#1-node-schema-design)
3. [Edge / relationship taxonomy](#2-edge--relationship-taxonomy)
4. [Embedding strategies for semantic search](#3-embedding-strategies-for-semantic-search)
5. [SQLite schema patterns for graph storage](#4-sqlite-schema-patterns-for-graph-storage)
6. [Documentation-as-layer pattern](#5-documentation-as-layer-pattern)
7. [Worked example](#6-worked-example-end-to-end)
8. [Anti-patterns & open questions](#7-anti-patterns--open-questions)
9. [References](#8-references)

---

## 0. Design goals & assumptions

| # | Goal | Consequence for design |
|---|------|------------------------|
| G1 | **Write-cheap** — persisting a memory costs the agent one call with a handful of fields | flat envelope + `attrs` JSON; no mandatory joins to write a node |
| G2 | **Read-cheap** — retrieve ≤ 20 highly relevant nodes for a prompt | hybrid FTS5 + vector retrieval, 1–2 hop graph expansion, salience caps |
| G3 | **Human-auditable** — a person can review memory without querying SQL | documentation-as-layer (§5), generated markdown in git |
| G4 | **Single-file storage** — no server process | SQLite (WAL), optional loadable extensions only |
| G5 | **Provenance & time** — every memory knows who wrote it, when, in which session; contradictions must be representable | `source`, `session_id`, revisions, temporal fact fields |
| G6 | **Graceful degradation** — system works without the vector extension | FTS5 is the floor; vectors are an accelerator layer |

**Scale assumptions:** 10³–10⁵ nodes, 10⁴–10⁶ edges (repo-scale memory, not web-scale). Mostly single-writer (the dispatcher serializes writes), many readers.

---

## 1. Node schema design

### 1.1 Common envelope (every node, every type)

All node types share one envelope; type-specific fields live in `attrs` (JSON). This keeps writes atomic (one INSERT) and lets generic tools (listing, salience ranking, revision diffing) work without knowing the type.

| Field | Type | Notes |
|-------|------|-------|
| `id` | TEXT PK | **ULID** (26-char, lexicographically sortable by creation time) or UUIDv7. Sortable IDs give free "recent nodes first" ordering in SQLite. |
| `type` | TEXT | `task` \| `decision` \| `file` \| `fact` \| `doc` \| `doc_section` \| `agent` \| `session` \| `event` \| `error` \| `concept` \| `artifact` — enforced by CHECK constraint. |
| `title` | TEXT | one line, imperative/descriptive; primary human-facing label, part of embedding text. |
| `summary` | TEXT | 1–3 sentences; **canonical embedding source**. Must be self-contained (no "it/this"). |
| `body` | TEXT | longer free text (plan details, rationale, evidence notes). FTS-indexed; embedded only if short. |
| `status` | TEXT | common lifecycle: `active` \| `superseded` \| `tombstoned`. Type-specific state (e.g. task `running`) lives in `attrs.state`. Never hard-delete — tombstoning keeps historical edges resolvable. |
| `tags` | TEXT (JSON array) | flat labels for cheap filtering (`["auth","flaky-test"]`). Lower precision than edges; facets, not relationships. |
| `scope` | TEXT | `global` \| `project` \| `module` \| `session` — controls which agents/docs import the node. |
| `confidence` | REAL 0–1 | how sure we are the content is true (facts) or the recorded outcome is correct (tasks). |
| `salience` | REAL 0–1 | retrieval weight; seeded by heuristics (user-stated fact = 1.0, generated file = 0.2), boosted on access, decayed with age. |
| `attrs` | TEXT (JSON) | type-specific fields — see per-type tables below. |
| `source` | TEXT | provenance: `user_stated` \| `agent_observed` \| `agent_derived` \| `imported` \| `human_edit`. |
| `session_id` | TEXT NULL | the agent session/run that created it. |
| `schema_ver` | INTEGER | per-type schema version for `attrs` migrations. |
| `content_hash` | TEXT | hash of `title+summary+body+attrs` — idempotent writes (skip if unchanged), staleness checks, doc round-trip (§5). |
| `created_at` / `updated_at` | TEXT | ISO-8601 UTC (`2026-09-24T10:00:00Z`). |
| `accessed_at` | TEXT | last retrieval touch — input to salience decay. |

```json
{
  "id": "01J9QK7M2N3P4R5S6T7V8W9X0Y",
  "type": "decision",
  "title": "Strip MISTRAL_API_KEY for vibe CLI",
  "summary": "vibe routes through the paid Mistral API when MISTRAL_API_KEY is present, so dispatch must unset it.",
  "status": "active",
  "tags": ["env", "provider-routing"],
  "scope": "project",
  "confidence": 1.0,
  "salience": 0.8,
  "source": "agent_observed",
  "session_id": "01J9QK7M...",
  "schema_ver": 1,
  "content_hash": "sha256:...",
  "created_at": "2026-09-24T10:00:00Z",
  "updated_at": "2026-09-24T10:00:00Z",
  "accessed_at": "2026-09-24T10:00:00Z"
}
```

### 1.2 Task node (`type = "task"`)

A unit of work delegated to an agent (human- or agent-initiated). Mirrors the records `cli-swarm/scripts/log_delegation.py` already appends to JSONL, but structured and linked.

| `attrs` field | Type | Notes |
|---------------|------|-------|
| `goal` | string | what "done" means, phrased as an outcome. |
| `acceptance_criteria` | string[] | machine-checkable-ish bullets (tests pass, file exists, …). |
| `state` | enum | `queued` \| `running` \| `blocked` \| `done` \| `failed` \| `canceled`. |
| `priority` | int 0–100 | retrieval ordering within `type=task`. |
| `assignee` | string | agent/CLI id (`codex`, `agy`, `kilo`, …). Also an `assigned_to` edge when agents are nodes. |
| `plan_steps` | [{title, status, note}] | coarse progress; keep ≤ ~10 items — detail belongs in `body` or events. |
| `attempts` | int | retry counter (pair with `retries` edge to the previous attempt). |
| `error` | {kind, message, event_ref} | when `state=failed`; `event_ref` points to the raw log, not inlined. |
| `outcome` | {status, summary, est_tokens_saved, loc_changed, duration_seconds} | filled on completion — the fields the JSONL log already tracks. |
| `retro` | string | lesson learned; if valuable, promoted to a `fact` node via `derived_from`. |
| `started_at` / `completed_at` / `due_at` | ISO-8601 \| null | |
| `client_task_id` | string \| null | caller-supplied key for idempotent re-submission. |

**Not in attrs — use edges:** touched files → `modifies` edges to `file` nodes; parent task → `parent_of` (also materialized in the closure table, §4); blocker → `blocked_by`; a bug fixed by this task → that node's `fixed_by` points here.

**Unique key:** partial unique index on `attrs->>'client_task_id'` where not null.

### 1.3 Decision node (`type = "decision"`)

An ADR-shaped record: an option was chosen, under constraints, at a time, by someone. Highest-leverage type for long-term memory — it stores *why*, which code never does.

| `attrs` field | Type | Notes |
|---------------|------|-------|
| `question` | string | the decision being made ("Which flag runs grok headless?"). |
| `context` | string | constraints/facts as known at decision time. |
| `options` | [{id, label, pros[], cons[], cost}] | full consideration set; rejected options stay — they prevent re-litigating. |
| `choice` | string | id of the chosen option. |
| `rationale` | string | why this option won; the embedding goldmine. |
| `decision_maker` | string | `human` \| agent id \| `model:<name>@<version>`. |
| `decided_at` | ISO-8601 | may differ from `created_at` (imported decisions). |
| `state` | enum | `proposed` \| `accepted` \| `rejected` \| `superseded` \| `revisited`. |
| `reversibility` | enum | `one_way` (expensive to undo) \| `two_way` (cheap experiment). Drives how much scrutiny docs/CI give it. |
| `constraints` | string[] | hard limits honored (e.g. "no paid API", "Windows-only runtime"). |
| `review_at` | ISO-8601 \| null | expiration trigger — re-check when the environment changes. |
| `outcome_notes` | string \| null | filled later: did the decision hold? Feeds `revisited`. |

**Edges instead of fields:** `supersedes` → older decision; `supports` ← fact/evidence nodes; `built_on` → prior decision/library; `documented_by` ← a `doc_section` (the ADR file in the docs layer renders this node).

### 1.4 File node (`type = "file"`)

Represents a path in the workspace. **File contents stay in git** — the node stores identity, metadata, and a human/agent-written *purpose*.

| `attrs` field | Type | Notes |
|---------------|------|-------|
| `path` | string | **repo-relative, `/`-separators, case-normalized on Windows** — canonical identity. Partial unique index. |
| `language` | string \| null | from extension or detector. |
| `kind` | enum | `source` \| `test` \| `doc` \| `config` \| `generated` \| `asset`. |
| `purpose` | string | 1–3 sentences on *why this file exists* — **embedded instead of content**. |
| `module` | string \| null | logical subsystem (`cli-swarm/scripts`). |
| `symbols` | {exports:[], classes:[], main_entry:[]} | shallow symbol list for retrieval; cap ~20 entries — full symbol tables belong to tooling. |
| `content_hash` | string \| null | hash of file bytes at last observation — detects external edits vs. graph staleness. |
| `bytes` / `loc` | int \| null | snapshot metrics. |
| `status` | enum | `active` \| `missing` \| `deprecated` \| `generated`. |
| `git` | {last_commit, last_author, last_touch} | optional, refreshed by tooling. |

**Rules:** never embed full file content (git + grep beat embeddings for content); `generated` files are excluded from the vector index by default (noise); deleted files are tombstoned, not removed, because history edges point at them.

### 1.5 Fact node (`type = "fact"`)

A durable, atomic assertion — the graph's "world model": environment quirks, user preferences, domain constraints, project invariants.

| `attrs` field | Type | Notes |
|---------------|------|-------|
| `statement` | string | **atomic**: exactly one claim, self-contained, testable. "vibe uses the paid Mistral API if MISTRAL_API_KEY is in env" ✅ — "vibe and kilo both have env issues" ❌ (split into two). |
| `triple` | {subject, predicate, object} \| null | optional structured form; exact-match joins and contradiction detection. |
| `category` | enum | `preference` \| `constraint` \| `environment` \| `project` \| `domain` \| `how_to`. |
| `polarity` | enum | `holds` \| `refuted`. Refuted facts are kept (with `refuted_by`) so agents stop re-discovering them. |
| `source_kind` | enum | `user_stated` (trust 1.0) \| `observed` (reproducible) \| `derived` (inferred — needs evidence edges) \| `imported`. |
| `effective_from` / `expires_at` | ISO-8601 \| null | temporal validity — "API key expires 2026-10-01" must be able to die. |
| `last_verified_at` / `verify_method` | ISO-8601, string \| null | re-verification cadence for high-salience facts. |
| `evidence_count` | int | incremented each confirming observation; boosts confidence. |

**Edges instead of fields:** `contradicts` → competing fact (triggers review workflow); `sourced_from` → doc/URL/session; `derived_from` → evidence nodes; `supersedes` → outdated fact.

### 1.6 Supporting node types (summary)

| Type | Purpose | Key `attrs` |
|------|---------|-------------|
| `doc` | a markdown artifact in the docs layer | `path`, `format`, `audience`, `generated` (bool) |
| `doc_section` | one heading section of a doc | `heading_path`, `anchor`, `manual` (bool) |
| `agent` | a CLI/agent identity | `binary`, `provider`, `model`, `capabilities[]` |
| `session` | one dispatch run | `started_at`, `ended_at`, `exit_status`, `log_path` |
| `event` | append-only occurrence (log line cluster) | `kind`, `payload_ref` — payloads stay in the log file; the node holds the pointer |
| `error` | recurring failure signature | `fingerprint`, `first_seen`, `last_seen`, `occurrence_count` |
| `concept` | reusable domain/ontology term | `definition` |
| `artifact` | produced output (patch, report, build) | `uri`, `media_type`, `content_hash` |

### 1.7 Cross-cutting schema rules

1. **Envelope vs. attrs discipline:** generic concerns (ranking, decay, provenance) → envelope column; type-specific → `attrs`. A field used in `WHERE` across ≥ 2 types deserves promotion to a real column.
2. **Per-type JSON Schema registry** — a `node_types(name, attrs_schema, schema_ver)` row validates `attrs` at write time (application-level; SQLite JSON doesn't enforce schemas).
3. **Immutability model:** `id` immutable; content mutable with `updated_at` + `content_hash` bump; full snapshots appended to `node_revisions` (§4) for audit and doc diffing.
4. **Dedup keys:** `file.path` (unique); `fact` → normalized-statement hash; `task` → `(session_id, client_task_id)`; `decision`/others → writer must check-before-create via search (the retrieval step agents already run).
5. **Timestamps:** ISO-8601 UTC strings everywhere — lexicographically ordered, human-readable, no timezone bugs.

---

## 2. Edge / relationship taxonomy

### 2.1 Edge schema

Edges are first-class rows, not node fields.

| Field | Type | Notes |
|-------|------|-------|
| `id` | TEXT PK | ULID. |
| `src` | TEXT FK → nodes(id) | subject end. `ON DELETE` restricted — nodes are tombstoned, not deleted. |
| `dst` | TEXT FK → nodes(id) | object end. |
| `type` | TEXT | one of the controlled vocabulary below — CHECK constraint. |
| `weight` | REAL 0–1 | strength/relevance (default 1.0); used in traversal scoring. |
| `confidence` | REAL 0–1 | how sure the relationship holds (auto-extracted edges start lower than agent-asserted ones). |
| `props` | TEXT (JSON) | type-specific properties (see per-type notes). |
| `source` | TEXT | same provenance enum as nodes. |
| `session_id` | TEXT NULL | where the edge was asserted. |
| `created_at` | TEXT | ISO-8601 UTC. |
| `valid_from` / `valid_to` | TEXT \| null | temporal validity; `valid_to IS NULL` = currently valid. Lets memory reflect change ("X *was* the default model"). |
| `UNIQUE(src, dst, type)` | — | idempotent writes; update weight/`valid_to` instead of inserting duplicates. |

### 2.2 The taxonomy

Controlled vocabulary, grouped by family. Direction is `src → dst` as stated. Symmetric types are marked ⟷ and stored once with `src < dst` normalization.

#### Family A — Structural / containment (the graph's skeleton)

| Type | Reads as | Typical endpoints | Key `props` | Notes |
|------|----------|-------------------|-------------|-------|
| `parent_of` | X contains / spawns Y | task→task, doc→doc_section, concept→concept | — | hierarchy backbone; mirrored by the closure table (§4) |
| `part_of` | Y is a component of X | file→concept/module, task→project | `role` | prefer storing `parent_of` only and inverting at query (§2.4) |
| `located_in` | X physically lives in Y | file→file (dir), doc→doc | — | for path hierarchies |
| `has_section` | X has section Y | doc→doc_section | `heading_path` | denormalized convenience for doc rendering |

#### Family B — Provenance & derivation (where did this come from)

| Type | Reads as | Typical endpoints | Key `props` | Notes |
|------|----------|-------------------|-------------|-------|
| `derived_from` | X was inferred from Y | task→session, fact→event, retro→task | `method` (`llm_summary`, `human_edit`, `aggregation`) | every `agent_derived` node must have ≥1 |
| `sourced_from` | X was taken from Y | fact→doc, fact→file, decision→doc | `quote`, `locator` (line/section) | evidence pointer for fact-checking |
| `authored_by` | X was written by Y | any→agent, any→session | `role` (`primary`, `reviewer`) | audit trail |
| `supersedes` | X replaces Y | decision→decision, fact→fact, file→file | `reason` | old node → `status='superseded'`; chain new→old, never re-point old edges (history) |
| `duplicates` | X ≡ Y (dedupe hint) | task→task, fact→fact | — | merge-workflow input; symmetric ⟷ |

#### Family C — Causality & remediation (the debugging bloodstream)

| Type | Reads as | Typical endpoints | Key `props` | Notes |
|------|----------|-------------------|-------------|-------|
| `caused` | X caused Y | decision→error, file→error, decision→failed task | `mechanism` (one sentence) | causal claims demand `confidence < 1.0` unless verified; prefer chains over one giant cause |
| `fixed_by` | X was fixed by Y | error→decision, error→task, fact→decision | `fix_type` (`patch`, `config`, `env_change`, `doc`, `workaround`), `verified` (bool) | `verified=false` until a failing test passes / error stops recurring |
| `regressed_by` | X broke again because of Y | error→task, error→decision | `observed_at` | distinct from `caused` — a *repeat* violation of a prior fix |
| `prevented_by` | X was avoided thanks to Y | task→fact, error→decision | — | credits preventive knowledge (tests, facts) |
| `contributes_to` | X is a partial factor of Y | fact→task, decision→decision | `weight` | weaker-than-`caused` hedge; mechanism unclear |
| `worked_around_by` | X tolerated via Y | error→decision | `cost` | known-broken-but-managed states |

#### Family D — Semantic / topical (the loose tissue)

| Type | Reads as | Typical endpoints | Key `props` | Notes |
|------|----------|-------------------|-------------|-------|
| `related_to` | X and Y are topically linked | any⟷any | `topic`, `discovered_by` (`embedding`, `llm`, `human`), `score` | **the escape hatch — deliberately weak.** Only when a stronger type provably doesn't apply; `embedding`-discovered edges get re-validated or GC'd periodically (§7) |
| `mentions` | X briefly references Y | doc_section→file, task→concept | `count` | co-occurrence harvested from docs/commits; feeds "which docs go stale" (§5) |
| `contradicts` | X and Y cannot both hold | fact⟷fact, fact⟷decision | `as_of`, `resolved_by` | symmetric ⟷; an unresolved `contradicts` is a hygiene TODO |
| `supports` | X is evidence for Y | fact→decision, event→fact, doc→fact | `weight` | epistemic positive; with `contradicts` it gives belief tracking |
| `exemplifies` | X is a concrete case of Y | task→concept, error→concept | — | keeps concept nodes grounded in instances |

#### Family E — Task-flow & dependency (how work connects)

| Type | Reads as | Typical endpoints | Key `props` | Notes |
|------|----------|-------------------|-------------|-------|
| `built_on` | X was created atop Y | task→decision, task→file, file→file, artifact→artifact | `version`, `since` | *reuse*: "this refactor builds on the earlier CLI-flag decision". Software deps use `depends_on` |
| `depends_on` | X cannot proceed without Y | task→task, file→file, decision→fact | `kind` (`hard`/`soft`), `blocking` (bool) | `blocking=true` powers the scheduler's ready-check |
| `modifies` | X changed Y | task→file, decision→file | `diff_ref`, `lines_changed` | makes "what did we touch?" one hop from any failure |
| `produces` | X outputs Y | task→artifact, task→fact, session→event | `media_type` | task outcomes are links, not blobs |
| `consumes` | X takes Y as input | task→artifact, task→file, task→fact | — | different claim from `produces`; store separately |
| `triggers` | X initiates Y | event→task, decision→task, fact→task | `lag` | causal-lite for workflow, no confidence haggling |
| `blocks` | X stops Y | task→task, error→task | `since` | store only the asserting direction; derive inverse |
| `retries` | X is attempt N+1 of Y | task→task | `attempt` | failure-forensics chain |
| `verifies` | X tests/validates Y | task→decision, file→fact, task→task | `method`, `last_run_status` | links acceptance criteria to the facts they guard |
| `assigned_to` | X was given to Y | task→agent | — | delegator's bookkeeping |

#### Family F — Documentation (§5 wiring)

| Type | Reads as | Typical endpoints | Key `props` | Notes |
|------|----------|-------------------|-------------|-------|
| `documented_by` | X has human docs at Y | file→doc_section, decision→doc_section, fact→doc | `rendered_at` (content hash of Y when rendered) | staleness = `nodes.updated_at > rendered_at` (§5.4) |
| `explained_by` | X clarified via Y | concept→doc_section, fact→doc_section | — | glossary-style links |

### 2.3 Choosing a type (decision procedure)

1. Containment? → **A**. "Where did this come from?" → **B**.
2. Is there a mechanism (why did this happen / what fixed it)? → **C** — causal claims require `props.mechanism` or evidence.
3. Workflow (depends on / touched / triggered / verified)? → **E**.
4. Only shares *vocabulary*, no real mechanism? → **D `related_to`** with `topic` + `score`.
5. Two types fit? Pick the **more specific**. None fits cleanly? **Don't invent a type at write time** — write `related_to` with `topic` and propose vocabulary extensions out-of-band (vocab changes are schema migrations).

**Budget heuristic:** A+B+E should dominate; C is smaller but highest-value; `related_to` should stay under ~30% of total edges — past that, the vocabulary is missing a type or the writer is being lazy.

### 2.4 Direction & inverses

- **Store one direction only.** Each type has exactly one storable form; a DB CHECK backed by an `edge_types` registry enforces it.
- Query-time inversion: traversal runs `src = ? UNION ALL SELECT src FROM edges WHERE dst = ? AND inverse_applicable` — the registry's `inverse` column lets the traversal builder flip mechanically.
- Symmetric types (`duplicates`, `contradicts`) store `src < dst` (CHECK) so each pair exists once.
- Recommended registry pairs: `parent_of`↔`part_of`, `caused`↔`caused_by`, `fixed_by`↔`fixes`, `built_on`↔`builds`, `depends_on`↔`dependency_of`, `modifies`↔`modified_by`, `produces`↔`produced_by`, `triggers`↔`triggered_by`, `retries`↔`retried_by`, `verifies`↔`verified_by`, `supports`↔`supported_by`, `documented_by`↔`documents`, `authored_by`↔`authors`, `mentions`↔`mentioned_in`.

### 2.5 Edge anti-patterns

- **Free-text edge types** (`type='kinda related'`) — kills aggregation; the CHECK constraint exists to prevent it.
- **Double-storing inverses** — doubles write cost and drifts ("one row says caused, its inverse says unrelated").
- **Reifying trivia** — "task X happened on date Y" is a column, not node+edge. Reify only when the relationship itself has ≥ 2 meaningful attributes a human would read (a rich `caused` edge with mechanism + evidence + confidence may deserve promotion to an `error` node).
- **Edge-only knowledge** — rationale/fix steps belong in node `body`/docs; edges are for machine traversal.
- **Unbounded `related_to` fan-out** — cap weight/score and GC periodically so 2-hop expansions stay under token budget.

---

## 3. Embedding strategies for semantic search on graph nodes

### 3.1 What gets embedded

- **Canonical text = `title + summary`** (optionally + one type-flavored line: for `file` nodes append `purpose` + top symbols; for `fact` nodes the `statement`; for `decision` nodes `question + choice + rationale`). Never embed `body` wholesale — summary fields exist precisely to be the embedding surface (§1).
- **One vector per node**, keyed `PRIMARY KEY(node_id)` in a side table (§4.4) — embeddings are derived data: rebuildable, never the source of truth.
- **Queries** are embedded with the same model at lookup time and cached by `(model, text_hash)`; node re-embedding is triggered by `content_hash` change.
- Text is normalized before embedding: strip front-matter/markdown noise, collapse whitespace, cap at the model's context window (truncate `rationale`-tail-first, never `summary`-head-first).

### 3.2 Model candidates — small & fast tier

All figures are approximate (verify current versions/sizes before pinning). "Local" = runs on CPU in-process; the design center is a Windows laptop driving several CLI agents, so CPU inference with a quantized ONNX model is the target. A practical runtime is `fastembed`-style ONNX (or `sentence-transformers` + ONNX/int8), keeping the store dependency-light.

| Model | Dims | Params (approx) | CPU latency / short text | Strengths | Watch out for |
|-------|------|-----------------|---------------------------|-----------|---------------|
| `all-MiniLM-L6-v2` | 384 | 22 M | ~3–8 ms | the default baseline; tiny, fast, huge install base | English-centric; weaker on code identifiers |
| `bge-small-en-v1.5` | 384 | 34 M | ~4–10 ms | best-in-class at this size on MTEB-style retrieval; 512 tok | benefits from query/passage prefixes |
| `gte-small` | 384 | 34 M | ~4–10 ms | strong general retrieval, no prefix ceremony | less tooling than BGE/MiniLM |
| `bge-base-en-v1.5` | 768 | 109 M | ~10–25 ms | quality bump when 384-dim precision isn't enough | 4× storage of small tier |
| `nomic-embed-text-v1.5` | 768 (Matryoshka → 256) | 137 M | ~12–30 ms | 8 k context — embeds whole small docs; MRL truncation to 256 dims | needs `search_query:`/`search_document:` prefixes |
| `snowflake-arctic-embed-s` | 384 | 33 M | ~4–10 ms | retrieval-tuned at tiny size | narrower ecosystem |
| `bge-m3` | 1024 (+ sparse) | 568 M | ~40–90 ms | multilingual + 8 k + hybrid sparse/dense | heaviest on this list; only for multilingual needs |
| `Qwen3-Embedding-0.6B` | up to 1024 (MRL) | 0.6 B | ~60–150 ms CPU | very strong quality/size, multilingual, truncatable | the "big small" — upgrade path, not the default |
| API: `text-embedding-3-small` | 1536 (truncatable) | hosted | network-bound | zero local compute, strong general quality | cost/latency per call, privacy, offline impossible |

**Recommendation for this project:** start with **`bge-small-en-v1.5` (384 dims, int8-quantized ONNX)** — fast enough to embed at every write on CPU, small enough (~40–70 MB incl. runtime) to bundle, competent on English + code identifiers. Promote to `nomic-embed-text-v1.5` (256-dim MRL truncation) if long docs enter the index; `Qwen3-Embedding-0.6B` only if retrieval quality is *measured* to be the bottleneck.

### 3.3 Index & storage strategy

- **Storage:** vectors as float32 BLOBs (little-endian, 4 B per component) in a side table. 384 dims × 4 B = **1.5 KB/node** → 100 k nodes ≈ 150 MB (256-dim truncation ≈ 100 MB). Quantize the *model* (int8 ONNX); keep stored vectors float32 unless recall is measured to survive int8 storage.
- **Search backend (progressive enhancement):**
  1. **Floor (G6):** no vector extension — FTS5 only (§4.5).
  2. **Default:** **`sqlite-vec`** extension (`vec0` virtual table, KNN `k=?`, loadable at runtime, single-file DB preserved) — KNN over 100 k × 384-dim vectors is single-digit ms on CPU.
  3. Below ~50 k nodes without the extension, in-process scan over BLOBs with numpy (50 k × 384 dot products ≈ few ms) is acceptable; beyond that, don't hand-roll it — load the extension.
- **Model versioning:** every vector row carries `model_id` + `dims` + the hash of its embedded text. Model change = background re-embed (idempotent, batched, content-hash triggered); during migration query both model IDs and union, then gate by `model_id`.
- **Matryoshka:** if the model supports MRL (nomic, Qwen3, `3`-series API models), keep the full vector and derive truncated prefixes at index time for a smaller ANN table — measure recall@k before committing.

### 3.4 Hybrid retrieval pipeline (the actual search path)

Pure vector search underperforms on *identifier-shaped* queries (`dispatch.py`, `MISTRAL_API_KEY`, `grok --print`) — exactly what coding agents search for. Use a three-channel pipeline, then graph-expand:

1. **Lexical channel (FTS5):** BM25 over `title|summary|body`; high weight for exact identifier/path hits; prefix matching (`grok *`) for partial symbols.
2. **Vector channel:** embed query → top-k (k≈20) cosine neighbors over node embeddings.
3. **Structured channel:** direct key lookups (`file.path = ?`, `attrs.client_task_id = ?`, tag equality) — exact matches win outright.
4. **Fusion:** Reciprocal Rank Fusion (RRF, k≈60) over the three lists — parameter-free, robust to score-scale mismatch: `RRF(n) = Σ_channels 1 / (60 + rank_channel(n))`.
5. **Graph expansion:** take top m≈5 seeds; expand **1 hop** (2 only if < 5 seeds) over high-`confidence` edges of families A/B/C/E; expanded neighbors get `RRF × decay(hop)` so they can't outrank seeds unless weight justifies it. This is where the *graph* beats flat vector search: "why did vibe charge us?" seeds a fact, expands `caused`→decision→`documented_by`→doc in one hop each.
6. **Filters & rerank:** drop `tombstoned`/`superseded` nodes (keep them for explicit history queries), apply `scope` + `salience` floor, cap ~20 nodes / token budget before prompt assembly.

Query-side caching: `query_hash → ranked node ids`, short TTL (minutes), keys normalized (lowercase, collapsed whitespace) so paraphrases in one session hit cache.

### 3.5 Embedding-specific anti-patterns

- **Embedding file contents** — duplicates git's job, burns storage, drowns purpose in boilerplate.
- **Mixed-language index without a multilingual model** — cross-lingual recall collapses silently.
- **Re-embedding only on node write** — `file` nodes also re-embed when tooling refreshes `purpose`/`symbols` (same content-hash trigger).
- **Treating cosine as truth** — similarities order candidates; *edges* assert relationships. Never mint `related_to` from raw cosine without a threshold **and** `props.discovered_by='embedding'` so it can be GC'd (§2.2-D).
- **One giant doc as one vector** — beyond ~2× context window, embed per `doc_section` (why §1.6 makes sections nodes).

---

## 4. SQLite schema patterns for graph storage

### 4.1 Pattern comparison

| Pattern | Shape | Strengths | Weaknesses | Verdict here |
|---------|-------|-----------|------------|--------------|
| **A. Adjacency list per node** | node row has `neighbors` / `children` JSON array of ids | one-row neighborhood read; trivially serializable into a prompt | no referential integrity; every traversal = app-side id resolution; inverses must be hand-maintained (double-write); edge *properties* have nowhere to live; concurrent writers corrupt/lose entries | ❌ as primary store; ✅ as a **read-model cache** (rendered neighborhood JSON for prompt assembly) |
| **B. Property graph (nodes + edges tables)** | `nodes(id, …)` + `edges(src, dst, type, props)` | integrity via FKs; edges carry `props`; traversals in recursive CTEs; one hop = indexed join | multi-hop joins get verbose; depth-heavy hierarchies slower than closure | ✅ **primary pattern** |
| **C. Typed sub-tables (EAV-ish vertical partitioning)** | `task_nodes`, `decision_nodes`, … 1:1 with `nodes` | real columns → SQL type checks + indexes per field | schema bloat (a table per type); every generic read = N joins; migration per new type | ⚠️ only if a specific type's field needs heavy SQL filtering; otherwise `attrs` JSON1 suffices |
| **D. Closure table** | `closure(ancestor, descendant, depth)` for hierarchies only | O(1) subtree & depth queries; flat SQL, no recursion | must be maintained transactionally with `parent_of`; only meaningful for tree-shaped families | ✅ **for task trees & doc/doc_section trees** (where `parent_of` exists) |
| **E. Single JSON document** | whole graph = one row/file | atomic snapshot, easy export | O(graph) rewrite per edit; no concurrent anything; no indexes | ⚠️ only as an **export format**, not storage |
| **F. Triple store (RDF-style s,p,o)** | minimal triples table | maximally simple; aligns with `triple` attr of facts | edge props/confidence/time forced into reification; verbose queries | ❌ — a property graph with a *disciplined* vocabulary gets 90% of RDF's clarity without its ceremony |

**Decision: B (primary) + D (hierarchies) + A (as prompt-assembly cache) + JSON export (E).** SQLite's JSON1 functions make C unnecessary for most type-specific filtering (`json_extract(attrs, '$.state')` with expression indexes on hot paths).

### 4.2 Reference DDL (concrete proposal)

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE nodes (
  id           TEXT PRIMARY KEY,                    -- ULID
  type         TEXT NOT NULL CHECK (type IN
               ('task','decision','file','fact','doc','doc_section',
                'agent','session','event','error','concept','artifact')),
  title        TEXT NOT NULL,
  summary      TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','superseded','tombstoned')),
  tags         TEXT NOT NULL DEFAULT '[]',          -- JSON array
  scope        TEXT NOT NULL DEFAULT 'project'
               CHECK (scope IN ('global','project','module','session')),
  confidence   REAL NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  salience     REAL NOT NULL DEFAULT 0.5 CHECK (salience BETWEEN 0 AND 1),
  attrs        TEXT NOT NULL DEFAULT '{}',          -- type-specific JSON
  source       TEXT NOT NULL CHECK (source IN
               ('user_stated','agent_observed','agent_derived','imported','human_edit')),
  session_id   TEXT,
  schema_ver   INTEGER NOT NULL DEFAULT 1,
  content_hash TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  accessed_at  TEXT NOT NULL
);

CREATE INDEX idx_nodes_type_status ON nodes(type, status);
CREATE INDEX idx_nodes_updated     ON nodes(updated_at);
CREATE UNIQUE INDEX uq_file_path   ON nodes(json_extract(attrs,'$.path'))
  WHERE type = 'file' AND status <> 'tombstoned';
```

```sql
-- Edge-type registry: the vocabulary is data, not just constraints.
CREATE TABLE edge_types (
  name        TEXT PRIMARY KEY,
  inverse     TEXT NOT NULL,               -- e.g. 'caused' -> 'caused_by'
  symmetric   INTEGER NOT NULL DEFAULT 0,  -- 1 => store with src < dst
  families    TEXT NOT NULL DEFAULT '[]',  -- JSON: which families it may traverse
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE edges (
  id          TEXT PRIMARY KEY,
  src         TEXT NOT NULL REFERENCES nodes(id),
  dst         TEXT NOT NULL REFERENCES nodes(id),
  type        TEXT NOT NULL REFERENCES edge_types(name),
  weight      REAL NOT NULL DEFAULT 1.0 CHECK (weight BETWEEN 0 AND 1),
  confidence  REAL NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  props       TEXT NOT NULL DEFAULT '{}',
  source      TEXT NOT NULL,
  session_id  TEXT,
  created_at  TEXT NOT NULL,
  valid_from  TEXT NOT NULL,
  valid_to    TEXT,                          -- NULL = currently valid
  CHECK (src < dst OR (SELECT symmetric FROM edge_types WHERE name = type) = 0),
  UNIQUE (src, dst, type)
);
CREATE INDEX idx_edges_src ON edges(src, type) WHERE valid_to IS NULL;
CREATE INDEX idx_edges_dst ON edges(dst, type) WHERE valid_to IS NULL;
CREATE INDEX idx_edges_type ON edges(type) WHERE valid_to IS NULL;

-- Closure table: maintained transactionally with every parent_of write.
CREATE TABLE closure (
  ancestor   TEXT NOT NULL REFERENCES nodes(id),
  descendant TEXT NOT NULL REFERENCES nodes(id),
  depth      INTEGER NOT NULL CHECK (depth > 0),
  PRIMARY KEY (ancestor, descendant)
) WITHOUT ROWID;
CREATE INDEX idx_closure_desc ON closure(descendant);

-- Append-only revision log for audit + doc-diff (§5).
CREATE TABLE node_revisions (
  node_id    TEXT NOT NULL REFERENCES nodes(id),
  rev        INTEGER NOT NULL,               -- monotonic per node
  snapshot   TEXT NOT NULL,                  -- full node JSON at rev
  actor      TEXT NOT NULL,                  -- agent id or 'human'
  session_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (node_id, rev)
);
```

Notes on the DDL:

- **Subquery in `CHECK` is illustrative** — SQLite cannot call subqueries in CHECK constraints. Enforce the symmetric/inverse rules with **triggers** (before-insert: look up `edge_types`, flip `src/dst` when `symmetric=1` and `src > dst`; reject unknown types before the FK fires) or application-level validation. The `type → edge_types(name)` FK alone guarantees a closed vocabulary.
- **Partial indexes with `WHERE valid_to IS NULL`** keep hot-path traversals small; historical edges age out of the index but stay in the table.
- **`closure` is keyed on ids only** (`WITHOUT ROWID`) — it's pure structure; all attribute reads still hit `nodes`.
- **Revisions on every write** is the only unbounded-growth table: cap with a retention policy (keep rev 1 + last N + all revs touched by a `decision`/`fact` — those are the audit-critical ones).

### 4.3 Search side-tables (FTS5 + vectors)

```sql
-- Lexical channel: external-content FTS5 kept in sync by triggers.
CREATE VIRTUAL TABLE node_fts USING fts5(
  title, summary, body, tags,
  content='nodes', content_rowid='rowid',
  tokenize = 'unicode61 remove_diacritics 2'
);
-- triggers: AFTER INSERT/UPDATE ON nodes -> INSERT/DELETE node_fts (standard
-- external-content pattern); queries use the 'rowid' join back to nodes.

-- Vector channel: sqlite-vec virtual table, one per active model.
CREATE VIRTUAL TABLE node_vec USING vec0(
  node_id TEXT PRIMARY KEY,
  model   TEXT,
  embedding float[384]           -- dims pinned per model/table
);
-- fallback when the extension is absent: plain side table, brute-force/np scan
CREATE TABLE node_vec_fallback (
  node_id    TEXT NOT NULL PRIMARY KEY REFERENCES nodes(id),
  model      TEXT NOT NULL,
  text_hash  TEXT NOT NULL,      -- skip re-embed when unchanged
  dims       INTEGER NOT NULL,
  embedding  BLOB NOT NULL       -- little-endian float32
);
```

Also proposed: `query_cache(query_hash, model, ranked_ids JSON, expires_at)` for §3.4's TTL cache, and `edge_prop` expression indexes (`json_extract(props,'$.fix_type')`) only once a query pattern proves hot.

### 4.4 Canonical traversal queries

Bounded 1-hop neighborhood (both directions, only currently-valid edges):

```sql
SELECT e.type, e.dst AS other_id, e.weight, e.confidence, e.props
  FROM edges e WHERE e.src = :id AND e.valid_to IS NULL
UNION ALL
SELECT e.type, e.src, e.weight, e.confidence, e.props
  FROM edges e WHERE e.dst = :id AND e.valid_to IS NULL
  AND e.type IN (SELECT name FROM edge_types WHERE inverse_applicable = 1);
```

Bounded N-hop expansion via recursive CTE (the workhorse of §3.4 step 5):

```sql
WITH RECURSIVE walk(id, depth) AS (
  SELECT :seed, 0
  UNION                                   -- UNION (not ALL) caps cycles
  SELECT CASE WHEN e.src = w.id THEN e.dst ELSE e.src END, w.depth + 1
    FROM walk w JOIN edges e
      ON (e.src = w.id OR e.dst = w.id) AND e.valid_to IS NULL
   WHERE w.depth < :max_depth
)
SELECT id, depth FROM walk
 WHERE depth > 0
 ORDER BY depth;
```

Full-subtree dump in one shot (where the closure table pays for itself):

```sql
SELECT n.id, n.type, n.title, c.depth
  FROM closure c JOIN nodes n ON n.id = c.descendant
 WHERE c.ancestor = :task_root AND n.status = 'active'
 ORDER BY c.depth, n.created_at;
```

**Adjacency-list read-model:** after the queries above, the neighborhood is rendered once into a `{"node": …, "neighbors": [{type, node}]}` JSON blob for prompt assembly and cached (`neighbor_cache(node_id, rev, payload)`) — pattern A used where it's strong (read), pattern B where it's strong (write/query).

### 4.5 Operational patterns

- **WAL + single-writer:** WAL gives concurrent readers during writes; with several CLI agents writing, funnel writes through **one writer process/queue** (matches `cli-swarm`'s dispatcher shape) instead of N processes fighting for the write lock. `busy_timeout` covers stragglers.
- **Atomic multi-row operations:** node + edges + closure + revision + FTS + vector updates go in **one transaction** — the graph never observes half a write (e.g., a `fixed_by` edge without its decision node).
- **Idempotency:** `INSERT … ON CONFLICT DO UPDATE` keyed on the unique constraints (`uq_file_path`, `edges(src,dst,type)`, `client_task_id`) — retries from crashed agents are safe.
- **Migrations:** `PRAGMA user_version` (or a `migrations` table) for envelope changes; per-type `schema_ver` in `attrs` upgraded lazily on read/write (expand → migrate → contract).
- **Backups / export:** `VACUUM INTO 'snapshot.db'` for binary snapshots; a JSON-lines export (nodes, edges) for pattern E — also the interchange format when another tool needs the graph.
- **Health queries (cheap observability):** edge-family histogram (is `related_to` > 30%? §2.3); unresolved `contradicts` count; `fixed_by` edges with `verified=0`; nodes never accessed in 90 days (decay/prune candidates); docs with `documented_by.rendered_at < nodes.updated_at` (stale docs, §5.4).

---

## 5. Documentation-as-layer pattern

### 5.1 The idea

The graph is **not** the thing humans read. Durable, human-readable docs (the repo's `README.md`, `references/cli-invocation.md`, `AGENTS.md`, ADRs…) are a **projection layer rendered from graph nodes**, maintained by agents, versioned in git, and *bound back* to the nodes they came from — so both sides know when the other moved.

```
┌─────────────────────────────────────────────┐
│  L3  Docs (markdown, git, humans + agents)  │  ← what people & context-windows read
├─────────────────────────────────────────────┤
│  L2  Graph (SQLite: nodes + edges)          │  ← canonical structured memory
├─────────────────────────────────────────────┤
│  L1  Vectors + FTS indexes                  │  ← derived search accelerators (§3–4)
├─────────────────────────────────────────────┤
│  L0  Raw traces (JSONL logs, transcripts,   │  ← immutable evidence, never edited
│      diffs, test output)                    │
└─────────────────────────────────────────────┘
```

**Invariants:**
1. **Docs never contain facts the graph doesn't know** (docs are *written from* nodes), and **the graph never depends on docs for machine decisions** (edges don't point into prose — they point at `doc_section` nodes that *represent* prose).
2. Every generated doc region is **regenerable**: delete the file, re-render from the graph, get it back.
3. Every bound region carries **provenance back-links** (node ids + revision hashes), so staleness is a query, not a feeling.
4. Humans may hand-edit docs; the pipeline treats hand-edits as a merge, not an error (§5.5).

### 5.2 Doc → graph bindings (schema)

```sql
-- docs are nodes (type='doc'), sections are nodes (type='doc_section')
CREATE TABLE doc_bindings (            -- which nodes a section renders
  section_id    TEXT NOT NULL REFERENCES nodes(id),
  node_id       TEXT NOT NULL REFERENCES nodes(id),
  anchor        TEXT NOT NULL,         -- heading path inside the file, e.g. "Fixes > vibe"
  rendered_hash TEXT NOT NULL,         -- content_hash of the node AT render time
  rendered_at   TEXT NOT NULL,
  PRIMARY KEY (section_id, node_id)
);
CREATE INDEX idx_bindings_node ON doc_bindings(node_id);
```

Corresponding markdown markers (the doc half of the binding):

```markdown
<!-- kg:section id=01J… anchors=01J9QK…,01J9PG… rendered=2026-09-24T10:00Z -->
### vibe provider routing

- **Fact:** vibe uses paid Mistral API when `MISTRAL_API_KEY` is set → strip via `CLI_ENV_OVERRIDES`.
- **Decision:** env overrides live in `dispatch.py` (accepted 2026-09-20, two-way door).
<!-- /kg:section -->
```

The `id` is the `doc_section` node's ULID; `anchors` lists the rendered source-node ids; `rendered=` lets a doctoring script diff without touching the DB.

### 5.3 Render types (what gets projected to docs)

| Doc artifact | Rendered from | Trigger |
|--------------|---------------|---------|
| **Decision log / ADR files** (`docs/decisions/…`) | `decision` nodes (`state != proposed`) | on accept/supersede |
| **Fix & failure ledger** (`docs/incidents.md`) | `error` + `fixed_by`/`regressed_by` edges, ordered by `last_seen` | on fix verify / regression |
| **File map / architecture guide** | `file` nodes grouped by `module` — one bullet per `purpose`, linked to `documented_by` sections | on file add/delete/rename |
| **Task retros / lessons** (`docs/retros.md`) | `task.retro` promoted to `fact` nodes with `derived_from` | end of session |
| **READMEs** (repo & per-module) | curated mix: manual intro + generated "current state" sections (top tasks, active constraints) | scheduled (daily) or ≥ N node changes |
| **Health dashboard** (optional HTML/MD) | §4.5 health queries | scheduled |

Manual prose lives **outside** `<!-- kg:section -->` markers; inside markers, agents own the text.

### 5.4 Staleness loop (how docs stay durable)

1. **Detect:** `SELECT … FROM doc_bindings b JOIN nodes n ON n.id = b.node_id WHERE n.content_hash != b.rendered_hash` — any hit = stale section. Exact (hash equality is the truth; `rendered_at` is informational), no clock races.
2. **Plan:** group stale nodes by section/file; drop sections whose node set emptied (render-type-specific); create/queue a **task node** per doc file ("re-render `docs/incidents.md`: 3 nodes changed") — maintenance work is itself in the graph.
3. **Render:** template → markdown; write markers with fresh `rendered_hash`es; commit to git as `docs(kg): re-render <file>` (diff reviewable like any code change).
4. **Verify:** a checker command exits non-zero if any binding is stale or a marker is malformed → CI / pre-commit, same spirit as this repo's "verified … cross-check with `--help`" convention: *trust but re-check*.
5. **Prune:** node tombstoned/superseded → its bullet disappears at next render; empty section → `doc_section` node tombstoned, heading removed.

### 5.5 Human edits (the merge path)

- **Outside markers:** untouched forever. If the prose states something the graph lacks, an ingest pass (LLM diff-reader) proposes new `fact`/`decision` nodes — human text wins, graph *learns*.
- **Inside markers:** detected as "file bytes changed while bindings still match the node hashes". Two resolutions, never silent overwrite: (a) **promote** — extract the hand text into node content, re-render (graph wins, but seeds from the human's wording); (b) **demote** — mark the section manual (convert to outside-marker prose, unlink bindings).
- **Round-trip guarantee:** markers carry node ids + hashes, so after (a) the next re-render reproduces the human's wording (it's now node content) — no diff thrash.

### 5.6 Reading order for agents (why the layer pays off)

1. **Generated index** — `docs/README.md` "current state" section, one screen.
2. **Relevant doc sections** — found via FTS/vector over *nodes*, materialized as prose; prose is denser per token than JSON node dumps.
3. **Graph neighborhood** of the specific nodes under work (§4.4, 1-hop) — exact rationales, edge metadata.
4. **Raw trace** only when debugging (L0 pointer from `attrs.event_ref`).

Docs give **lossy-but-dense** recall (great context-per-token); the graph gives **lossless, queryable** recall. The binding/staleness machinery exists so the dense layer can never silently contradict the canonical one.

### 5.7 Anti-patterns

- **Docs as a second source of truth** (facts living *only* in markdown) — guarantees divergence; every durable fact gets a node; prose is its projection.
- **Regenerating everything every session** — noisy history + hand-edit collisions; only stale sections re-render (§5.4-2).
- **File-level bindings** — too coarse; staleness at *section* granularity keeps diffs small.
- **Prose duplicated in `body` *and* docs with no owner** — pick roles: `body` = short canonical statement, docs = markered expansion; `rendered_hash` diffs keep them from drifting.
- **Doc↔doc links that model real relations but aren't bindings** — they won't survive regeneration; make them `doc_section`↔node bindings.

---

## 6. Worked example (end-to-end)

Scenario grounded in this repo: *vibe unexpectedly billed Mistral*. How each layer records it:

**L0 (raw):** `cli-swarm-log.jsonl` line — `{ts, task:"make vibe free", cli:"vibe", status:"success", notes:"MISTRAL_API_KEY was in env"}`.

**L2 (graph):**

| Node | Type | Key content |
|------|------|-------------|
| `N1` | `error` | fingerprint = "vibe→paid-mistral", `occurrence_count=1` |
| `N2` | `fact` | statement: "vibe routes to paid Mistral API when `MISTRAL_API_KEY` is present"; `source_kind=observed`, `category=environment` |
| `N3` | `decision` | question: "How to keep vibe free?", choice: "strip key via `CLI_ENV_OVERRIDES`", `reversibility=two_way` |
| `N4` | `task` | goal "dispatch vibe without paid key", `state=done`, assignee `codex`, `outcome.duration_seconds=37` |
| `N5` | `file` | path `cli-swarm/scripts/dispatch.py`, purpose "resolves CLI binaries, applies env overrides, runs headless" |
| `D1` | `doc_section` | anchor `"Key fixes > vibe uses paid Mistral API"` in `README.md` |

Edges: `N5 caused N1` (mechanism: env passthrough) · `N1 fixed_by N3` (`fix_type=config`, `verified=true`) · `N2 supports N3` · `N4 modifies N5` (`diff_ref`) · `N3 documented_by D1`, `N2 documented_by D1` — the README bullet is *rendered from* the nodes, so **bindings** (§5.2) carry that direction, not a prose edge · `N4 derived_from` the session node.

**L1 (search):** query "why did vibe cost money" → FTS hits `MISTRAL_API_KEY` in `N2` (lexical win) *and* vector hits `N1`/`N3` (semantic win) → RRF ranks `N2` top → 1-hop expansion pulls `N3`, `N5`, `D1` → agent receives 4 nodes + the doc section, not a raw log dump.

**L3 (docs):** `README.md` §"Key fixes" marker block lists the fact + decision; `doc_bindings` rows tie `D1 → {N2, N3}` with `rendered_hash`s. When `N3` later gains `regressed_by`/`outcome_notes`, the hash mismatch re-renders exactly that bullet.

Token economics: raw-trace reading ≈ full log; graph+doc path ≈ 200–400 tokens of context for the same orientation.

---

## 7. Anti-patterns & open questions

### Consolidated anti-patterns

| Area | Anti-pattern | Prefer |
|------|--------------|--------|
| Nodes | god-object nodes with everything in `body` | envelope + typed `attrs` + summary-as-embedding-surface |
| Nodes | hard deletes | tombstones (`status`, `valid_to`) |
| Nodes | storing file contents / log payloads in nodes | pointers (`content_hash`, `event_ref`) |
| Edges | free-text types, double-stored inverses | registry + CHECK/trigger + query-time inversion |
| Edges | `related_to` as default (> ~30% of edges) | §2.3 decision procedure + budget heuristic |
| Edges | causal claims at `confidence=1.0` without evidence | mechanism/evidence props, `verified` flags |
| Search | vector-only retrieval | hybrid FTS5 + vector + structured, RRF, then graph-expand |
| Search | embedding bodies/files wholesale | `title+summary(+purpose)` only |
| Storage | adjacency JSON as source of truth | property graph primary; adjacency as read cache |
| Storage | per-process writers on one SQLite file | WAL + single writer queue |
| Docs | dual source of truth | graph canonical, docs projected + hash-bound |
| Docs | full re-render every session | section-granular staleness via `rendered_hash` |

### Open questions (worth measuring before v1.0)

1. **Salience decay math:** exponential vs. half-life tables per type; does `accessed_at`-driven boost cause rich-get-rich loops that bury new facts?
2. **Contradiction resolution:** when `fact A contradicts fact B` and evidence arrives, who decides — confidence race, TTL on the older, or human? (Proposal: `source_kind` precedence + `review_at` escalation, but measure.)
3. **`related_to` GC:** threshold + TTL re-validation (re-run embedding score; drop if similarity decayed) vs. periodic LLM triage cost.
4. **Closure maintenance cost:** for task trees deeper than ~10, is closure worth it vs. recursive CTE with a depth cap? Leaning: cap task depth at 6 anyway.
5. **Cross-session entity resolution:** same task rephrased by a different CLI — embed-and-cluster vs. mandatory `client_task_id`? Leaning: idempotency key mandatory for anything billing-adjacent; embedding only advisory.
6. **Vector index at 10⁶ nodes:** does `sqlite-vec` still hold, or time for a dedicated sidecar ANN over the same BLOBs? The side-table design defers this decision.
7. **Doc-section anchoring:** heading paths break on renames; region-content hashes break on any hand edit outside markers — hybrid (heading path + surrounding-text fingerprint) probably wins.

---

## 8. References

- SQLite FTS5 full-text extension — <https://www.sqlite.org/fts5.html>
- SQLite recursive CTE traversal — <https://www.sqlite.org/lang_with.html>
- SQLite WAL mode — <https://www.sqlite.org/wal.html>
- sqlite-vec (in-process vector search extension) — <https://github.com/asg017/sqlite-vec>
- ULID (sortable unique ids) — <https://github.com/ulid/spec>; UUIDv7 in RFC 9562 — <https://www.rfc-editor.org/rfc/rfc9562.html>
- fastembed (quantized ONNX embedding runtime) — <https://github.com/qdrant/fastembed>
- `BAAI/bge-small-en-v1.5` — <https://huggingface.co/BAAI/bge-small-en-v1.5>
- `sentence-transformers/all-MiniLM-L6-v2` — <https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2>
- `nomic-ai/nomic-embed-text-v1.5` — <https://huggingface.co/nomic-ai/nomic-embed-text-v1.5>
- `Qwen/Qwen3-Embedding-0.6B` — <https://huggingface.co/Qwen/Qwen3-Embedding-0.6B>
- MTEB (embedding benchmark) — <https://github.com/embeddings-benchmark/mteb>
- Reciprocal Rank Fusion — Cormack et al., SIGIR 2009; overview: <https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking>
- Architecture Decision Records (the decision-node's human-facing ancestor) — <https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions>
- Zep / Graphiti — temporal knowledge-graph memory for agents (prior art for fact/edge validity windows) — <https://github.com/getzep/graphiti>
- GraphRAG (Microsoft) — graph-guided retrieval patterns — <https://github.com/microsoft/graphrag>
- LlamaIndex property-graph index (typed edge extraction prior art) — <https://docs.llamaindex.ai/en/stable/module_guides/indexing/lpg_index_guide/>
- In-repo ground truth: `cli-swarm/scripts/log_delegation.py` (L0 record shape), `cli-swarm/README.md` (today's manual doc layer), `research/raw/` (L0 captures of agent research).

---

*End of report. Implementation milestones if this is built: **M1** = envelope + `edges` + FTS5 + single-writer queue (goals G1–G4, G6); **M2** = `sqlite-vec` + bge-small ONNX + RRF pipeline (full G2); **M3** = doc bindings + render/check loop (G3); **M4** = closure table + health queries + decay tuning (open questions 1–4).*













