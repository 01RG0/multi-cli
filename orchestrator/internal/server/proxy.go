package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/01rg0/orchestrator/internal/memory"
	"github.com/01rg0/orchestrator/internal/provider"
)

// proxyErrorBody is the JSON envelope returned whenever routing fails. It keeps
// Anthropic's {"type":"error","error":{...}} shape (so SDK clients still read
// error.message) and adds the per-provider causes the router collected.
type proxyErrorBody struct {
	Type  string           `json:"type"`
	Error proxyErrorDetail `json:"error"`
}

type proxyErrorDetail struct {
	Type      string                     `json:"type"`
	Message   string                     `json:"message"`
	Providers []provider.ProviderFailure `json:"providers,omitempty"`
}

// writeProxyError reports a routing failure as JSON instead of a plain-text
// body. A bare "http.Error" here is what produced the unreadable
// "HTTP 502: <!DOCTYPE html>" chat message once Cloudflare rewrote the body.
func writeProxyError(w http.ResponseWriter, code int, err error) {
	detail := proxyErrorDetail{Type: "api_error", Message: err.Error()}
	var chainErr *provider.ChainError
	if errors.As(err, &chainErr) {
		detail.Type = "provider_unavailable"
		detail.Message = chainErr.Message
		detail.Providers = chainErr.Providers
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("X-Ultron-Error", detail.Type)
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(proxyErrorBody{Type: "error", Error: detail})
}

// chainTimeout is the budget for one /v1/messages request across the whole
// provider fallback chain. Without it, a chain of slow/rate-limited providers
// can outlive the HTTP server WriteTimeout (180s), which the browser sees as a
// gateway error even though the backend is healthy.
func (s *Server) chainTimeout() time.Duration {
	if s.cfg != nil && s.cfg.RequestTimeoutSeconds > 0 {
		return time.Duration(s.cfg.RequestTimeoutSeconds) * time.Second
	}
	return 90 * time.Second
}

// proxyRequest mirrors the Anthropic /v1/messages request body.
// System is any because the SDK sends either a plain string or
// a []{"type":"text","text":"..."} content block array.
type proxyRequest struct {
	Model       string          `json:"model"`
	Messages    []proxyMessage  `json:"messages"`
	System      any             `json:"system,omitempty"` // string or []contentBlock
	Tools       []provider.Tool `json:"tools,omitempty"`
	MaxTokens   int             `json:"max_tokens,omitempty"`
	Stream      bool            `json:"stream,omitempty"`
	Temperature float64         `json:"temperature,omitempty"`
}

type proxyMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"` // string or []contentBlock
}

type contentBlock struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
	// tool_use fields (outbound to client)
	ID    string          `json:"id,omitempty"`
	Name  string          `json:"name,omitempty"`
	Input json.RawMessage `json:"input,omitempty"`
	// tool_result fields (inbound from client in message history)
	ToolUseID string `json:"tool_use_id,omitempty"`
	Result    string `json:"content,omitempty"` // json tag "content" matches Anthropic spec
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

	// Extract last user message text — used for memory retrieval and episode logging.
	var lastUserText string
	for i := len(chatReq.Messages) - 1; i >= 0; i-- {
		if chatReq.Messages[i].Role == "user" {
			lastUserText = chatReq.Messages[i].Content
			break
		}
	}

	// Inject retrieved + core memory into system prompt when memory is enabled.
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
		s.handleStream(w, r, chatReq, req.Model)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.chainTimeout())
	defer cancel()

	resp, err := s.router.Complete(ctx, chatReq)
	if err != nil {
		code := http.StatusBadGateway
		var apiErr *provider.APIError
		if isAPIError(err, &apiErr) && apiErr.StatusCode == 429 {
			code = http.StatusTooManyRequests
		}
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			code = http.StatusGatewayTimeout
		}
		log.Printf("proxy: routing failed status=%d: %v", code, err)
		writeProxyError(w, code, err)
		return
	}

	// Async episode write — must not block the HTTP response.
	if s.graph != nil {
		assistantText := resp.Content
		agentID := r.Header.Get("X-Agent-ID")
		go func() {
			epCtx := context.Background()
			compact, _ := json.Marshal(map[string]string{"user": lastUserText, "assistant": assistantText})
			ep := memory.Episode{
				AgentID: agentID,
				Kind:    "message",
				Content: string(compact),
			}
			if epID, err := s.graph.AppendEpisode(epCtx, ep); err != nil {
				log.Printf("memory: episode write: %v", err)
			} else if s.Hub != nil {
				ep.ID = epID
				s.Hub.Broadcast(map[string]any{
					"type":    "memory_updated",
					"action":  "upsert",
					"episode": ep,
				})
			}
		}()
	}

	out := proxyResponse{
		ID:         fmt.Sprintf("msg_%d", time.Now().UnixNano()),
		Type:       "message",
		Role:       "assistant",
		Model:      req.Model,
		StopReason: mapStopReason(resp.FinishReason, len(resp.ToolCalls) > 0),
		Content:    buildRichContent(resp),
		Usage: proxyUsage{
			InputTokens:  resp.Usage.InputTokens,
			OutputTokens: resp.Usage.OutputTokens,
		},
	}

	w.Header().Set("Content-Type", "application/json")
	if resp.Provider != "" {
		// Lets the dashboard show which provider actually served the reply.
		w.Header().Set("X-Ultron-Provider", resp.Provider)
	}
	json.NewEncoder(w).Encode(out)
}

func (s *Server) handleStream(w http.ResponseWriter, r *http.Request, chatReq provider.ChatRequest, model string, rtr ...*provider.Router) {
	var router *provider.Router
	if len(rtr) > 0 && rtr[0] != nil {
		router = rtr[0]
	} else {
		router = s.router
	}
	ch, err := router.Stream(r.Context(), chatReq)
	if err != nil {
		log.Printf("proxy: stream routing failed: %v", err)
		writeProxyError(w, http.StatusBadGateway, err)
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

	var streamUsage provider.Usage
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
			streamUsage = chunk.Usage
			break
		}
	}

	writeSSE(w, flusher, map[string]any{"type": "content_block_stop", "index": 0})
	writeSSE(w, flusher, map[string]any{
		"type": "message_delta",
		"delta": map[string]string{"stop_reason": "end_turn", "stop_sequence": ""},
		"usage": map[string]int{"output_tokens": streamUsage.OutputTokens},
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

// buildRichContent constructs the Anthropic-format content block array from a provider response.
// It includes tool_use blocks when present so the client can run its tool-use loop.
func buildRichContent(resp provider.ChatResponse) []contentBlock {
	var blocks []contentBlock
	if resp.Content != "" {
		blocks = append(blocks, contentBlock{Type: "text", Text: resp.Content})
	}
	for _, tc := range resp.ToolCalls {
		input := tc.Arguments
		if len(input) == 0 {
			input = json.RawMessage("{}")
		}
		blocks = append(blocks, contentBlock{
			Type:  "tool_use",
			ID:    tc.ID,
			Name:  tc.Name,
			Input: input,
		})
	}
	if len(blocks) == 0 {
		blocks = []contentBlock{{Type: "text", Text: ""}}
	}
	return blocks
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
		msg := provider.Message{Role: m.Role, Content: extractText(m.Content)}
		// Preserve rich (non-string) content so the Anthropic provider can relay tool_use history.
		if _, isStr := m.Content.(string); !isStr && m.Content != nil {
			if raw, err := json.Marshal(m.Content); err == nil {
				msg.ContentRaw = raw
			}
		}
		cr.Messages = append(cr.Messages, msg)
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

func mapStopReason(reason string, hasToolCalls bool) string {
	if hasToolCalls {
		return "tool_use"
	}
	switch reason {
	case "stop":
		return "end_turn"
	case "tool_use", "tool_calls": // "tool_calls" is OpenAI-compat finish_reason
		return "tool_use"
	case "length":
		return "max_tokens"
	default:
		return "end_turn"
	}
}

// buildMemoryBlock assembles the <memory> XML block to inject into the system
// prompt. It reads core memory and performs a hybrid search for relevant nodes.
// Returns an empty string when there is nothing to inject.
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
			ep := memory.Episode{
				AgentID: agentID,
				Kind:    "message",
				Content: string(compact),
			}
			if epID, err := s.graph.AppendEpisode(epCtx, ep); err != nil {
				log.Printf("memory: episode write: %v", err)
			} else if s.Hub != nil {
				ep.ID = epID
				s.Hub.Broadcast(map[string]any{
					"type":    "memory_updated",
					"action":  "upsert",
					"episode": ep,
				})
			}
		}()
	}

	out := proxyResponse{
		ID:         fmt.Sprintf("msg_%d", time.Now().UnixNano()),
		Type:       "message",
		Role:       "assistant",
		Model:      req.Model,
		StopReason: mapStopReason(resp.FinishReason, len(resp.ToolCalls) > 0),
		Content:    buildRichContent(resp),
		Usage: proxyUsage{
			InputTokens:  resp.Usage.InputTokens,
			OutputTokens: resp.Usage.OutputTokens,
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}
