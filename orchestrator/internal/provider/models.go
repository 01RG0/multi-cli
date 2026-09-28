package provider

// ModelTier ranks model capability. Higher = stronger.
// Update this map as new models are released.
var ModelTier = map[string]int{
	// Tier 5 — frontier reasoning
	"deepseek-reasoner":             5,
	"deepseek-r1":                   5,
	"o3":                            5,
	"o1":                            5,
	"claude-opus-4":                 5,
	"claude-opus-5-5":               5,
	// Tier 4 — strong general
	"gpt-4o":                        4,
	"gpt-4.1":                       4,
	"gpt-4-turbo":                   4,
	"deepseek-chat":                 4,
	"deepseek-v3":                   4,
	"claude-3-5-sonnet-20241022":    4,
	"claude-sonnet-5":               4,
	"gemini-2.0-flash-thinking-exp": 4,
	"gemini-2.5-pro":                4,
	"gemini-2.5-pro-preview":        4,
	"llama-4-maverick":              4,
	"llama-4-scout":                 4,
	// Tier 3 — mid capable
	"gpt-4o-mini":                   3,
	"gemini-2.0-flash":              3,
	"gemini-2.0-flash-exp":          3,
	"gemini-1.5-pro":                3,
	"claude-3-haiku-20240307":       3,
	"claude-haiku-4-5-20251001":     3,
	"qwen-max":                      3,
	"qwen2.5-72b-instruct":          3,
	"mistral-large-latest":          3,
	"llama-3.3-70b-versatile":       3,
	"llama3-70b-8192":               3,
	"meta-llama/llama-4-maverick":   3,
	// Tier 2 — fast/light
	"llama-3.1-8b-instant":          2,
	"llama3-8b-8192":                2,
	"gemini-1.5-flash":              2,
	"gemini-2.0-flash-lite":         2,
	"mistral-small-latest":          2,
	"mistral-small":                 2,
	"qwen-turbo":                    2,
	"qwen2.5-7b-instruct":           2,
	// Tier 1 — minimal
	"llama-3.2-1b-preview":          1,
	"llama-3.2-3b-preview":          1,
}

// BestModel returns the highest-tier model from the available list.
// Falls back to the first available model if none are in the tier map.
func BestModel(available []string) string {
	best, bestTier := "", -1
	for _, m := range available {
		tier := ModelTier[m]
		if tier > bestTier {
			bestTier = tier
			best = m
		}
	}
	if best == "" && len(available) > 0 {
		return available[0]
	}
	return best
}
