# Ultron Memory System — Scenario Test Results

> Last run: not yet executed
> Run: `node orchestrator/tests/harness.mjs` from the project root

## Summary

| Scenario | Status | Sessions | Failures |
|----------|--------|----------|----------|
| (run harness to populate) | — | — | — |

## How to run

```bash
# From project root: D:/pRoG/multi cli/
node orchestrator/tests/harness.mjs

# Run a single scenario:
node orchestrator/tests/harness.mjs --scenario cross-session-recall
```

## Scenario Descriptions

| Scenario | What it tests |
|----------|---------------|
| same-session-recall | Ultron recalls facts from earlier in the same conversation without memory tools |
| cross-session-recall | Fact stored in session 1 is retrievable in a fresh session 2 via search_memory |
| contradiction-handling | Updated preference overwrites old node (UpsertNode dedup by label+type) |
| casual-vs-explicit-memorization | Explicit 'remember forever' reliably triggers upsert_memory |
| failure-mode-learning | Lesson from failure is recorded and retrieved in a future session |
| core-vs-graph-boundary | update_core_memory vs upsert_memory used for different scopes |
| retrieval-relevance-check | Paraphrased queries retrieve correct technology facts via BM25+cosine search |
| episode-growth-stress | Task dispatch generates episodes visible via list_episodes |
| concurrent-dispatch | dispatch_pipeline creates tasks visible via get_queue_status |

## Detailed Results

Run the harness to populate this section.
