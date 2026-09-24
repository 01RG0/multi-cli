package server

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/01rg0/orchestrator/internal/provider"
)

// proxyRequest mirrors the Anthropic /v1/messages request body.
type proxyRequest struct {
	Model     string             `json:"model"`
	Messages  []proxyMessage     `json:"messages"`
	System    string             `json:"system,omitempty"`
	Tools     []provider.Tool    `json:"tools,omitempty"`
	MaxTokens int                `json:"max_tokens,omitempty"`
	Stream    bool               `json:"stream,omitempty"`
	Temperature float64          `json:"temperature,omitempty"`
}

type proxyMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"` // string or []contentBlock
}

type contentBlock struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

// proxyResponse mirrors the Anthropic /v1/messages response body.
type proxyResponse struct {
	ID           string          `json:"id"`
	Type         string          `json:"type"`
	Role         string          `json:"role"`
	Content      []contentBlock  `json:"content"`
	Model        string          `json:"model"`
	StopReason   string          `json:"stop_reason"`
	StopSequence *string         `json:"stop_sequence"`
	Usage        proxyUsage      `json:"usage"`
}

type proxyUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

func (s *Server) handleMessages(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 4<<20))
	if err != nil {
		http.Error(w, "read body: "+err.Error(), http.StatusBadRequest)
		return
	}

	var req proxyRequest
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "parse body: "+err.Error(), http.StatusBadRequest)
		return
	}

	if s.cfg.ProxyLog {
		log.Printf("proxy: model=%s stream=%v messages=%d", req.Model, req.Stream, len(req.Messages))
	}

	chatReq := toChatRequest(req)

	if req.Stream {
		s.handleStream(w, r, chatReq, req.Model)
		return
	}

	resp, err := s.router.Complete(r.Context(), chatReq)
	if err != nil {
		code := http.StatusBadGateway
		var apiErr *provider.APIError
		if isAPIError(err, &apiErr) && apiErr.StatusCode == 429 {
			code = http.StatusTooManyRequests
		}
		http.Error(w, err.Error(), code)
		return
	}

	out := proxyResponse{
		ID:         fmt.Sprintf("msg_%d", time.Now().UnixNano()),
		Type:       "message",
		Role:       "assistant",
		Model:      req.Model,
		StopReason: mapStopReason(resp.FinishReason),
		Content:    []contentBlock{{Type: "text", Text: resp.Content}},
		Usage: proxyUsage{
			InputTokens:  resp.Usage.InputTokens,
			OutputTokens: resp.Usage.OutputTokens,
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

func (s *Server) handleStream(w http.ResponseWriter, r *http.Request, chatReq provider.ChatRequest, model string) {
	ch, err := s.router.Stream(r.Context(), chatReq)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	msgID := fmt.Sprintf("msg_%d", time.Now().UnixNano())

	// message_start
	writeSSE(w, flusher, map[string]any{
		"type": "message_start",
		"message": map[string]any{
			"id": msgID, "type": "message", "role": "assistant",
			"model": model, "content": []any{},
			"stop_reason": nil, "usage": map[string]int{"input_tokens": 0, "output_tokens": 0},
		},
	})

	// content_block_start
	writeSSE(w, flusher, map[string]any{
		"type": "content_block_start", "index": 0,
		"content_block": map[string]string{"type": "text", "text": ""},
	})

	writeSSE(w, flusher, map[string]any{"type": "ping"})

	for chunk := range ch {
		if chunk.Err != nil {
			break
		}
		if chunk.Delta != "" {
			writeSSE(w, flusher, map[string]any{
				"type": "content_block_delta", "index": 0,
				"delta": map[string]string{"type": "text_delta", "text": chunk.Delta},
			})
		}
		if chunk.Done {
			break
		}
	}

	writeSSE(w, flusher, map[string]any{"type": "content_block_stop", "index": 0})
	writeSSE(w, flusher, map[string]any{
		"type": "message_delta",
		"delta": map[string]string{"stop_reason": "end_turn", "stop_sequence": ""},
		"usage": map[string]int{"output_tokens": 0},
	})
	writeSSE(w, flusher, map[string]any{"type": "message_stop"})
	fmt.Fprintf(w, "data: [DONE]\n\n")
	flusher.Flush()
}

func writeSSE(w http.ResponseWriter, f http.Flusher, v any) {
	data, _ := json.Marshal(v)
	fmt.Fprintf(w, "data: %s\n\n", data)
	f.Flush()
}

func toChatRequest(req proxyRequest) provider.ChatRequest {
	cr := provider.ChatRequest{
		MaxTokens:   req.MaxTokens,
		Temperature: req.Temperature,
		Tools:       req.Tools,
	}
	if req.System != "" {
		cr.Messages = append(cr.Messages, provider.Message{Role: "system", Content: req.System})
	}
	for _, m := range req.Messages {
		content := extractText(m.Content)
		cr.Messages = append(cr.Messages, provider.Message{Role: m.Role, Content: content})
	}
	return cr
}

func extractText(content any) string {
	switch v := content.(type) {
	case string:
		return v
	case []any:
		var b strings.Builder
		for _, item := range v {
			if block, ok := item.(map[string]any); ok {
				if t, ok := block["text"].(string); ok {
					b.WriteString(t)
				}
			}
		}
		return b.String()
	}
	return fmt.Sprintf("%v", content)
}

func mapStopReason(reason string) string {
	switch reason {
	case "stop":
		return "end_turn"
	case "tool_use":
		return "tool_use"
	case "length":
		return "max_tokens"
	default:
		return "end_turn"
	}
}

func isAPIError(err error, target **provider.APIError) bool {
	if err == nil {
		return false
	}
	type unwrapper interface{ Unwrap() error }
	for err != nil {
		if e, ok := err.(*provider.APIError); ok {
			*target = e
			return true
		}
		if u, ok := err.(unwrapper); ok {
			err = u.Unwrap()
		} else {
			break
		}
	}
	return false
}
