# akitaonrails/ai-memory — Cross-Agent Persistent Memory

**Repo:** https://github.com/akitaonrails/ai-memory  
**Stars:** 8.3k | **Language:** Rust + SQLite + FTS5 | **2,074 commits, very active**  
**Verdict:** Reference ★★ — strongest M3 reference found. Read before writing search.go.

---

## What it does
Persistent memory layer shared across AI coding agents and machines. Agents emit observations via lifecycle hooks; at session end these consolidate into markdown wiki + SQLite FTS5 indexes. Cross-agent handoff: pause in Claude Code, resume in Codex with full context. Zero-LLM default (all search runs offline). Optional "Dream" mode runs background LLM consolidation (maps to our M5 self-improvement loop).

---

## Patterns to take

### 1. Source-authority RRF weighting (M3 — most important)
Their RRF doesn't use flat `k=1`. Results are weighted by source trust level.

We already have `source` + `confidence` columns — just factor them into scoring:
```go
// search.go — update RRF to weight by source authority
func sourceAuthority(source string, confidence float64) float64 {
    base := map[string]float64{
        "user_stated":    1.0,
        "agent_observed": 0.7,
        "agent_derived":  0.5,
    }[source]
    return base * confidence
}

// In RRF fusion:
for rank, r := range vecResults {
    authority := sourceAuthority(r.Source, r.Confidence)
    scores[r.ID] += authority / (1.0 + float64(rank))
}
```

### 2. Episodes as fallback search (M3)
If nodes/edges search returns zero results, fall back to scanning `episodes` table raw content via FTS5.  
Prevents silent misses when a fact was never extracted into the graph.

```go
// search.go
func (s *Store) HybridSearch(ctx context.Context, query string, limit int) ([]SearchResult, error) {
    results := s.searchGraph(ctx, query, limit)
    if len(results) == 0 {
        // fallback: scan raw episodes
        results = s.searchEpisodes(ctx, query, limit)
    }
    return results, nil
}
```

FTS5 on episodes:
```sql
CREATE VIRTUAL TABLE episodes_fts USING fts5(content, content=episodes, content_rowid=rowid);
```

### 3. Three-tier storage insight
ai-memory separates: wiki (human-editable markdown) / db (FTS5 index) / raw (transcripts).  
We collapse all into SQLite, but the principle still applies — keep `body` field in nodes as the human-readable tier that can be exported to markdown for inspection/editing.

### 4. Dream mode → M5 self-improvement
Background LLM consolidation pass: re-reads recent episodes, extracts new facts, updates the graph.  
Maps directly to our M5 observer/reflector loop. Run at session boundary or on a timer.

---

## Schema additions for M3

```sql
-- Already have source TEXT on nodes — just add authority weight to FTS ranking
-- Add episodes FTS5 virtual table for fallback search:
CREATE VIRTUAL TABLE episodes_fts USING fts5(content, content=episodes, content_rowid=rowid);
```

No other schema changes needed — source-authority is a query-time scoring adjustment, not a schema change.

---

## Read before: M3 search.go (hybrid search + RRF scorer)
