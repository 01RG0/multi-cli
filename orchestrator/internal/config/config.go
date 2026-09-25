package config

import (
	"fmt"
	"os"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

type ProviderConfig struct {
	Name      string `yaml:"name"`
	Type      string `yaml:"type"`       // "anthropic" | "openai_compat" | "bedrock"
	BaseURL   string `yaml:"base_url"`
	APIKey    string `yaml:"api_key"`
	Model     string `yaml:"model"`
	Region    string `yaml:"region"`     // bedrock only
	AccessKey string `yaml:"access_key"` // bedrock only
	SecretKey string `yaml:"secret_key"` // bedrock only
}

type ToolsConfig struct {
	Shell ShellToolConfig `yaml:"shell"`
	Web   WebToolConfig   `yaml:"web"`
}

type ShellToolConfig struct {
	TimeoutSeconds  int      `yaml:"timeout_seconds"`
	AllowedCommands []string `yaml:"allowed_commands"`
	DenyNetwork     bool     `yaml:"deny_network"`
}

type WebToolConfig struct {
	TimeoutSeconds  int `yaml:"timeout_seconds"`
	MaxResponseBytes int `yaml:"max_response_bytes"`
}

type Config struct {
	Providers       []ProviderConfig `yaml:"providers"`
	FallbackChain   []string         `yaml:"fallback_chain"`
	MaxRetries      int              `yaml:"max_retries"`
	CooldownSeconds int              `yaml:"cooldown_seconds"`
	ProxyPort       int              `yaml:"proxy_port"`
	ProxyLog        bool             `yaml:"proxy_log"`
	DBPath          string           `yaml:"db_path"`
	Concurrency     int              `yaml:"concurrency"`
	Tools           ToolsConfig      `yaml:"tools"`

	// Episode cleanup (used by improvement.EpisodeCleanup)
	EpisodeCleanupIntervalSecs int `yaml:"episode_cleanup_interval_secs"` // default 3600
	EpisodeMaxRows             int `yaml:"episode_max_rows"`               // default 10000
	EpisodeMaxAgeDays          int `yaml:"episode_max_age_days"`           // default 90
}

var envVarRe = regexp.MustCompile(`\$\{([^}]+)\}`)

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}

	// Interpolate ${ENV_VAR} references
	expanded := envVarRe.ReplaceAllStringFunc(string(data), func(m string) string {
		key := strings.TrimSuffix(strings.TrimPrefix(m, "${"), "}")
		return os.Getenv(key)
	})

	var cfg Config
	if err := yaml.Unmarshal([]byte(expanded), &cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	if cfg.MaxRetries == 0 {
		cfg.MaxRetries = 3
	}
	if cfg.CooldownSeconds == 0 {
		cfg.CooldownSeconds = 60
	}
	if cfg.DBPath == "" {
		cfg.DBPath = "orchestrator.db"
	}
	if cfg.Concurrency == 0 {
		cfg.Concurrency = 4
	}
	if cfg.Tools.Shell.TimeoutSeconds == 0 {
		cfg.Tools.Shell.TimeoutSeconds = 30
	}
	if cfg.Tools.Web.TimeoutSeconds == 0 {
		cfg.Tools.Web.TimeoutSeconds = 15
	}
	if cfg.Tools.Web.MaxResponseBytes == 0 {
		cfg.Tools.Web.MaxResponseBytes = 1 << 20
	}
	if len(cfg.Tools.Shell.AllowedCommands) == 0 {
		cfg.Tools.Shell.AllowedCommands = []string{"git", "go", "npm", "python", "node", "curl"}
	}
	if cfg.EpisodeCleanupIntervalSecs == 0 {
		cfg.EpisodeCleanupIntervalSecs = 3600
	}
	if cfg.EpisodeMaxRows == 0 {
		cfg.EpisodeMaxRows = 10000
	}
	if cfg.EpisodeMaxAgeDays == 0 {
		cfg.EpisodeMaxAgeDays = 90
	}
	return &cfg, nil
}
