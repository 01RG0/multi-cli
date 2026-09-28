package provider

import (
	"log"
	"context"
	"errors"
	"fmt"
	"math/rand"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ProviderStats tracks per-provider usage counters (all atomic, no lock needed).
type ProviderStats struct {
	Requests     atomic.Int64
	InputTokens  atomic.Int64
	OutputTokens atomic.Int64
	Errors       atomic.Int64
	LastUsedMs   atomic.Int64 // unix millis of last successful call
}

type Router struct {
	primary    Provider
	fallbacks  []Provider
	maxRetries int
	cooldownTTL time.Duration

	mu        sync.Mutex
	cooldowns map[string]time.Time

	statsMu sync.RWMutex
	stats   map[string]*ProviderStats
}

func NewRouter(primary Provider, fallbacks []Provider, maxRetries int, cooldownSecs int) *Router {
	return &Router{
		primary:     primary,
		fallbacks:   fallbacks,
		maxRetries:  maxRetries,
		cooldownTTL: time.Duration(cooldownSecs) * time.Second,
		cooldowns:   make(map[string]time.Time),
		stats:       make(map[string]*ProviderStats),
	}
}

func (r *Router) Name() string { return "router" }

func (r *Router) providerStats(name string) *ProviderStats {
	r.statsMu.RLock()
	s, ok := r.stats[name]
	r.statsMu.RUnlock()
	if ok {
		return s
	}
	r.statsMu.Lock()
	defer r.statsMu.Unlock()
	if s, ok = r.stats[name]; ok {
		return s
	}
	s = &ProviderStats{}
	r.stats[name] = s
	return s
}

// AllStats returns a snapshot of all provider stats, keyed by provider name.
func (r *Router) AllStats() map[string]map[string]int64 {
	r.statsMu.RLock()
	defer r.statsMu.RUnlock()
	out := make(map[string]map[string]int64, len(r.stats))
	for name, s := range r.stats {
		out[name] = map[string]int64{
			"requests":      s.Requests.Load(),
			"input_tokens":  s.InputTokens.Load(),
			"output_tokens": s.OutputTokens.Load(),
			"errors":        s.Errors.Load(),
			"last_used_ms":  s.LastUsedMs.Load(),
		}
	}
	return out
}

func (r *Router) Complete(ctx context.Context, req ChatRequest) (ChatResponse, error) {
	chain := append([]Provider{r.primary}, r.fallbacks...)
	var lastErr error
	for _, p := range chain {
		if p == nil {
			continue
		}
		if r.isCooling(p.Name()) {
			continue
		}
		// Skip non-chat models for tool-use requests
		if len(req.Tools) > 0 && !isChatCapable(p.Model()) {
			continue
		}
		st := r.providerStats(p.Name())
		var err error
		for attempt := 0; attempt < r.maxRetries; attempt++ {
			var resp ChatResponse
			resp, err = p.Complete(ctx, req)
			if err == nil {
				st.Requests.Add(1)
				st.InputTokens.Add(int64(resp.Usage.InputTokens))
				st.OutputTokens.Add(int64(resp.Usage.OutputTokens))
				st.LastUsedMs.Store(time.Now().UnixMilli())
				return resp, nil
			}
			if isRateLimit(err) || isTransient(err) {
				select {
				case <-ctx.Done():
					return ChatResponse{}, ctx.Err()
				case <-time.After(backoff(attempt)):
				}
				continue
			}
			break
		}
		st.Errors.Add(1)
		// Only cooldown on rate-limit (429) or transient server errors (5xx).
		// Format/capability errors (4xx) mean this provider is the wrong choice
		// for this request type — skip it but don't penalize it for future requests.
		if isRateLimit(err) || isTransient(err) {
			r.setCooldown(p.Name())
		}
		lastErr = err
	}
	if lastErr == nil {
		return ChatResponse{}, fmt.Errorf("all providers cooling down")
	}
	return ChatResponse{}, fmt.Errorf("all providers exhausted: %w", lastErr)
}

func (r *Router) Stream(ctx context.Context, req ChatRequest) (<-chan StreamChunk, error) {
	chain := append([]Provider{r.primary}, r.fallbacks...)
	for _, p := range chain {
		if p == nil {
			continue
		}
		if r.isCooling(p.Name()) {
			continue
		}
		if len(req.Tools) > 0 && !isChatCapable(p.Model()) {
			continue
		}
		st := r.providerStats(p.Name())
		ch, err := p.Stream(ctx, req)
		if err == nil {
			st.Requests.Add(1)
			st.LastUsedMs.Store(time.Now().UnixMilli())
			return ch, nil
		}
		st.Errors.Add(1)
		r.setCooldown(p.Name())
	}
	return nil, fmt.Errorf("all providers unavailable for streaming")
}

func (r *Router) isCooling(name string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	until, ok := r.cooldowns[name]
	return ok && time.Now().Before(until)
}

func (r *Router) setCooldown(name string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.cooldowns[name] = time.Now().Add(r.cooldownTTL)
}

// isChatCapable returns false for models that are clearly not chat/tool-capable
// (speech, vision, image generation, etc.).
func isChatCapable(model string) bool {
	noChat := []string{"speech", "tts", "whisper", "audio", "vision", "image",
		"orpheus", "arabic", "safeguard", "embedding", "embed", "rerank"}
	lower := strings.ToLower(model)
	for _, s := range noChat {
		if strings.Contains(lower, s) {
			return false
		}
	}
	return true
}

// SortByTier reorders the fallback chain so higher-tier providers come first.
// Call this after ProbeModels to ensure the best models are tried first.
func (r *Router) SortByTier() {
	type scored struct {
		p    Provider
		tier int
	}
	// Score primary + fallbacks together, then split back out
	all := append([]Provider{r.primary}, r.fallbacks...)
	scores := make([]scored, 0, len(all))
	for _, p := range all {
		if p == nil {
			continue
		}
		tier := ModelTier[p.Model()]
		scores = append(scores, scored{p, tier})
	}
	// Stable sort: higher tier first
	for i := 1; i < len(scores); i++ {
		for j := i; j > 0 && scores[j].tier > scores[j-1].tier; j-- {
			scores[j], scores[j-1] = scores[j-1], scores[j]
		}
	}
	if len(scores) > 0 {
		r.primary = scores[0].p
		r.fallbacks = make([]Provider, len(scores)-1)
		for i, s := range scores[1:] {
			r.fallbacks[i] = s.p
		}
	}
	// Log new order
	for i, s := range scores {
		tierStr := ""
		if s.tier > 0 {
			tierStr = fmt.Sprintf(" tier=%d", s.tier)
		}
		log.Printf("router chain[%d]: %s (model=%s%s)", i, s.p.Name(), s.p.Model(), tierStr)
	}
}

func isRateLimit(err error) bool {
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		return apiErr.StatusCode == 429 ||
			strings.Contains(apiErr.Message, "overloaded_error") ||
			strings.Contains(apiErr.Message, "rate_limit")
	}
	return false
}

func isTransient(err error) bool {
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		return apiErr.StatusCode >= 500 && apiErr.StatusCode < 600
	}
	return false
}

func backoff(attempt int) time.Duration {
	base := time.Duration(1<<uint(attempt)) * 500 * time.Millisecond
	jitter := time.Duration(rand.Int63n(int64(base / 2)))
	return base + jitter
}
