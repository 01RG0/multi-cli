package tests

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/01rg0/orchestrator/internal/config"
	"github.com/01rg0/orchestrator/internal/provider"
	"github.com/01rg0/orchestrator/internal/server"
)

// failingProvider always errors — used to exercise fallback-chain exhaustion.
type failingProvider struct{ name, model string }

func (f *failingProvider) Name() string     { return f.name }
func (f *failingProvider) Model() string    { return f.model }
func (f *failingProvider) SetModel(string)  {}
func (f *failingProvider) Complete(context.Context, provider.ChatRequest) (provider.ChatResponse, error) {
	return provider.ChatResponse{}, errors.New("simulated 404: model not found")
}
func (f *failingProvider) Stream(context.Context, provider.ChatRequest) (<-chan provider.StreamChunk, error) {
	return nil, errors.New("simulated 404: model not found")
}

// TestOpenAICompatURLJoin guards the base-URL duplication bug: providers
// configured as ".../v1" were called at "/v1/v1/chat/completions" and every
// request 404'd ("Cannot POST /v1/v1/chat/completions").
func TestOpenAICompatURLJoin(t *testing.T) {
	cases := []struct {
		name     string
		suffix   string
		wantPath string
	}{
		{"versioned base", "/v1", "/v1/chat/completions"},
		{"bare base", "", "/v1/chat/completions"},
		{"openai style base", "/openai", "/openai/v1/chat/completions"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var gotPath string
			ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotPath = r.URL.Path
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`))
			}))
			defer ts.Close()

			p := provider.NewOpenAI("test", ts.URL+tc.suffix, "key", "test-model")
			if _, err := p.Complete(context.Background(), provider.ChatRequest{
				Messages: []provider.Message{{Role: "user", Content: "hi"}},
			}); err != nil {
				t.Fatalf("Complete: %v", err)
			}
			if gotPath != tc.wantPath {
				t.Fatalf("request path = %q, want %q", gotPath, tc.wantPath)
			}
		})
	}
}

// TestRouterExhaustionReturnsChainError verifies a failed chain reports the
// per-provider causes instead of a bare "all providers exhausted".
func TestRouterExhaustionReturnsChainError(t *testing.T) {
	router := provider.NewRouter(
		&failingProvider{name: "alpha", model: "a-1"},
		[]provider.Provider{&failingProvider{name: "beta", model: "b-1"}},
		1, 10,
	)
	_, err := router.Complete(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{{Role: "user", Content: "hi"}},
	})
	var chainErr *provider.ChainError
	if !errors.As(err, &chainErr) {
		t.Fatalf("err = %v (%T), want *provider.ChainError", err, err)
	}
	if len(chainErr.Providers) != 2 {
		t.Fatalf("recorded %d provider failures, want 2", len(chainErr.Providers))
	}
	for _, want := range []string{"alpha", "beta"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error text %q does not mention provider %q", err.Error(), want)
		}
	}
}

// TestProxyRoutingFailureIsJSON guards the dashboard contract: a routing failure
// must answer with a JSON envelope (Anthropic error shape + per-provider
// causes), not a plain-text body that Cloudflare rewrites into an HTML page.
func TestProxyRoutingFailureIsJSON(t *testing.T) {
	cfg := &config.Config{ProxyPort: 8080, FallbackChain: []string{"alpha"}}
	router := provider.NewRouter(&failingProvider{name: "alpha", model: "a-1"}, nil, 1, 10)
	srv := server.New(router, cfg, nil)

	mux := http.NewServeMux()
	mux.HandleFunc("/v1/messages", srv.ServeMessages)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	reqBody := `{"model":"x","max_tokens":16,"messages":[{"role":"user","content":"hello"}]}`
	res, err := http.Post(ts.URL+"/v1/messages", "application/json", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d", res.StatusCode, http.StatusBadGateway)
	}
	if ct := res.Header.Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Fatalf("Content-Type = %q, want application/json", ct)
	}

	var payload struct {
		Type  string `json:"type"`
		Error struct {
			Type      string `json:"type"`
			Message   string `json:"message"`
			Providers []struct {
				Provider string `json:"provider"`
				Error    string `json:"error"`
			} `json:"providers"`
		} `json:"error"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if payload.Type != "error" || payload.Error.Type != "provider_unavailable" {
		t.Fatalf("unexpected envelope: %+v", payload)
	}
	if len(payload.Error.Providers) != 1 || payload.Error.Providers[0].Provider != "alpha" {
		t.Fatalf("providers = %+v, want a single alpha entry", payload.Error.Providers)
	}
}
