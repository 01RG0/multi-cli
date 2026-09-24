package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const anthropicVersion = "2023-06-01"
const anthropicBaseURL = "https://api.anthropic.com"

type AnthropicProvider struct {
	name    string
	baseURL string
	apiKey  string
	model   string
	client  *http.Client
}

func NewAnthropic(name, baseURL, apiKey, model string) *AnthropicProvider {
	if baseURL == "" {
		baseURL = anthropicBaseURL
	}
	return &AnthropicProvider{
		name:    name,
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  apiKey,
		model:   model,
		client:  &http.Client{Timeout: 120 * time.Second},
	}
}

func (p *AnthropicProvider) Name() string { return p.name }

type anthropicRequest struct {
	Model     string             `json:"model"`
	Messages  []anthropicMessage `json:"messages"`
	System    string             `json:"system,omitempty"`
	Tools     []anthropicTool    `json:"tools,omitempty"`
	MaxTokens int                `json:"max_tokens"`
}

type anthropicMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type anthropicTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"`
}

type anthropicResponse struct {
	Content []struct {
		Type  string `json:"type"`
		Text  string `json:"text,omitempty"`
		ID    string `json:"id,omitempty"`
		Name  string `json:"name,omitempty"`
		Input json.RawMessage `json:"input,omitempty"`
	} `json:"content"`
	StopReason string `json:"stop_reason"`
	Usage      struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
	} `json:"usage"`
	Error *struct {
		Type    string `json:"type"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func (p *AnthropicProvider) Complete(ctx context.Context, req ChatRequest) (ChatResponse, error) {
	model := req.Model
	if model == "" {
		model = p.model
	}
	maxTokens := req.MaxTokens
	if maxTokens == 0 {
		maxTokens = 1024
	}

	body := anthropicRequest{
		Model:     model,
		MaxTokens: maxTokens,
	}

	// Anthropic: "system" is top-level, not in messages array
	for _, m := range req.Messages {
		if m.Role == "system" {
			body.System = m.Content
		} else {
			body.Messages = append(body.Messages, anthropicMessage{Role: m.Role, Content: m.Content})
		}
	}
	for _, t := range req.Tools {
		body.Tools = append(body.Tools, anthropicTool{
			Name:        t.Name,
			Description: t.Description,
			InputSchema: t.InputSchema,
		})
	}

	data, _ := json.Marshal(body)
	httpReq, err := http.NewRequestWithContext(ctx, "POST", p.baseURL+"/v1/messages", bytes.NewReader(data))
	if err != nil {
		return ChatResponse{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", p.apiKey)
	httpReq.Header.Set("anthropic-version", anthropicVersion)

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return ChatResponse{}, err
	}
	defer resp.Body.Close()

	rawBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return ChatResponse{}, &APIError{StatusCode: resp.StatusCode, Message: string(rawBody)}
	}

	var anthResp anthropicResponse
	if err := json.Unmarshal(rawBody, &anthResp); err != nil {
		return ChatResponse{}, fmt.Errorf("decode: %w", err)
	}
	if anthResp.Error != nil {
		code := 0
		if anthResp.Error.Type == "overloaded_error" {
			code = 529
		}
		return ChatResponse{}, &APIError{StatusCode: code, Message: anthResp.Error.Message}
	}

	out := ChatResponse{
		FinishReason: anthResp.StopReason,
		Usage: Usage{
			InputTokens:  anthResp.Usage.InputTokens,
			OutputTokens: anthResp.Usage.OutputTokens,
		},
	}
	for _, block := range anthResp.Content {
		switch block.Type {
		case "text":
			out.Content += block.Text
		case "tool_use":
			out.ToolCalls = append(out.ToolCalls, ToolCall{
				ID:        block.ID,
				Name:      block.Name,
				Arguments: block.Input,
			})
			if out.FinishReason == "" {
				out.FinishReason = "tool_use"
			}
		}
	}
	return out, nil
}

func (p *AnthropicProvider) Stream(ctx context.Context, req ChatRequest) (<-chan StreamChunk, error) {
	ch := make(chan StreamChunk, 64)
	go func() {
		defer close(ch)
		// Anthropic streaming uses server-sent events; for now delegate to non-streaming
		resp, err := p.Complete(ctx, req)
		if err != nil {
			ch <- StreamChunk{Err: err}
			return
		}
		// Emit content word-by-word to simulate streaming
		words := strings.Fields(resp.Content)
		for i, w := range words {
			if i == len(words)-1 {
				ch <- StreamChunk{Delta: w, Done: true}
			} else {
				ch <- StreamChunk{Delta: w + " "}
			}
		}
	}()
	return ch, nil
}
