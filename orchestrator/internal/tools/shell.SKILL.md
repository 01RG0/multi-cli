# shell — Execute Shell Commands

**Tool name:** `shell`

Runs a shell command in a sandboxed environment. All output is captured and returned as JSON.

## Accepted input
Plain-text shell command string. The command must start with an allowed prefix (configured in `config.yaml`).

## Default allowlist
`git`, `go`, `npm`, `python`, `node`, `curl`, `cat`, `ls`

## Network
Shell tool has **no outbound network access** (`deny_network: true`). Use the `web` tool for HTTP requests.

## Returns
```json
{
  "tool_name": "shell",
  "ok": true,
  "output": "<combined stdout+stderr>",
  "exit_code": 0,
  "duration_ms": 142
}
```

## Example calls
```
shell: go test ./...
shell: git log --oneline -5
shell: npm run build
```

## Errors
- `command not in allowlist` — command prefix is not permitted
- `context deadline exceeded` — command exceeded timeout (default 30s)
