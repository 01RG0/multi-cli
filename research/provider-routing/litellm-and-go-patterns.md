# Multi-LLM Provider Routing & Abstraction Layers

*Source: Claude deep-research agent (web)*

## Summary

Five major routing systems surveyed: LiteLLM, aisuite, OpenRouter, Portkey Gateway, and Go-native projects.

---

## LiteLLM (Python, 59.5k stars)

**GitHub:** https://github.com/BerriAI/litellm

Two deployment modes:
- **SDK mode:** Drop-in Python import, embedded in your service
- **Proxy mode:** Standalone HTTP gateway — Go backend calls it as if it were OpenAI (`http://litellm:4000/v1/chat/completions`)

### Fallback Config
```python
router = Router(
    model_list=[
        {"model_name": "primary", "litellm_params": {"model": "gpt-4o", "rpm": 60}},
        {"model_name": "backup",  "litellm_params": {"model": "claude-opus-4-5", "rpm": 30}},
    ],
    fallbacks=[{"primary": ["backup"]}],
    num_retries=3,
    allowed_fails=3,       # failures before cooldown
    cooldown_time=60.0,    # seconds to isolate failing deployment
)
```

### Routing Strategies
| Strategy | Description |
|---|---|
| `simple-shuffle` | Weighted random by rpm/tpm capacity |
| `latency-based-routing` | Routes to lowest cached p50 latency |
| `least-busy` | Fewest in-flight requests |
| `usage-based-routing-v2` | Lowest TPM usage this minute (Redis-backed) |
| `cost-based-routing` | Cheapest deployment |

### Rate Limit Handling
- HTTP 429 → `RouterRateLimitError` → deployment enters CooldownCache
- Per-error-class retry policy: `RateLimitErrorRetries=3`, `AuthenticationErrorRetries=0`, etc.
- Backoff: exponential with jitter

---

## aisuite (Python, Andrew Ng's project)

Purely thin adapter — NO built-in fallback/retry. Provider interface:
```python
class SomeProvider(BaseProvider):
    def chat_completions_create(self, model, messages, **kwargs) -> ChatCompletion
```
Model addressing: `client.chat.completions.create(model="openai:gpt-4o", ...)` — split on `:`.

---

## OpenRouter (Cloud service)

Single endpoint: `https://openrouter.ai/api/v1/chat/completions`
- Inverse-square-weighted random by cost, excluding providers with recent outages
- Explicit routing via `provider.order`, `provider.sort`, `provider.allow_fallbacks`
- Performance filtering: `preferred_min_throughput`, `preferred_max_latency` (5-min rolling window)
- Go integration: use `github.com/openai/openai-go` with `BaseURL = openrouter endpoint`

---

## Portkey Gateway (TypeScript, self-hostable)

**GitHub:** https://github.com/Portkey-AI/gateway

Config via `x-portkey-config` header:
```json
{
  "retry": { "attempts": 5, "on_status_codes": [429, 500, 503] },
  "strategy": { "mode": "fallback" },
  "targets": [
    { "provider": "openai", "api_key": "..." },
    { "provider": "anthropic", "api_key": "...", "override_params": {"model": "claude-opus-4-5"} }
  ]
}
```
Exponential backoff retry. Load balancing via `weight` per provider. Docker-deployable.

---

## Go-Native Projects

### smhanov/laconic (261 stars) — Most minimal
```go
type LLMProvider interface {
    Generate(ctx context.Context, systemPrompt, userPrompt string) (LLMResponse, error)
}
type LLMResponse struct { Text string; Cost float64 }
```
Zero vendor SDK deps, stdlib only. No fallback built-in.

### Protocol-Lattice/go-agent (257 stars)
```go
// Must implement:
Generate(ctx, prompt) (string, error)
GenerateWithFiles(ctx, prompt, files) (string, error)
GenerateStream(ctx, prompt) (<-chan string, error)
```
Factory: `models.NewLLMProvider(ctx, "openai", "gpt-4o-mini", "")`. Supports OpenAI, Anthropic, Gemini, Ollama, Vertex.

### AgenticGoKit/AgenticGoKit (179 stars)
Configuration-driven, plugin architecture (`plugins/llm/openai`, `plugins/llm/anthropic`, `plugins/llm/ollama`). DAG orchestration, OpenTelemetry built-in.

### kris-hansen/comanda (325 stars)
YAML workflow steps, SQLite FTS5 memory, state checkpointing, CLI AI tool orchestration.

---

## Recommended Go Interface for This Project

```go
type Message struct {
    Role    string `json:"role"`    // "system" | "user" | "assistant"
    Content string `json:"content"`
}

type ChatRequest struct {
    Model       string    `json:"model"`
    Messages    []Message `json:"messages"`
    Tools       []Tool    `json:"tools,omitempty"`
    MaxTokens   int       `json:"max_tokens,omitempty"`
    Temperature float64   `json:"temperature,omitempty"`
    Stream      bool      `json:"stream,omitempty"`
}

type ChatResponse struct {
    Content      string     `json:"content"`
    FinishReason string     `json:"finish_reason"`
    ToolCalls    []ToolCall `json:"tool_calls,omitempty"`
    Usage        Usage      `json:"usage"`
}

type Provider interface {
    Complete(ctx context.Context, req ChatRequest) (ChatResponse, error)
    Stream(ctx context.Context, req ChatRequest) (<-chan StreamChunk, error)
    Name() string
}
```

### Fallback + Rate Limit Router Pattern
```go
func (r *Router) Complete(ctx context.Context, req ChatRequest) (ChatResponse, error) {
    chain := append([]Provider{r.primary}, r.fallbacks...)
    for _, p := range chain {
        for attempt := 0; attempt < r.maxRetries; attempt++ {
            resp, err := p.Complete(ctx, req)
            if err == nil { return resp, nil }
            if isRateLimit(err) || isTransient(err) {
                time.Sleep(r.backoff.Next(attempt))
                continue
            }
            break  // non-retryable: skip to next provider
        }
    }
    return ChatResponse{}, lastErr
}

func isRateLimit(err error) bool {
    var apiErr *APIError
    return errors.As(err, &apiErr) && apiErr.StatusCode == 429
}
```

## Key Takeaways
- **OpenAI wire format** works for most providers — one HTTP client handles Groq, Together, Ollama, OpenRouter, etc.; only Anthropic needs a separate adapter
- **LiteLLM proxy sidecar** is the fastest path to multi-provider support in a Go service
- **Cooldown/circuit breaker:** track consecutive failures per provider; mark as "cooling" for N seconds
- **Model addressing:** `"provider:model"` string splits cleanly to registry lookup
- **Streaming:** `<-chan StreamChunk` is idiomatic Go
