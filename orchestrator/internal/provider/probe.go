package provider

import (
	"context"
	"fmt"
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
// selects the best one by tier, and updates the provider's default model.
// Failures are silently skipped — not all providers expose /v1/models.
func ProbeModels(ctx context.Context, providers map[string]Provider) {
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
			tier := ModelTier[best]
			var tierLabel string
			if tier > 0 {
				tierLabel = fmt.Sprintf(" (tier %d)", tier)
			}
			log.Printf("provider %s: selected model %s%s", mp.Name(), best, tierLabel)
			mp.SetModel(best)
		}(mp)
	}
	wg.Wait()
}
