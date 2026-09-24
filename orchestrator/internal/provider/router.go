package provider

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"strings"
	"sync"
	"time"
)

type Router struct {
	primary    Provider
	fallbacks  []Provider
	maxRetries int
	cooldownTTL time.Duration

	mu        sync.Mutex
	cooldowns map[string]time.Time
}

func NewRouter(primary Provider, fallbacks []Provider, maxRetries int, cooldownSecs int) *Router {
	return &Router{
		primary:     primary,
		fallbacks:   fallbacks,
		maxRetries:  maxRetries,
		cooldownTTL: time.Duration(cooldownSecs) * time.Second,
		cooldowns:   make(map[string]time.Time),
	}
}

func (r *Router) Name() string { return "router" }

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
		var err error
		for attempt := 0; attempt < r.maxRetries; attempt++ {
			var resp ChatResponse
			resp, err = p.Complete(ctx, req)
			if err == nil {
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
		r.setCooldown(p.Name())
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
		ch, err := p.Stream(ctx, req)
		if err == nil {
			return ch, nil
		}
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
