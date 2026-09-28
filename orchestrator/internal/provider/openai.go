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

// OpenAIProvider covers OpenAI-compatible APIs: Groq, Ollama, OpenRouter, Together, etc.
// Just swap BaseURL and APIKey.
type OpenAIProvider struct {
	name    string
	baseURL string
	apiKey  string
	model   string
	client  *http.Client
}

func NewOpenAI(name, baseURL, apiKey, model string) *OpenAIProvider {
	return &OpenAIProvider{
		name:    name,
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  apiKey,
		model:   model,
		client:  &http.Client{Timeout: 120 * time.Second},
	}
}

func (p *OpenAIProvider) Name() string  { return p.name }
func (p *OpenAIProvider) Model() string { return p.model }

// SetModel updates the default model used when ChatRequest.Model is empty.
func (p *OpenAIProvider) SetModel(model string) { p.model = model }

type modelsResponse struct {
	Data []struct {
		ID string `json:"id"`
	} `json:"data"`
}

// ListModels fetches available model IDs from the provider's /v1/models endpoint.
func (p *OpenAIProvider) ListModels(ctx context.Context) ([]string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.baseURL+"/v1/models", nil)
	if err != nil {
		return nil, err
	}
	if p.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+p.apiKey)
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("models: status %d", resp.StatusCode)
	}
	var mr modelsResponse
	if err := json.NewDecoder(resp.Body).Decode(&mr); err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(mr.Data))
	for _, d := range mr.Data {
		ids = append(ids, d.ID)
	}
	return ids, nil
}

type openAIRequest struct {
	Model       string          `json:"model"`
	Messages    []openAIMessage `json:"messages"`
	Tools       []openAITool    `json:"tools,omitempty"`
	MaxTokens   int             `json:"max_tokens,omitempty"`
	Temperature float64         `json:"temperature,omitempty"`
	Stream      bool            `json:"stream,omitempty"`
}

type openAIMessage struct {
	Role       string             `json:"role"`
	Content    string             `json:"content"`
	ToolCalls  []openAIToolCall   `json:"tool_calls,omitempty"`
	ToolCallID string             `json:"tool_call_id,omitempty"`
}

type openAITool struct {
	Type     string          `json:"type"`
	Function openAIFunction  `json:"function"`
}

type openAIFunction struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters"`
}

type openAIToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type openAIResponse struct {
	Choices []struct {
		Message      openAIMessage `json:"message"`
		FinishReason string        `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
	} `json:"usage"`
	Error *struct {
		Message string `json:"message"`
		Code    int    `json:"code"`
	} `json:"error,omitempty"`
}

// toOpenAIMessages converts provider.Message slice to OpenAI format, translating
// Anthropic-style rich content blocks (tool_use / tool_result) when ContentRaw is set.
func toOpenAIMessages(msgs []Message) []openAIMessage {
	var result []openAIMessage
	for _, m := range msgs {
		if len(m.ContentRaw) == 0 {
			result = append(result, openAIMessage{Role: m.Role, Content: m.Content})
			continue
		}
		var blocks []map[string]any
		if err := json.Unmarshal(m.ContentRaw, &blocks); err != nil {
			result = append(result, openAIMessage{Role: m.Role, Content: m.Content})
			continue
		}
		var toolCalls []openAIToolCall
		var textContent string
		toolResultAdded := false
		for _, b := range blocks {
			switch b["type"] {
			case "tool_use":
				id, _ := b["id"].(string)
				name, _ := b["name"].(string)
				inputRaw, _ := json.Marshal(b["input"])
				toolCalls = append(toolCalls, openAIToolCall{
					ID:   id,
					Type: "function",
					Function: struct {
						Name      string `json:"name"`
						Arguments string `json:"arguments"`
					}{Name: name, Arguments: string(inputRaw)},
				})
			case "text":
				if t, ok := b["text"].(string); ok {
					textContent += t
				}
			case "tool_result":
				toolUseID, _ := b["tool_use_id"].(string)
				content, _ := b["content"].(string)
				result = append(result, openAIMessage{Role: "tool", Content: content, ToolCallID: toolUseID})
				toolResultAdded = true
			}
		}
		if len(toolCalls) > 0 {
			result = append(result, openAIMessage{Role: m.Role, Content: textContent, ToolCalls: toolCalls})
		} else if !toolResultAdded {
			result = append(result, openAIMessage{Role: m.Role, Content: textContent})
		}
	}
	return result
}

func (p *OpenAIProvider) Complete(ctx context.Context, req ChatRequest) (ChatResponse, error) {
	model := req.Model
	if model == "" || isAnthropicModel(model) {
		model = p.model
	}

	body := openAIRequest{
		Model:       model,
		Messages:    toOpenAIMessages(req.Messages),
		MaxTokens:   req.MaxTokens,
		Temperature: req.Temperature,
	}
	for _, t := range req.Tools {
		body.Tools = append(body.Tools, openAITool{
			Type: "function",
			Function: openAIFunction{
				Name:        t.Name,
				Description: t.Description,
				Parameters:  t.InputSchema,
			},
		})
	}

	data, _ := json.Marshal(body)
	httpReq, err := http.NewRequestWithContext(ctx, "POST", p.baseURL+"/v1/chat/completions", bytes.NewReader(data))
	if err != nil {
		return ChatResponse{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if p.apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+p.apiKey)
	}

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return ChatResponse{}, err
	}
	defer resp.Body.Close()

	rawBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return ChatResponse{}, &APIError{StatusCode: resp.StatusCode, Message: string(rawBody)}
	}

	var oaiResp openAIResponse
	if err := json.Unmarshal(rawBody, &oaiResp); err != nil {
		return ChatResponse{}, fmt.Errorf("decode: %w", err)
	}
	if oaiResp.Error != nil {
		return ChatResponse{}, &APIError{StatusCode: oaiResp.Error.Code, Message: oaiResp.Error.Message}
	}
	if len(oaiResp.Choices) == 0 {
		return ChatResponse{}, fmt.Errorf("empty choices")
	}

	choice := oaiResp.Choices[0]
	out := ChatResponse{
		Content:      choice.Message.Content,
		FinishReason: choice.FinishReason,
		Usage: Usage{
			InputTokens:  oaiResp.Usage.PromptTokens,
			OutputTokens: oaiResp.Usage.CompletionTokens,
		},
	}
	for _, tc := range choice.Message.ToolCalls {
		out.ToolCalls = append(out.ToolCalls, ToolCall{
			ID:        tc.ID,
			Name:      tc.Function.Name,
			Arguments: json.RawMessage(tc.Function.Arguments),
		})
	}
	return out, nil
}

func (p *OpenAIProvider) Stream(ctx context.Context, req ChatRequest) (<-chan StreamChunk, error) {
	ch := make(chan StreamChunk, 64)
	req.Stream = true

	model := req.Model
	if model == "" || isAnthropicModel(model) {
		model = p.model
	}
	body := openAIRequest{
		Model:       model,
		Messages:    toOpenAIMessages(req.Messages),
		MaxTokens:   req.MaxTokens,
		Temperature: req.Temperature,
		Stream:      true,
	}

	data, _ := json.Marshal(body)
	httpReq, err := http.NewRequestWithContext(ctx, "POST", p.baseURL+"/v1/chat/completions", bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	if p.apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+p.apiKey)
	}

	go func() {
		defer close(ch)
		resp, err := p.client.Do(httpReq)
		if err != nil {
			ch <- StreamChunk{Err: err}
			return
		}
		defer resp.Body.Close()

		var pendingUsage Usage
		buf := make([]byte, 4096)
		for {
			n, err := resp.Body.Read(buf)
			if n > 0 {
				lines := strings.Split(string(buf[:n]), "\n")
				for _, line := range lines {
					line = strings.TrimSpace(line)
					if !strings.HasPrefix(line, "data: ") {
						continue
					}
					payload := strings.TrimPrefix(line, "data: ")
					if payload == "[DONE]" {
						ch <- StreamChunk{Done: true, Usage: pendingUsage}
						return
					}
					var chunk struct {
						Choices []struct {
							Delta struct {
								Content string `json:"content"`
							} `json:"delta"`
						} `json:"choices"`
						Usage *struct {
							PromptTokens     int `json:"prompt_tokens"`
							CompletionTokens int `json:"completion_tokens"`
						} `json:"usage"`
					}
					if json.Unmarshal([]byte(payload), &chunk) == nil {
						if chunk.Usage != nil {
							pendingUsage = Usage{
								InputTokens:  chunk.Usage.PromptTokens,
								OutputTokens: chunk.Usage.CompletionTokens,
							}
						}
						if len(chunk.Choices) > 0 && chunk.Choices[0].Delta.Content != "" {
							ch <- StreamChunk{Delta: chunk.Choices[0].Delta.Content}
						}
					}
				}
			}
			if err != nil {
				if err != io.EOF {
					ch <- StreamChunk{Err: err}
				}
				return
			}
		}
	}()
	return ch, nil
}

// isAnthropicModel returns true for model IDs that are Anthropic-native and
// won't be recognized by OpenAI-compatible providers.
func isAnthropicModel(m string) bool {
	return strings.HasPrefix(m, "claude-") || strings.HasPrefix(m, "us.anthropic.")
}
