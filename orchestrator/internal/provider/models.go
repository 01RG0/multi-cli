package provider

import (
	"regexp"
	"strconv"
	"strings"
)

// ScoreModelName scores any model purely from its name — no hardcoded lookup table.
// Higher = stronger/smarter. Works for new models automatically without code changes.
func ScoreModelName(name string) int {
	n := strings.ToLower(name)
	score := 10

	// --- Penalize small/cheap models ---
	if containsAny(n, "nano", "tiny", "micro") {
		score -= 6
	}
	if containsAny(n, "mini", "lite", "light") {
		score -= 4
	}
	if containsAny(n, "small") {
		score -= 3
	}

	// --- Boost strong qualifiers ---
	if containsAny(n, "ultra", "heavy") {
		score += 5
	}
	if containsAny(n, "pro", "plus", "max", "large") {
		score += 3
	}
	if containsAny(n, "reasoning", "think", "-r1", ":r1") {
		score += 6
	}
	// slight penalty for preview/experimental
	if containsAny(n, "preview", "alpha", "beta") {
		score -= 1
	}

	// --- Parameter count: e.g. "70b", "235b", "2.4t" ---
	if m := regexp.MustCompile(`(\d+(?:\.\d+)?)b`).FindStringSubmatch(n); len(m) > 1 {
		params, _ := strconv.ParseFloat(m[1], 64)
		switch {
		case params >= 400:
			score += 8
		case params >= 200:
			score += 7
		case params >= 100:
			score += 6
		case params >= 60:
			score += 5
		case params >= 30:
			score += 4
		case params >= 14:
			score += 3
		case params >= 7:
			score += 2
		case params >= 3:
			score += 1
		default:
			score -= 3
		}
	}
	if m := regexp.MustCompile(`(\d+(?:\.\d+)?)t`).FindStringSubmatch(n); len(m) > 1 {
		params, _ := strconv.ParseFloat(m[1], 64)
		if params >= 1 {
			score += 10 // trillion-parameter models
		}
	}

	// --- Version number: newer = better (e.g. v4.1 → +8, v3.5 → +7) ---
	for _, m := range regexp.MustCompile(`(\d+)\.(\d+)`).FindAllStringSubmatch(n, -1) {
		major, _ := strconv.Atoi(m[1])
		minor, _ := strconv.Atoi(m[2])
		v := major*10 + minor/10
		if v > 0 && v < 100 {
			score += v / 5
		}
	}

	// --- Well-known strong model families ---
	if containsAny(n, "claude-opus", "claude-sonnet", "claude-fable") {
		score += 8
	}
	if containsAny(n, "gpt-6", "gpt-5", "gpt-4") {
		score += 5
	}
	if containsAny(n, "deepseek-v4", "deepseek-v3", "deepseek-v4.1") {
		score += 5
	}
	if containsAny(n, "gemini-3", "gemini-2.5") {
		score += 5
	}
	if containsAny(n, "gemini-2", "gemini-1.5") {
		score += 3
	}
	if containsAny(n, "grok-4", "grok-3") {
		score += 5
	}
	if containsAny(n, "kimi-k3", "kimi-k2") {
		score += 4
	}
	if containsAny(n, "qwen3", "qwen3.8") {
		score += 3
	}
	if containsAny(n, "nemotron-3-ultra", "nemotron-3-super") {
		score += 5
	}
	if containsAny(n, "llama-4", "llama-3.3") {
		score += 3
	}
	if containsAny(n, "mistral-large", "magistral") {
		score += 3
	}
	if containsAny(n, "mistral-small", "ministral") {
		score += 1
	}
	if containsAny(n, "command-r-plus", "command-a") {
		score += 4
	}

	// :free or -free suffix = explicitly free-tier model.
	// Large boost so free models always beat same-family paid models when
	// a provider has $0 balance — prevents auto-discovery picking paid models.
	if strings.HasSuffix(n, ":free") || strings.HasSuffix(n, "-free") {
		score += 20
	}

	// Non-chat models: safety/embedding/speech/image — skip for routing
	if containsAny(n, "guard", "safety", "embed", "moderat", "asr", "tts",
		"transcribe", "realtime", "image", "vision", "ocr", "rerank", "parse") {
		score -= 20
	}

	if score < 0 {
		score = 0
	}
	return score
}

func containsAny(s string, subs ...string) bool {
	for _, sub := range subs {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}

// BestModelByScore picks the highest-scoring model from a list.
// Returns "" if the list is empty so the caller keeps its configured default.
func BestModelByScore(models []string) string {
	best, bestScore := "", -1
	for _, m := range models {
		if s := ScoreModelName(m); s > bestScore {
			bestScore = s
			best = m
		}
	}
	return best
}

// BestModel selects the best model from a list — delegates to BestModelByScore.
// Kept for callers in probe.go.
func BestModel(available []string) string {
	return BestModelByScore(available)
}

// ModelScore returns the heuristic score for a single model name.
// Used by the router for tier-based chain sorting.
func ModelScore(name string) int {
	return ScoreModelName(name)
}
