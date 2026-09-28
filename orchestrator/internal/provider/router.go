package provider

import (
	"log"
	"context"
	"errors"
	"fmt"
	"math/rand"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ProviderStats tracks per-provider usage counters (all atomic, no lock needed).
type ProviderStats struct {
	Requests       atomic.Int64
	InputTokens    atomic.Int64
	OutputTokens   atomic.Int64
	Errors         atomic.Int64
	LastUsedMs     atomic.Int64 // unix millis of last successful call
	LastSuccessMs  atomic.Int64 // unix millis of last successful call
	TotalLatencyMs atomic.Int64 // cumulative latency of successful calls (ms)
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

	// tierMap stores each provider's model tier, populated by SortByTier.
	// Used by RebuildChain so tier factors into live re-ranking.
	tierMap map[string]int
}

func NewRouter(primary Provider, fallbacks []Provider, maxRetries int, cooldownSecs int) *Router {
	return &Router{
		primary:     primary,
		fallbacks:   fallbacks,
		maxRetries:  maxRetries,
		cooldownTTL: time.Duration(cooldownSecs) * time.Second,
		cooldowns:   make(map[string]time.Time),
		stats:       make(map[string]*ProviderStats),
		tierMap:     make(map[string]int),
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
			"requests":         s.Requests.Load(),
			"input_tokens":     s.InputTokens.Load(),
			"output_tokens":    s.OutputTokens.Load(),
			"errors":           s.Errors.Load(),
			"last_used_ms":     s.LastUsedMs.Load(),
			"last_success_ms":  s.LastSuccessMs.Load(),
			"total_latency_ms": s.TotalLatencyMs.Load(),
		}
	}
	return out
}

// providerScore computes a routing score for a provider (higher = preferred).
// Score = successRate*10 + tier*0.5 - avgLatency*0.1
// Must NOT hold r.mu (called from RebuildChain which holds r.mu).
func (r *Router) providerScore(name string) float64 {
	st := r.providerStats(name) // uses statsMu, not r.mu -- safe
	reqs := st.Requests.Load()
	errs := st.Errors.Load()

	// Default to perfect score for untried providers so they get a chance.
	successRate := 1.0
	if reqs+errs > 0 {
		successRate = float64(reqs) / float64(reqs+errs)
	}

	// Avg latency in seconds (default 1s for untried).
	avgLatency := 1.0
	if reqs > 0 {
		avgLatency = float64(st.TotalLatencyMs.Load()) / float64(reqs) / 1000.0
	}

	tier := float64(r.tierMap[name]) // 0 for unknown, populated by SortByTier

	return successRate*10.0 + tier*0.5 - avgLatency*0.1
}

// RebuildChain re-sorts the fallback chain by live score (success rate + tier - latency).
// Called asynchronously after each provider failure so the chain adapts over time.
func (r *Router) RebuildChain() {
	r.mu.Lock()
	defer r.mu.Unlock()

	all := make([]Provider, 0, 1+len(r.fallbacks))
	if r.primary != nil {
		all = append(all, r.primary)
	}
	all = append(all, r.fallbacks...)

	sort.SliceStable(all, func(i, j int) bool {
		return r.providerScore(all[i].Name()) > r.providerScore(all[j].Name())
	})

	if len(all) > 0 {
		r.primary = all[0]
		r.fallbacks = all[1:]
	}
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
			start := time.Now()
			resp, err = p.Complete(ctx, req)
			if err == nil {
				elapsed := time.Since(start).Milliseconds()
				now := time.Now().UnixMilli()
				st.Requests.Add(1)
				st.InputTokens.Add(int64(resp.Usage.InputTokens))
				st.OutputTokens.Add(int64(resp.Usage.OutputTokens))
				st.LastUsedMs.Store(now)
				st.LastSuccessMs.Store(now)
				st.TotalLatencyMs.Add(elapsed)
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
		// for this request type -- skip it but don't penalize it for future requests.
		if isRateLimit(err) || isTransient(err) {
			r.setCooldown(p.Name())
		}
		lastErr = err
		// Re-rank so next request prefers working providers.
		go r.RebuildChain()
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
		start := time.Now()
		ch, err := p.Stream(ctx, req)
		if err == nil {
			elapsed := time.Since(start).Milliseconds()
			now := time.Now().UnixMilli()
			st.Requests.Add(1)
			st.LastUsedMs.Store(now)
			st.LastSuccessMs.Store(now)
			st.TotalLatencyMs.Add(elapsed)
			return ch, nil
		}
		st.Errors.Add(1)
		r.setCooldown(p.Name())
		go r.RebuildChain()
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
// Also populates tierMap used by RebuildChain for live re-ranking.
func (r *Router) SortByTier() {
	type scored struct {
		p    Provider
		tier int
	}
	all := append([]Provider{r.primary}, r.fallbacks...)
	scores := make([]scored, 0, len(all))
	for _, p := range all {
		if p == nil {
			continue
		}
		tier := ModelScore(p.Model())
		scores = append(scores, scored{p, tier})
		r.tierMap[p.Name()] = tier
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

// AutoDiscoverModels probes all providers for their model lists, picks the
// best-scoring model per provider, updates SetModel, and re-sorts the chain.
// Run as a goroutine after startup so it doesn't block serving.
func (r *Router) AutoDiscoverModels(ctx context.Context) {
	discoverCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	r.mu.Lock()
	all := make([]Provider, 0, 1+len(r.fallbacks))
	if r.primary != nil {
		all = append(all, r.primary)
	}
	all = append(all, r.fallbacks...)
	r.mu.Unlock()

	var wg sync.WaitGroup
	for _, p := range all {
		wg.Add(1)
		go func(p Provider) {
			defer wg.Done()
			mp, ok := p.(ModelProber)
			if !ok {
				return
			}
			models, err := mp.ListModels(discoverCtx)
			if err != nil || len(models) == 0 {
				return
			}
			best := BestModelByScore(models)
			if best == "" {
				return
			}
			current := p.Model()
			score := ModelScore(best)
			p.SetModel(best)
			r.mu.Lock()
			r.tierMap[p.Name()] = score
			r.mu.Unlock()
			if best != current {
				log.Printf("[router] auto-discover: %s → %s (score=%d, was %s)", p.Name(), best, score, current)
			} else {
				log.Printf("[router] auto-discover: %s → %s (score=%d, confirmed)", p.Name(), best, score)
			}
		}(p)
	}
	wg.Wait()
	r.SortByTier()
	log.Printf("[router] auto-discovery complete — chain re-sorted")
}
