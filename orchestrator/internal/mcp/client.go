// Package mcp provides a minimal MCP (Model Context Protocol) client.
// Supports stdio-based servers (spawned process) and HTTP-based servers.
package mcp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ServerConfig describes one MCP server entry in config.yaml.
type ServerConfig struct {
	Name    string   `yaml:"name"`
	Command string   `yaml:"command"`  // e.g. "npx" — stdio transport
	Args    []string `yaml:"args"`     // e.g. ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
	Env     []string `yaml:"env"`      // extra KEY=VALUE env vars for the child process
	BaseURL string   `yaml:"base_url"` // HTTP MCP server (alternative to Command)
}

// Tool is a capability advertised by an MCP server.
type Tool struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	InputSchema map[string]interface{} `json:"input_schema"`
}

// ─── JSON-RPC 2.0 wire types ─────────────────────────────────────────────────

type rpcRequest struct {
	JSONRPC string      `json:"jsonrpc"`
	ID      interface{} `json:"id,omitempty"`
	Method  string      `json:"method"`
	Params  interface{} `json:"params,omitempty"`
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      interface{}     `json:"id,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// ─── Client ───────────────────────────────────────────────────────────────────

// Client manages one MCP server connection.
type Client struct {
	cfg   ServerConfig
	tools []Tool

	// stdio state
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	reader  *bufio.Reader
	writeMu sync.Mutex

	// pending RPC calls: id → channel
	pending   map[int64]chan rpcResponse
	pendingMu sync.Mutex
	nextID    atomic.Int64
}

// New returns a Client for cfg. Call Start to connect.
func New(cfg ServerConfig) *Client {
	return &Client{
		cfg:     cfg,
		pending: make(map[int64]chan rpcResponse),
	}
}

// Config returns the server configuration.
func (c *Client) Config() ServerConfig { return c.cfg }

// CachedTools returns the tools fetched during Start without a network call.
func (c *Client) CachedTools() []Tool { return c.tools }

// Start connects to the server (spawns process or verifies HTTP) and runs
// the MCP initialize handshake. Soft failure: errors are returned so callers
// can log and skip without crashing the orchestrator.
func (c *Client) Start(ctx context.Context) error {
	if c.cfg.BaseURL != "" {
		return c.startHTTP(ctx)
	}
	return c.startStdio(ctx)
}

func (c *Client) startHTTP(ctx context.Context) error {
	url := strings.TrimRight(c.cfg.BaseURL, "/") + "/tools/list"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("mcp http %q unreachable: %w", c.cfg.Name, err)
	}
	resp.Body.Close()
	return nil
}

func (c *Client) startStdio(ctx context.Context) error {
	if c.cfg.Command == "" {
		return fmt.Errorf("mcp server %q: command required for stdio transport", c.cfg.Name)
	}
	cmd := exec.CommandContext(ctx, c.cfg.Command, c.cfg.Args...)
	if len(c.cfg.Env) > 0 {
		cmd.Env = append(cmd.Environ(), c.cfg.Env...)
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("mcp %q stdin: %w", c.cfg.Name, err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("mcp %q stdout: %w", c.cfg.Name, err)
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("mcp %q start: %w", c.cfg.Name, err)
	}
	c.cmd = cmd
	c.stdin = stdin
	c.reader = bufio.NewReader(stdout)

	go c.readLoop(ctx)

	if err := c.initialize(ctx); err != nil {
		c.Stop()
		return fmt.Errorf("mcp %q initialize: %w", c.cfg.Name, err)
	}
	return nil
}

// readLoop reads newline-delimited JSON-RPC responses and dispatches to waiters.
func (c *Client) readLoop(ctx context.Context) {
	for {
		line, err := c.reader.ReadString('\n')
		if err != nil {
			return
		}
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var resp rpcResponse
		if err := json.Unmarshal([]byte(line), &resp); err != nil {
			log.Printf("mcp %q: bad JSON: %v", c.cfg.Name, err)
			continue
		}
		if resp.ID == nil {
			continue // notification, no waiter
		}
		var id int64
		switch v := resp.ID.(type) {
		case float64:
			id = int64(v)
		case int64:
			id = v
		case json.Number:
			id, _ = v.Int64()
		}
		c.pendingMu.Lock()
		ch, ok := c.pending[id]
		if ok {
			delete(c.pending, id)
		}
		c.pendingMu.Unlock()
		if ok {
			select {
			case ch <- resp:
			case <-ctx.Done():
			}
		}
	}
}

// send writes one JSON-RPC request; waits for response when expectResponse is true.
func (c *Client) send(ctx context.Context, method string, params interface{}, expectResponse bool) (json.RawMessage, error) {
	id := c.nextID.Add(1)
	req := rpcRequest{
		JSONRPC: "2.0",
		Method:  method,
		Params:  params,
	}
	var ch chan rpcResponse
	if expectResponse {
		req.ID = id
		ch = make(chan rpcResponse, 1)
		c.pendingMu.Lock()
		c.pending[id] = ch
		c.pendingMu.Unlock()
	}
	data, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	data = append(data, '\n')

	c.writeMu.Lock()
	_, writeErr := c.stdin.Write(data)
	c.writeMu.Unlock()
	if writeErr != nil {
		if expectResponse {
			c.pendingMu.Lock()
			delete(c.pending, id)
			c.pendingMu.Unlock()
		}
		return nil, writeErr
	}
	if !expectResponse {
		return nil, nil
	}
	select {
	case resp := <-ch:
		if resp.Error != nil {
			return nil, fmt.Errorf("rpc error %d: %s", resp.Error.Code, resp.Error.Message)
		}
		return resp.Result, nil
	case <-time.After(30 * time.Second):
		c.pendingMu.Lock()
		delete(c.pending, id)
		c.pendingMu.Unlock()
		return nil, fmt.Errorf("mcp %q: timeout on %s", c.cfg.Name, method)
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (c *Client) initialize(ctx context.Context) error {
	params := map[string]interface{}{
		"protocolVersion": "2024-11-05",
		"capabilities":    map[string]interface{}{},
		"clientInfo":      map[string]interface{}{"name": "ultron", "version": "1.0"},
	}
	_, err := c.send(ctx, "initialize", params, true)
	if err != nil {
		return err
	}
	_, _ = c.send(ctx, "notifications/initialized", map[string]interface{}{}, false)
	return nil
}

// ListTools fetches the tool list and caches it on the client.
func (c *Client) ListTools(ctx context.Context) ([]Tool, error) {
	if c.cfg.BaseURL != "" {
		return c.listToolsHTTP(ctx)
	}
	result, err := c.send(ctx, "tools/list", map[string]interface{}{}, true)
	if err != nil {
		return nil, err
	}
	return c.parseToolsResult(result)
}

func (c *Client) listToolsHTTP(ctx context.Context) ([]Tool, error) {
	url := strings.TrimRight(c.cfg.BaseURL, "/") + "/tools/list"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return c.parseToolsResult(json.RawMessage(raw))
}

func (c *Client) parseToolsResult(raw json.RawMessage) ([]Tool, error) {
	var resp struct {
		Tools []struct {
			Name        string                 `json:"name"`
			Description string                 `json:"description"`
			InputSchema map[string]interface{} `json:"inputSchema"`
		} `json:"tools"`
	}
	if err := json.Unmarshal(raw, &resp); err != nil {
		return nil, err
	}
	tools := make([]Tool, len(resp.Tools))
	for i, t := range resp.Tools {
		tools[i] = Tool{Name: t.Name, Description: t.Description, InputSchema: t.InputSchema}
	}
	c.tools = tools
	return tools, nil
}

// CallTool invokes a named tool and returns the text result.
func (c *Client) CallTool(ctx context.Context, name string, input map[string]interface{}) (string, error) {
	if c.cfg.BaseURL != "" {
		return c.callToolHTTP(ctx, name, input)
	}
	params := map[string]interface{}{"name": name, "arguments": input}
	result, err := c.send(ctx, "tools/call", params, true)
	if err != nil {
		return "", err
	}
	var resp struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		IsError bool `json:"isError"`
	}
	if err := json.Unmarshal(result, &resp); err != nil {
		return string(result), nil
	}
	var texts []string
	for _, b := range resp.Content {
		if b.Type == "text" {
			texts = append(texts, b.Text)
		}
	}
	if resp.IsError {
		return "", fmt.Errorf("mcp tool error: %s", strings.Join(texts, "; "))
	}
	return strings.Join(texts, "\n"), nil
}

func (c *Client) callToolHTTP(ctx context.Context, name string, input map[string]interface{}) (string, error) {
	url := strings.TrimRight(c.cfg.BaseURL, "/") + "/tools/call"
	body, _ := json.Marshal(map[string]interface{}{"name": name, "arguments": input})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	return string(data), nil
}

// Stop terminates the child process (no-op for HTTP servers).
func (c *Client) Stop() {
	if c.stdin != nil {
		_ = c.stdin.Close()
	}
	if c.cmd != nil && c.cmd.Process != nil {
		_ = c.cmd.Process.Kill()
	}
}
