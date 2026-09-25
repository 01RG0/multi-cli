# Hybrid Graph + Vector Search for AI Agent Memory

*Source: Claude deep-research agent (web)*

## Summary

All mature systems use a **three-phase pattern**: vector seed retrieval → graph expansion via BFS → score fusion (RRF or weighted). Graphiti is the most complete open-source reference implementation.

---

## Production System Patterns

### Graphiti / Zep — Most Complete OSS Reference

Three parallel retrieval channels:
1. `edge_fulltext_search` / `node_fulltext_search` — BM25 via Cypher full-text index
2. `cosine_similarity` — vector index, filtered by `sim_min_score` (default 0.6)
3. `bfs` — breadth-first search up to `config.bfs_max_depth` hops from center node

Four reranker options:

| Reranker | Formula |
|---|---|
| **RRF** (default) | `score += 1 / (rank_position + k)`, accumulated across channels |
| **MMR** | `λ × cos(q, c) + (1-λ) × max_sim_to_selected` — relevance vs. diversity |
| **Cross-encoder** | Neural reranking on `(query, fact_description)` pairs — most expensive |
| **Node distance** | `1 / hop_distance_from_center` — pure graph proximity |

Preset configs: `COMBINED_HYBRID_SEARCH_RRF`, `COMBINED_HYBRID_SEARCH_CROSS_ENCODER`, `COMBINED_HYBRID_SEARCH_MMR`

**GitHub:** https://github.com/getzep/graphiti

### Microsoft GraphRAG

NOT a true hybrid score — separates concerns:
1. Vector similarity → entity retrieval
2. Relationship graph → neighbor expansion (ranked by shared-entity count)
3. Community summaries → tiered context allocation by token budget

No single formula that blends cosine + graph proximity. More of a context-building decision than a scoring system.

**GitHub:** https://github.com/microsoft/graphrag

### LightRAG

- Extracts **local keywords** (entity-targeted) and **global keywords** (relation-targeted)
- Matches each against separate vector indices
- One-hop neighbors added to union result set
- No explicit scoring formula — concatenated text passed to LLM

---

## Scoring Formulas

### A. Weighted Linear Combination (Simple, production-ready)
```
score(node) = α × cosine_sim(query_emb, node_emb) + (1-α) × 1/(1 + hop_dist)
```
Typical `α = 0.6` (60% vector, 40% proximity). Start here.

### B. Reciprocal Rank Fusion (Robust, no tuning needed)
```
rrf_score(item) = Σ 1 / (k + rank_i(item))
```
- `k=1` (Graphiti default), `k=60` (IR literature default for longer lists), `k=2` (Qdrant default)
- **Use RRF when you lack an eval set** — conservative and robust
- Weighted RRF: `w_i / (k + rank_i)` when one channel is known to dominate

### C. Distribution-Based Score Fusion / DBSF (Qdrant)
```
normalized_score = (s - (μ - 3σ)) / (6σ)
```
Normalizes raw scores using 3-sigma stats before summing. Use when raw scores carry magnitude signal.

### D. Personalized PageRank (second-stage reranker)
```
PPR_score(v | seeds S) = (1-d) × uniform(v ∈ S) + d × Σ_{u→v} PPR(u) / out_degree(u)
```
Damping `d = 0.85`. Seeds = query-matched entities from vector search. Propagates importance through graph topology. **Expensive** — only add if you need structural centrality signals.

### E. PCST Prize Formula (G-Retriever — for connected subgraph extraction)
```
prize(node_i) = k - i    (top-k retrieved nodes by similarity rank)
maximize: Σ prizes(nodes) + Σ prizes(edges) - |edges| × C_e
```
Finds minimum Steiner tree ensuring connected subgraph. Rare in practice — use when you need a coherent connected subgraph, not just a ranked list.

---

## SQLite Implementation (for this project)

```python
# Phase 1: Vector seed retrieval (sqlite-vec)
seeds = db.execute("""
    SELECT rowid, distance
    FROM vec_edges
    WHERE fact_embedding MATCH ?
    ORDER BY distance LIMIT 20
""", [query_embedding_blob]).fetchall()

# Phase 2: BFS expansion (recursive CTE)
node_ids = [s[0] for s in seeds]
neighbors = db.execute("""
    WITH RECURSIVE traverse(id, depth) AS (
        SELECT id, 0 FROM nodes WHERE id IN (...)
        UNION ALL
        SELECT e.target_node_id, t.depth + 1
        FROM edges e JOIN traverse t ON e.source_node_id = t.id
        WHERE t.depth < 2 AND e.invalid_at IS NULL
    )
    SELECT DISTINCT id, MIN(depth) as min_depth FROM traverse GROUP BY id
""").fetchall()

# Phase 3: BM25 search (FTS5)
bm25_results = db.execute("""
    SELECT rowid, rank FROM edges_fts WHERE fact MATCH ? ORDER BY rank LIMIT 20
""", [query_text]).fetchall()

# Phase 4: RRF fusion
def rrf_score(results_by_channel, k=1):
    scores = {}
    for channel in results_by_channel:
        for rank, (item_id, _) in enumerate(channel):
            scores[item_id] = scores.get(item_id, 0) + 1.0 / (k + rank)
    return sorted(scores, key=scores.get, reverse=True)
```

**Required SQLite extensions:**
- `sqlite-vec` — cosine similarity on BLOB embeddings
- `FTS5` (built-in) — BM25 full-text search

---

## GNN vs. Static Node Embeddings

| | Static (text description embedding) | GNN |
|---|---|---|
| Update cost | Re-embed changed node only | Re-run forward pass for affected neighborhood |
| Inductive | Yes (new nodes embeddable immediately) | Yes (GraphSAGE, GAT) |
| Semantic quality | High (sentence-transformer) | High + structural |
| Practical | **Recommended** | Only worth it with labeled training data |

**Recommendation for this project:** Embed the **text description** of each node/fact using a sentence transformer (Ollama `nomic-embed-text`). This is inductive, cheap to update, and semantically rich. Reserve GNN embeddings for when you have a labeled retrieval eval set.

---

## Recommendations

1. **Use Graphiti's 3-channel architecture**: BM25 + cosine + BFS in parallel, fuse with RRF (`k=1`)
2. **SQLite implementation**: sqlite-vec (cosine) + FTS5 (BM25) + recursive CTE (BFS)
3. **Starting formula**: `score = 0.6 × cosine + 0.4 × 1/(1+hop_dist)` — tune after eval data exists
4. **Add PPR only** if you need structural centrality (likely overkill for MVP)
5. **Node embeddings**: embed text descriptions via Ollama — do NOT invest in GNN training pre-MVP
6. **Temporal filtering**: always filter `WHERE invalid_at IS NULL` for current facts; add `valid_at <= NOW()` for historical queries

## Key References
- https://github.com/getzep/graphiti — Production reference implementation (Apache 2.0)
- https://github.com/microsoft/graphrag — GraphRAG (context-building approach, not scored hybrid)
- https://arxiv.org/abs/2501.00309 — Survey of graph-based RAG approaches
- https://arxiv.org/abs/2410.20724 — SubgraphRAG (structural + semantic scoring formula)
- https://github.com/asg017/sqlite-vec — SQLite vector extension
