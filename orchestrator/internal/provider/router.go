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

// ProviderFailure records one provider's failure while the fallback chain was
// being walked. Small enough to send to the dashboard in an error response.
type ProviderFailure struct {
	Provider string `json:"provider"`
	Error    string `json:"error"`
}

// ChainError is returned when no provider in the fallback chain could serve the
// request. It carries the per-provider causes so the HTTP layer can report
// *why* routing failed instead of a bare "all providers exhausted" -- which is
// indistinguishable from a dead backend in the browser.
type ChainError struct {
	Message   string            `json:"message"`
	Providers []ProviderFailure `json:"providers,omitempty"`
}

func (e *ChainError) Error() string {
	if len(e.Providers) == 0 {
		return e.Message
	}
	parts := make([]string, 0, len(e.Providers))
	for _, f := range e.Providers {
		parts = append(parts, f.Provider+": "+f.Error)
	}
	return fmt.Sprintf("%s [%s]", e.Message, strings.Join(parts, "; "))
}

// errText flattens a provider error into one short, log/JSON-safe line.
func errText(err error) string {
	if err == nil {
		return ""
	}
	s := strings.Join(strings.Fields(err.Error()), " ")
	if len(s) > 240 {
		s = s[:240] + "..."
	}
	return s
}

// isDegradedResponse reports an HTTP 200 that carries no usable answer.
// Free tiers answer like this once the account quota is gone: a short notice
// such as "accounts that have not been recharged can only try 10 times" with no
// token accounting and no tool calls. Accepting it as success made the
// dashboard display the provider's billing notice as ULTRON's own reply.
func isDegradedResponse(resp ChatResponse) bool {
	return resp.Usage.InputTokens == 0 && resp.Usage.OutputTokens == 0 && len(resp.ToolCalls) == 0
}

func (r *Router) Complete(ctx context.Context, req ChatRequest) (ChatResponse, error) {
	chain := append([]Provider{r.primary}, r.fallbacks...)
	var lastErr error
	var degraded *ChatResponse
	failures := make([]ProviderFailure, 0, len(chain))
	cooling := 0
	for _, p := range chain {
		if p == nil {
			continue
		}
		if r.isCooling(p.Name()) {
			cooling++
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
				resp.Provider = p.Name()
				if isDegradedResponse(resp) {
					// Keep the first unusable-but-200 reply as a last resort, then
					// keep walking the chain: a healthy provider is preferred.
					if degraded == nil {
						first := resp
						degraded = &first
					}
					err = fmt.Errorf("degraded response (no tokens, no content)")
					break
				}
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
		failures = append(failures, ProviderFailure{Provider: p.Name(), Error: errText(err)})
		// Always log provider failures: without this a 502 from /v1/messages is
		// completely silent in the journal and looks like an infrastructure fault.
		log.Printf("router: %s failed (model=%s): %s", p.Name(), p.Model(), errText(err))
		// Re-rank so next request prefers working providers.
		go r.RebuildChain()
	}
	if degraded != nil {
		log.Printf("router: no provider produced a usable answer -- serving the best available reply from %s", degraded.Provider)
		return *degraded, nil
	}
	if lastErr == nil {
		msg := "all providers cooling down"
		if cooling > 0 {
			msg = fmt.Sprintf("all %d providers cooling down", cooling)
		}
		log.Printf("router: %s", msg)
		return ChatResponse{}, &ChainError{Message: msg}
	}
	msg := fmt.Sprintf("all providers exhausted (%d tried, %d cooling)", len(failures), cooling)
	log.Printf("router: %s -- last error: %s", msg, errText(lastErr))
	return ChatResponse{}, &ChainError{Message: msg, Providers: failures}
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
		rawCh, err := p.Stream(ctx, req)
		if err == nil {
			elapsed := time.Since(start).Milliseconds()
			now := time.Now().UnixMilli()
			st.Requests.Add(1)
			st.LastUsedMs.Store(now)
			st.LastSuccessMs.Store(now)
			st.TotalLatencyMs.Add(elapsed)
			// Wrap channel to capture usage from the Done chunk
			wrapped := make(chan StreamChunk, 64)
			go func() {
				defer close(wrapped)
				for chunk := range rawCh {
					if chunk.Done && (chunk.Usage.InputTokens > 0 || chunk.Usage.OutputTokens > 0) {
						st.InputTokens.Add(int64(chunk.Usage.InputTokens))
						st.OutputTokens.Add(int64(chunk.Usage.OutputTokens))
					}
					wrapped <- chunk
				}
			}()
			return wrapped, nil
		}
		st.Errors.Add(1)
		log.Printf("router: stream %s failed (model=%s): %s", p.Name(), p.Model(), errText(err))
		r.setCooldown(p.Name())
		go r.RebuildChain()
	}
	log.Printf("router: no provider available for streaming")
	return nil, &ChainError{Message: "all providers unavailable for streaming"}
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
// (speech, live-streaming, vision, image generation, etc.).
func isChatCapable(model string) bool {
	noChat := []string{"speech", "tts", "whisper", "audio", "vision", "image",
		"orpheus", "arabic", "safeguard", "embedding", "embed", "rerank",
		// Live/bidirectional streaming models (e.g. gemini-*-live-*) only accept
		// bidiGenerateContent over WebSocket, never plain chat completions.
		"live", "bidi", "realtime"}
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
			free := filterFreeModels(models)
			catalogMu.Lock()
			catalog[p.Name()] = free
			catalogMu.Unlock()
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

// ─── Model Catalog ────────────────────────────────────────────────────────────
// catalog stores all free models per provider, populated by AutoDiscoverModels.

var catalogMu sync.RWMutex
var catalog = map[string][]string{}

// filterFreeModels keeps models with :free/-free suffix, or all models if none
// have the suffix (implicitly-free providers like groq, mistral, cohere, gemini).
func filterFreeModels(models []string) []string {
	var free []string
	for _, m := range models {
		if strings.HasSuffix(m, ":free") || strings.HasSuffix(m, "-free") {
			free = append(free, m)
		}
	}
	if len(free) > 0 {
		return free
	}
	return models
}

// GetCatalog returns a snapshot of the free-model catalog.
func GetCatalog() map[string][]string {
	catalogMu.RLock()
	defer catalogMu.RUnlock()
	out := make(map[string][]string, len(catalog))
	for k, v := range catalog {
		cp := make([]string, len(v))
		copy(cp, v)
		out[k] = cp
	}
	return out
}

// AllProviders returns all providers in the router chain.
func (r *Router) AllProviders() []Provider {
	r.mu.Lock()
	defer r.mu.Unlock()
	all := make([]Provider, 0, 1+len(r.fallbacks))
	if r.primary != nil {
		all = append(all, r.primary)
	}
	all = append(all, r.fallbacks...)
	return all
}

// SwitchModel sets a new model on the named provider. Returns false if not found.
func (r *Router) SwitchModel(name, model string) bool {
	for _, p := range r.AllProviders() {
		if p.Name() == name {
			p.SetModel(model)
			score := ModelScore(model)
			r.mu.Lock()
			r.tierMap[name] = score
			r.mu.Unlock()
			log.Printf("[router] manual switch: %s → %s (score=%d)", name, model, score)
			return true
		}
	}
	return false
}

// TestProvider sends a minimal ping to the named provider.
func (r *Router) TestProvider(ctx context.Context, name string) error {
	for _, p := range r.AllProviders() {
		if p.Name() == name {
			req := ChatRequest{
				Model: p.Model(),
				Messages: []Message{
					{Role: "user", Content: "Hi"},
				},
				MaxTokens: 16,
			}
			_, err := p.Complete(ctx, req)
			return err
		}
	}
	return fmt.Errorf("provider %q not found", name)
}
