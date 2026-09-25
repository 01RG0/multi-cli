package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/01rg0/orchestrator/internal/memory"
	"github.com/01rg0/orchestrator/internal/provider"
)

// proxyRequest mirrors the Anthropic /v1/messages request body.
// System is any because the SDK sends either a plain string or
// a []{"type":"text","text":"..."} content block array.
type proxyRequest struct {
	Model       string          `json:"model"`
	Messages    []proxyMessage  `json:"messages"`
	System      any             `json:"system,omitempty"`
	Tools       []provider.Tool `json:"tools,omitempty"`
	MaxTokens   int             `json:"max_tokens,omitempty"`
	Stream      bool            `json:"stream,omitempty"`
	Temperature float64         `json:"temperature,omitempty"`
}

type proxyMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

type contentBlock struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

// proxyResponse mirrors the Anthropic /v1/messages response body.
type proxyResponse struct {
	ID           string         `json:"id"`
	Type         string         `json:"type"`
	Role         string         `json:"role"`
	Content      []contentBlock `json:"content"`
	Model        string         `json:"model"`
	StopReason   string         `json:"stop_reason"`
	StopSequence *string        `json:"stop_sequence"`
	Usage        proxyUsage     `json:"usage"`
}

type proxyUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

// handleMessages proxies through the global router.
func (s *Server) handleMessages(w http.ResponseWriter, r *http.Request) {
	s.proxyWithRouter(w, r, s.router, r.Header.Get("X-Agent-ID"))
}

// handleAgentProxy handles /agent/{agentId}/v1/messages and /agent/{agentId}/messages,
// routing through a per-agent provider chain if configured.
func (s *Server) handleAgentProxy(w http.ResponseWriter, r *http.Request) {
	// Path: /agent/{agentId}/v1/messages  or  /agent/{agentId}/messages
	path := strings.TrimPrefix(r.URL.Path, "/agent/")
	parts := strings.SplitN(path, "/", 3)
	if len(parts) < 2 {
		http.NotFound(w, r)
		return
	}
	agentID := parts[0]
	// Must end with "messages"
	if parts[len(parts)-1] != "messages" {
		http.NotFound(w, r)
		return
	}
	agentRouter := s.buildAgentRouter(agentID)
	s.proxyWithRouter(w, r, agentRouter, agentID)
}

// proxyWithRouter is the shared core used by handleMessages and handleAgentProxy.
func (s *Server) proxyWithRouter(w http.ResponseWriter, r *http.Request, rtr *provider.Router, agentID string) {
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
		log.Printf("proxy: agent=%s model=%s stream=%v messages=%d", agentID, req.Model, req.Stream, len(req.Messages))
	}

	chatReq := toChatRequest(req)

	// Extract last user message text for memory retrieval and episode logging.
	var lastUserText string
	for i := len(chatReq.Messages) - 1; i >= 0; i-- {
		if chatReq.Messages[i].Role == "user" {
			lastUserText = chatReq.Messages[i].Content
			break
		}
	}

	// Inject memory context into system prompt when memory is enabled.
	if s.cfg.MemoryEnabled && s.graph != nil && lastUserText != "" {
		memBlock := s.buildMemoryBlock(r.Context(), lastUserText)
		if memBlock != "" {
			if len(chatReq.Messages) > 0 && chatReq.Messages[0].Role == "system" {
				chatReq.Messages[0].Content += "\n\n" + memBlock
			} else {
				chatReq.Messages = append([]provider.Message{{Role: "system", Content: memBlock}}, chatReq.Messages...)
			}
		}
	}

	if req.Stream {
		s.handleStream(w, r, chatReq, req.Model, rtr)
		return
	}

	resp, err := rtr.Complete(r.Context(), chatReq)
	if err != nil {
		code := http.StatusBadGateway
		var apiErr *provider.APIError
		if isAPIError(err, &apiErr) && apiErr.StatusCode == 429 {
			code = http.StatusTooManyRequests
		}
		http.Error(w, err.Error(), code)
		return
	}

	// Async episode write — must not block the HTTP response.
	if s.graph != nil {
		assistantText := resp.Content
		go func() {
			epCtx := context.Background()
			compact, _ := json.Marshal(map[string]string{"user": lastUserText, "assistant": assistantText})
			if _, err := s.graph.AppendEpisode(epCtx, memory.Episode{
				AgentID: agentID,
				Kind:    "message",
				Content: string(compact),
			}); err != nil {
				log.Printf("memory: episode write: %v", err)
			}
		}()
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

func (s *Server) handleStream(w http.ResponseWriter, r *http.Request, chatReq provider.ChatRequest, model string, rtr *provider.Router) {
	ch, err := rtr.Stream(r.Context(), chatReq)
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

	writeSSE(w, flusher, map[string]any{
		"type": "message_start",
		"message": map[string]any{
			"id": msgID, "type": "message", "role": "assistant",
			"model": model, "content": []any{},
			"stop_reason": nil, "usage": map[string]int{"input_tokens": 0, "output_tokens": 0},
		},
	})
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
		"type":  "message_delta",
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
	if sys := extractText(req.System); sys != "" {
		cr.Messages = append(cr.Messages, provider.Message{Role: "system", Content: sys})
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

// buildMemoryBlock assembles the <memory> XML block to inject into system prompt.
func (s *Server) buildMemoryBlock(ctx context.Context, query string) string {
	k := s.cfg.RetrievalK
	if k <= 0 {
		k = 5
	}

	var coreContent string
	if core, err := s.graph.ReadCore(ctx); err == nil {
		coreContent = core.Content
	} else {
		log.Printf("memory: read core: %v", err)
	}

	results, err := s.graph.Search(ctx, query, k)
	if err != nil {
		log.Printf("memory: search: %v", err)
	}

	if coreContent == "" && len(results) == 0 {
		return ""
	}

	var sb strings.Builder
	sb.WriteString("<memory>\n")
	if coreContent != "" {
		sb.WriteString("<core>")
		sb.WriteString(coreContent)
		sb.WriteString("</core>\n")
	}
	sb.WriteString("<retrieved>\n")
	for _, r := range results {
		sb.WriteString(r.Node.Label)
		sb.WriteString(": ")
		sb.WriteString(r.Node.Type)
		sb.WriteString("\n")
	}
	sb.WriteString("</retrieved>\n")
	sb.WriteString("</memory>")
	return sb.String()
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
