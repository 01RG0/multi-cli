# web — Fetch URLs

**Tool name:** `web`

Fetches a URL and returns the response body as plain text. Response is capped at 1 MB.

## Accepted input
Full URL string (must include scheme: `https://...`).

## Allowlist
If `config.yaml` specifies `tools.web.allowlist`, only URLs matching those prefixes are permitted. Empty list = allow all.

## Returns
```json
{
  "tool_name": "web",
  "ok": true,
  "output": "<response body as UTF-8 string>",
  "duration_ms": 312
}
```

## Errors
- `URL not in allowlist` — URL doesn't match configured allowlist
- `HTTP 4xx/5xx` — upstream returned an error status
- Network errors — DNS failure, connection refused, timeout (default 15s)
