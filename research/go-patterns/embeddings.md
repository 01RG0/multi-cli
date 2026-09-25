# Go Embedding Options for Local/Offline AI Agents

*Source: Claude deep-research agent*

## 1. Official Ollama Go Client
**Import:** `github.com/ollama/ollama/api`

Use `client.Embed()` (not deprecated `Embeddings()`). Supports batch input, float32 output, dimensions param. Best model choices: `nomic-embed-text`, `all-minilm`, `mxbai-embed-large`.

**Best for:** Primary choice if you control the runtime environment.

## 2. go-llama.cpp
**Import:** `github.com/go-skynet/go-llama.cpp`

CGo bindings wrapping llama.cpp. `llm.Embeddings(text)` returns `[]float32`. Init with `llama.EnableEmbeddings`. No daemon needed — in-process GGUF model.

**Best for:** Embed model in binary, no daemon. CGo complexity is the cost.

## 3. fastembed-go (ONNX-based, pure Go)
**Import:** `github.com/grumpylabs/fastembed-go` (Jul 2025 fork, most recent)

`fe.Embed(texts, batchSize)` returns `[][]float32`. Supported models: AllMiniLM-L6-v2, BGE-small-en-v1.5 (default), BGE-base-en-v1.5. Requires ONNX Runtime shared lib. Models download from HuggingFace on first use.

**Best for:** Pure Go, no daemon, no CGo. Some maintenance risk.

## 4. chromem-go embedding funcs (thin wrapper)
**Import:** `github.com/philippgille/chromem-go`

`chromem.NewEmbeddingFuncOllama("nomic-embed-text", url)` gives you an `EmbeddingFunc` you can use without adopting the full vector DB.

**Best for:** Thin Ollama wrapper, minimal deps.

## Summary Table

| Option | CGo | Daemon | Maturity | Recommended |
|---|---|---|---|---|
| Ollama Go client | No | Yes (Ollama) | Excellent | **Primary** |
| go-llama.cpp | Yes | No | Moderate | In-process option |
| fastembed-go (grumpylabs) | No | No | Low-mod | Pure Go option |
| chromem-go funcs | No | Yes (Ollama) | Good | Thin wrapper |
| onnxruntime_go (raw) | No | No | Good | Too low-level |
| Cybertron | No | No | Stale | Avoid |

## Recommendation for this project
**Use Ollama Go client** (`/api/embed` endpoint) with `nomic-embed-text`. Single binary daemon, no CGo, excellent maturity. For truly offline/embedded: `fastembed-go` (grumpylabs fork).
