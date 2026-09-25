# Zep / Graphiti - Temporal Knowledge Graph for AI Memory

*Source: Claude deep-research agent (web)*

## Architecture Overview

Zep Cloud uses a proprietary graph engine ("Context Graph Engine" / Konig) for millions of per-user context graphs at <200ms retrieval. The OSS layer is **Graphiti** — self-hostable, pluggable backend.

**Graphiti OSS**: `pip install graphiti-core`
- Requires your own graph DB (Neo4j 5.26, FalkorDB 1.1.2, Amazon Neptune)
- No separate vector store — embeddings stored IN the graph as node/edge properties
- No PostgreSQL, no Redis needed

**Zep Cloud**: SaaS, `ZEP_API_KEY`, Go SDK: `github.com/getzep/zep-go/v3`

Zep Community Edition is **deprecated** — do not use.

## Four Core Node/Edge Types

| Type | Description |
|---|---|
| EpisodicNode | Raw input provenance — messages, JSON, text, fact triples |
| EntityNode | Extracted entities (people, concepts, products) with evolving summaries |
| EntityEdge (Fact) | Temporal fact linking two entities: `valid_at` / `invalid_at` windows |
| CommunityNode | Cluster of related entities with aggregate summary |

Graph relationship labels:
- `:MENTIONS` — Episode → Entity
- `:RELATES_TO` — Entity ↔ Entity (facts)
- `:HAS_MEMBER` — Community → Entity

## EntityEdge (Fact) Schema — Key Fields
```
uuid, group_id, source_node_uuid, target_node_uuid
name            string  (relation name, e.g. "VISITS")
fact            string  (NL description: "Alice VISITS Paris")
fact_embedding  []float (vector stored in graph)
episodes        []str   (provenance episode IDs)
valid_at        datetime
invalid_at      datetime
expired_at      datetime
```

## EpisodicNode Schema
```
uuid, name, group_id, labels, created_at
source          EpisodeType  (message | json | text | fact_triple)
source_description  str
content         str  (raw episode)
valid_at        datetime
episode_metadata    dict  (custom key-value filters)
```

## Hybrid Search Architecture

Multi-method retrieval then rerank:

**Per entity type, search methods:**
- `cosine_similarity` — vector search on `fact_embedding` / `name_embedding`
- `bm25` — full-text keyword search
- `bfs` — breadth-first graph traversal from a center node (N hops)

**Rerankers:**
- `rrf` (Reciprocal Rank Fusion) — default, fuses multi-method results
- `node_distance` — by graph distance from center node
- `episode_mentions` — by provenance frequency
- `mmr` — Maximal Marginal Relevance (diversity)
- `cross_encoder` — neural reranking

**Search API:**
```python
# Simple
edges = await graphiti.search("user preference for dark mode")

# Advanced
results = await graphiti.search_(
    query="...",
    config=SearchConfig(
        edge_config=EdgeSearchConfig(
            search_methods=[EdgeSearchMethod.cosine_similarity, EdgeSearchMethod.bm25],
            reranker=EdgeReranker.rrf,
        ),
        limit=10
    )
)
# returns SearchResults with edges, nodes, episodes, communities + reranker_scores
```

## Self-Hosting Footprint

Minimum: **FalkorDB (Docker) + LLM API key**
```bash
docker run -p 6379:6379 -p 3000:3000 falkordb/falkordb:latest
```
Supports local LLMs via Ollama/vLLM (OpenAI-compatible endpoint). `SEMAPHORE_LIMIT` env var controls LLM concurrency (default 10; lower to avoid rate limits).

## Relevance to This Project

- Graphiti pattern is a strong reference for our SQLite graph memory design
- Key takeaway: store `fact_embedding` on the edge itself (not a separate table)
- Temporal validity windows (`valid_at` / `invalid_at`) on facts are critical for accurate memory
- BFS traversal + vector search + BM25 hybrid is the gold standard retrieval pattern
- For our Go implementation: map EpisodicNode → raw message log, EntityNode → extracted entities, EntityEdge → facts with embeddings

## Sources
- https://github.com/getzep/graphiti — OSS framework (Apache 2.0)
- https://arxiv.org/abs/2501.13956 — Academic paper
- https://github.com/getzep/zep — Examples (CE deprecated)
