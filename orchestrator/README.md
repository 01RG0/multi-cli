# AI Agent Orchestrator

A Go + React system that dispatches tasks to multiple LLM providers and 7 CLI sub-agents, with a real-time WebSocket dashboard.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  React Dashboard  (Vite + Zustand + React Flow + dnd-kit) │
│  ws://localhost:8080/ws                                   │
└───────────────────────┬─────────────────────────────────┘
                        │ WebSocket
┌───────────────────────▼─────────────────────────────────┐
│  Orchestrator Server  :8080                               │
│  POST /v1/messages  ←── CLI sub-agents (Anthropic proxy) │
│  GET  /health                                             │
│  GET  /ws          ──→ hub.Hub (broadcast events)        │
│                                                           │
│  ┌──────────────┐  ┌───────────┐  ┌──────────────────┐   │
│  │  Provider    │  │  Queue    │  │  Graph Memory     │   │
│  │  Router      │  │  Worker   │  │  (temporal graph) │   │
│  │  (fallback)  │  │  Pool     │  │  FTS5 + BFS       │   │
│  └──────────────┘  └───────────┘  └──────────────────┘   │
│  ┌──────────────┐  ┌───────────┐                          │
│  │  Tools       │  │  Improve  │                          │
│  │  shell/file/ │  │  Observe→ │                          │
│  │  web         │  │  Reflect→ │                          │
│  └──────────────┘  │  Validate │                          │
│                    │  →Apply   │                          │
│                    └───────────┘                          │
└─────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# 1. Copy and fill in API keys
cp .env.example .env
# edit .env

# 2. Start the orchestrator proxy
cd orchestrator
go run ./cmd/orchestrator --serve

# 3. Point CLI sub-agents at the proxy
export ANTHROPIC_BASE_URL=http://localhost:8080

# 4. Start the dashboard
cd frontend
npm install && npm run dev
# open http://localhost:5173
```

## Milestones

| # | Milestone | Branch | Status |
|---|-----------|--------|--------|
| M1 | Provider abstraction + router | `main` | ✅ |
| M1-B | Anthropic proxy server | `codex/m1b-proxy` | ✅ |
| M2 | SQLite task queue + worker pool | `kilo/m2-queue` | ✅ |
| M3 | Temporal graph memory + hybrid search | `cline/m3-memory` | ✅ |
| M4 | Shell/file/web tools + sandbox | `grok/m4-tools` | ✅ |
| M5 | Self-improvement loop | `vibe/m5-improvement` | ✅ |
| M6 | React dashboard + WebSocket hub | `agy/m6-frontend` + `opencode/m6-backend-m7` | ✅ |
| M7 | CLI agent dispatcher | `opencode/m6-backend-m7` | ✅ |

## Providers

Configured via `config.yaml`. Fallback chain tries each provider in order with exponential backoff and per-provider cooldown.

Supported adapters:
- **OpenAI-compatible**: Groq, apmix, dahl, TokenHarbor, CodeCraft, AIHubMix, OpenRouter, Ollama
- **Anthropic native**: direct Anthropic API
- **AWS Bedrock**: SigV4-signed requests, pure-Go implementation

## Tests

```bash
cd orchestrator
go test ./tests/ -v
# 31 tests, ~0.4s
```
