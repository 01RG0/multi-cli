package provider

import (
	"context"
	"encoding/json"
)

type Message struct {
	Role       string          `json:"role"`
	Content    string          `json:"content"`
	ContentRaw json.RawMessage `json:"-"` // rich content blocks (Anthropic array format); not serialized
}

type Tool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"`
}

type ToolCall struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
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
	FinishReason string     `json:"finish_reason"` // "stop" | "tool_use" | "length"
	ToolCalls    []ToolCall `json:"tool_calls,omitempty"`
	Usage        Usage      `json:"usage"`
	// Provider is the name of the provider that served this response.
	// Populated by Router.Complete (empty for direct provider calls).
	Provider string `json:"provider,omitempty"`
}

type Usage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

type StreamChunk struct {
	Delta string
	Done  bool
	Err   error
	Usage Usage // populated on the Done=true chunk when the provider reports it
}

type Provider interface {
	Complete(ctx context.Context, req ChatRequest) (ChatResponse, error)
	Stream(ctx context.Context, req ChatRequest) (<-chan StreamChunk, error)
	Name() string
	Model() string
	SetModel(string)
}

// APIError carries HTTP status + message for circuit-breaker logic.
type APIError struct {
	StatusCode int
	Message    string
}

func (e *APIError) Error() string {
	return e.Message
}
