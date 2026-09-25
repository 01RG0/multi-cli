# hindsight — Biomimetic Agent Memory

**Repo:** https://github.com/vectorize-io/hindsight  
**Stars:** 27.4k | **Language:** Python + Go client | **Active**  
**Verdict:** Reference ★ — read before M3 schema finalization

---

## What it does
Production agent memory system with four parallel retrieval strategies (semantic, BM25, graph traversal, temporal) fused via RRF. Three core ops: Retain / Recall / Reflect — maps 1:1 to our store/search/improvement loop. PostgreSQL + pgvector backend (not portable), but has a Go client.

---

## Patterns to take for M3

### Bank isolation (scoped memory)
Memory is scoped per agent/project/session — queries never bleed across banks.  
**Apply:** enforce `scope` column filter at query time in every search path, not just at insert.
```go
// search.go — add to every query
WHERE n.scope IN (?, 'global') -- session_id + always include global
```

### Observation consolidation
Before inserting a new node, check for near-duplicate (title similarity + same type).  
If match found: update `summary` + bump `updated_at` + add episode reference. Don't create a duplicate.
```go
// store.go
func (s *Store) UpsertNode(ctx context.Context, n Node) (Node, error) {
    existing := s.findSimilar(ctx, n.Title, n.Type, threshold: 0.85)
    if existing != nil {
        return s.mergeNode(ctx, existing, n)
    }
    return s.insertNode(ctx, n)
}
```

### Mental models → high-salience nodes
Standing answers that auto-update. In our schema: nodes with `salience > 0.8` get re-evaluated on each `Reflect` pass (M5). Flag them in `attrs` JSON.

---

## Go client
`github.com/vectorize-io/hindsight-go` — could serve as fallback memory backend if SQLite proves insufficient. Don't use now, keep as escape hatch.

---

## Read before: M3 store.go + search.go
