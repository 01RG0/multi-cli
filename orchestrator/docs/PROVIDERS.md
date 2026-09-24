# Provider Reference

## Supported Providers

### OpenAI-Compatible

These providers use the OpenAI chat completions wire format:

| Name | Base URL | Notes |
|------|----------|-------|
| `groq` | `https://api.groq.com/openai/v1` | Free tier available; recommended model: `qwen/qwen3.8-27b` |
| `apmix` | `https://apmix.ai/v1` | Free model: `deepseek-v4.1-flash-free` |
| `dahl` | `https://inference.dahl.global/v1` | |
| `tokenharbor` | `https://api.tokenharbor.ai/v1` | |
| `codecraft` | provider base URL | |
| `aihubmix` | provider base URL | |
| `openrouter` | `https://openrouter.ai/api/v1` | Many models |
| `ollama` | `http://localhost:11434/v1` | Local models |

### Anthropic Native

Uses the Anthropic Messages API wire format (system at top-level, content[] blocks).

| Name | Notes |
|------|-------|
| `anthropic` | Direct API; requires `ANTHROPIC_API_KEY` |

### AWS Bedrock

Pure-Go SigV4 implementation (no AWS SDK required).

| Name | Notes |
|------|-------|
| `bedrock` | Requires `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` |

Default model: `us.anthropic.claude-sonnet-4-6-20251001-v1:0`

## Fallback Chain

The router tries providers in `fallback_chain` order. On failure:
1. Sets a per-provider cooldown (default 60s)
2. Moves to the next provider
3. Applies exponential backoff with jitter

Configure in `config.yaml`:
```yaml
fallback_chain:
  - groq
  - apmix
  - bedrock
  - dahl
  - tokenharbor
```

## Environment Variables

```bash
GROQ_API_KEY=...
APMIX_API_KEY=...
DAHL_API_KEY=...
TOKEN_HARBOR_API_KEY=...
CODECRAFT_API_KEY=...
AIHUBMIX_API_KEY=...
OPENROUTER_API_KEY=...
MISTRAL_API_KEY=...
CEREBRAS_API_KEY=...
GEMINI_API_KEY=...
ALIBABA_API_KEY=...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
ANTHROPIC_API_KEY=          # leave empty if using Bedrock
ANTHROPIC_BASE_URL=http://localhost:8080   # set on sub-agents
```
