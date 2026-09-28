package provider

import (
	"context"
	"log"
	"sync"
)

// ModelProber is implemented by providers that can report available models.
type ModelProber interface {
	ListModels(ctx context.Context) ([]string, error)
	SetModel(model string)
	Model() string
	Name() string
}

// ProbeModels concurrently queries each provider for its available models,
// selects the best one by score, and updates the provider's default model.
// Failures are silently skipped — not all providers expose /v1/models.
// Returns a map of provider name -> selected model score (0 = unknown/unchanged).
func ProbeModels(ctx context.Context, providers map[string]Provider) map[string]int {
	results := make(map[string]int, len(providers))
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, p := range providers {
		mp, ok := p.(ModelProber)
		if !ok {
			continue
		}
		wg.Add(1)
		go func(mp ModelProber) {
			defer wg.Done()
			models, err := mp.ListModels(ctx)
			if err != nil || len(models) == 0 {
				return
			}
			best := BestModel(models)
			if best == "" {
				return
			}
			score := ModelScore(best)
			log.Printf("provider %s: auto-selected model %s (score=%d)", mp.Name(), best, score)
			mp.SetModel(best)
			mu.Lock()
			results[mp.Name()] = score
			mu.Unlock()
		}(mp)
	}
	wg.Wait()
	return results
}
