# API Reference

## Proxy Endpoints

### POST /v1/messages

Anthropic-compatible messages endpoint. Routes through the provider fallback chain.

**Request** (Anthropic Messages API format):
```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 1024,
  "messages": [{"role": "user", "content": "Hello"}],
  "stream": false
}
```

**Response** (non-streaming):
```json
{
  "id": "msg_...",
  "type": "message",
  "role": "assistant",
  "content": [{"type": "text", "text": "Hi!"}],
  "stop_reason": "end_turn",
  "usage": {"input_tokens": 5, "output_tokens": 3}
}
```

**Response** (streaming, `"stream": true`):
```
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi!"}}
data: {"type":"content_block_stop","index":0}
data: {"type":"message_stop"}
```

### GET /health

Returns provider chain status.

```json
{"status":"ok","providers":9,"chain":["groq","apmix","bedrock",...]}
```

### GET /ws

WebSocket upgrade endpoint. Broadcasts JSON events to all connected clients.

**Event types:**
- `snapshot` — full state on connect
- `task_created` / `task_started` / `task_completed` / `task_failed` / `task_suspended`
- `stats` — aggregate counts by status

## Configuration

`config.yaml` fields:

| Field | Default | Description |
|-------|---------|-------------|
| `proxy_port` | `8080` | HTTP listen port |
| `proxy_log` | `false` | Log every proxy request |
| `db_path` | `orchestrator.db` | SQLite database file |
| `concurrency` | `4` | Worker pool size |
| `fallback_chain` | `[]` | Ordered list of provider names |
| `max_retries` | `3` | Per-request retry limit |
| `cooldown_seconds` | `60` | Per-provider error cooldown |
| `tools.shell.timeout_secs` | `30` | Shell tool timeout |
| `tools.shell.allowlist` | `[]` | Allowed command prefixes (empty = allow all) |
| `tools.web.timeout_secs` | `15` | Web fetch timeout |
