# file — Read Files

**Tool name:** `file`

Reads a file from the allowed root directory. Path traversal (`..`) is blocked.

## Accepted input
Relative file path within the configured root (e.g., `src/main.go`, `config.yaml`).

## Returns
```json
{
  "tool_name": "file",
  "ok": true,
  "output": "<file contents as UTF-8 string>"
}
```

## Errors
- `path traversal not allowed` — input contains `..`
- OS error — file not found or permission denied
