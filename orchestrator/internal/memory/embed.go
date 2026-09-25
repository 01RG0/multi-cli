package memory

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"time"
)

const (
	ollamaEmbedURL  = "http://localhost:11434/api/embeddings"
	embeddingModel  = "nomic-embed-text"
	embeddingDims   = 384
	ollamaTimeout   = 5 * time.Second
)

var ollamaClient = &http.Client{Timeout: ollamaTimeout}

// EmbedLabel calls the Ollama API to get a 384-dim embedding for label.
// Returns nil, nil when Ollama is unreachable — soft failure, never blocks callers.
func EmbedLabel(ctx context.Context, label string) ([]float32, error) {
	body, err := json.Marshal(map[string]string{
		"model":  embeddingModel,
		"prompt": label,
	})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, ollamaEmbedURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := ollamaClient.Do(req)
	if err != nil {
		// Ollama unreachable — soft failure
		return nil, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ollama embeddings: status %d", resp.StatusCode)
	}

	var result struct {
		Embedding []float32 `json:"embedding"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	if len(result.Embedding) == 0 {
		return nil, nil
	}
	return result.Embedding, nil
}

// vecSerialize encodes a []float32 as a little-endian binary blob.
func vecSerialize(v []float32) []byte {
	buf := make([]byte, len(v)*4)
	for i, f := range v {
		binary.LittleEndian.PutUint32(buf[i*4:], math.Float32bits(f))
	}
	return buf
}

// vecDeserialize decodes a little-endian binary blob into []float32.
func vecDeserialize(b []byte) []float32 {
	if len(b)%4 != 0 {
		return nil
	}
	out := make([]float32, len(b)/4)
	for i := range out {
		out[i] = math.Float32frombits(binary.LittleEndian.Uint32(b[i*4:]))
	}
	return out
}

// cosineSimilarity returns the cosine similarity in [0,1] between two float32 vectors.
// Returns 0 for zero-length vectors.
func cosineSimilarity(a, b []float32) float64 {
	if len(a) != len(b) || len(a) == 0 {
		return 0
	}
	var dot, normA, normB float64
	for i := range a {
		ai, bi := float64(a[i]), float64(b[i])
		dot += ai * bi
		normA += ai * ai
		normB += bi * bi
	}
	if normA == 0 || normB == 0 {
		return 0
	}
	return dot / (math.Sqrt(normA) * math.Sqrt(normB))
}
