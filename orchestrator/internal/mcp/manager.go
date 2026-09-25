package mcp

import (
	"context"
	"fmt"
	"log"
	"sync"
)

// Manager holds all running MCP clients and provides aggregate access.
type Manager struct {
	clients map[string]*Client
	mu      sync.RWMutex
}

// NewManager starts all configured MCP servers. Servers that fail to start
// are logged and skipped — the manager is always returned.
func NewManager(cfgs []ServerConfig, ctx context.Context) *Manager {
	m := &Manager{clients: make(map[string]*Client)}
	for _, cfg := range cfgs {
		c := New(cfg)
		if err := c.Start(ctx); err != nil {
			log.Printf("mcp: server %q failed to start (skipping): %v", cfg.Name, err)
			continue
		}
		if _, err := c.ListTools(ctx); err != nil {
			log.Printf("mcp: server %q list tools: %v", cfg.Name, err)
		}
		m.clients[cfg.Name] = c
		log.Printf("mcp: server %q started (%d tools)", cfg.Name, len(c.CachedTools()))
	}
	return m
}

// AllTools returns the aggregated tool list from all running servers.
func (m *Manager) AllTools() []Tool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var all []Tool
	for _, c := range m.clients {
		all = append(all, c.CachedTools()...)
	}
	return all
}

// CallTool routes a tool call to the named server.
func (m *Manager) CallTool(ctx context.Context, serverName, toolName string, input map[string]interface{}) (string, error) {
	m.mu.RLock()
	c, ok := m.clients[serverName]
	m.mu.RUnlock()
	if !ok {
		return "", fmt.Errorf("mcp: server %q not found or not running", serverName)
	}
	return c.CallTool(ctx, toolName, input)
}

// ServerNames returns the names of all running servers.
func (m *Manager) ServerNames() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	names := make([]string, 0, len(m.clients))
	for name := range m.clients {
		names = append(names, name)
	}
	return names
}

// GetClient returns the client for a named server.
func (m *Manager) GetClient(name string) (*Client, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	c, ok := m.clients[name]
	return c, ok
}

// StopAll terminates all running server processes.
func (m *Manager) StopAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, c := range m.clients {
		c.Stop()
	}
}
