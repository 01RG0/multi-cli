// Package skills manages user-defined reusable prompt templates (skills).
package skills

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// Skill is a named, reusable prompt template with optional tool bindings.
type Skill struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	Description    string   `json:"description"`
	PromptTemplate string   `json:"prompt_template"`
	Tools          []string `json:"tools"`
	AgentID        string   `json:"agent_id"`
	CreatedAt      int64    `json:"created_at"`
	UpdatedAt      int64    `json:"updated_at"`
}

// Migrate adds the skills table. Safe to call on an already-migrated database.
func Migrate(db *sql.DB) error {
	_, err := db.Exec(`
CREATE TABLE IF NOT EXISTS skills (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,
    description     TEXT NOT NULL DEFAULT '',
    prompt_template TEXT NOT NULL,
    tools           JSON NOT NULL DEFAULT '[]',
    agent_id        TEXT NOT NULL DEFAULT '',
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
)`)
	return err
}

// ListSkills returns all skills ordered by creation time descending.
func ListSkills(ctx context.Context, db *sql.DB) ([]Skill, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT id, name, description, prompt_template, tools, agent_id, created_at, updated_at
		 FROM skills ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Skill
	for rows.Next() {
		var s Skill
		var toolsRaw string
		if err := rows.Scan(&s.ID, &s.Name, &s.Description, &s.PromptTemplate, &toolsRaw, &s.AgentID, &s.CreatedAt, &s.UpdatedAt); err != nil {
			continue
		}
		s.Tools = decodeTools(toolsRaw)
		out = append(out, s)
	}
	if out == nil {
		out = []Skill{}
	}
	return out, nil
}

// GetSkill returns a single skill by ID.
func GetSkill(ctx context.Context, db *sql.DB, id string) (Skill, error) {
	row := db.QueryRowContext(ctx,
		`SELECT id, name, description, prompt_template, tools, agent_id, created_at, updated_at
		 FROM skills WHERE id=?`, id)
	var s Skill
	var toolsRaw string
	if err := row.Scan(&s.ID, &s.Name, &s.Description, &s.PromptTemplate, &toolsRaw, &s.AgentID, &s.CreatedAt, &s.UpdatedAt); err != nil {
		return s, err
	}
	s.Tools = decodeTools(toolsRaw)
	return s, nil
}

// UpsertSkill creates a new skill or updates an existing one (matched by ID).
// Returns the skill ID.
func UpsertSkill(ctx context.Context, db *sql.DB, s Skill) (string, error) {
	now := time.Now().UnixMilli()
	if s.ID == "" {
		s.ID = fmt.Sprintf("skill-%d", now)
	}
	if s.CreatedAt == 0 {
		s.CreatedAt = now
	}
	s.UpdatedAt = now

	toolsJSON := encodeTools(s.Tools)
	_, err := db.ExecContext(ctx, `
INSERT INTO skills (id, name, description, prompt_template, tools, agent_id, created_at, updated_at)
VALUES (?,?,?,?,?,?,?,?)
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name,
  description=excluded.description,
  prompt_template=excluded.prompt_template,
  tools=excluded.tools,
  agent_id=excluded.agent_id,
  updated_at=excluded.updated_at`,
		s.ID, s.Name, s.Description, s.PromptTemplate, toolsJSON, s.AgentID, s.CreatedAt, s.UpdatedAt,
	)
	if err != nil {
		return "", err
	}
	return s.ID, nil
}

// DeleteSkill removes a skill by ID.
func DeleteSkill(ctx context.Context, db *sql.DB, id string) error {
	_, err := db.ExecContext(ctx, `DELETE FROM skills WHERE id=?`, id)
	return err
}

// RenderSkill substitutes {{input}} and {{context}} in the prompt template.
func RenderSkill(s Skill, input, contextText string) string {
	out := s.PromptTemplate
	out = strings.ReplaceAll(out, "{{input}}", input)
	out = strings.ReplaceAll(out, "{{context}}", contextText)
	return out
}

// ─── helpers ─────────────────────────────────────────────────────────────────

func encodeTools(tools []string) string {
	if len(tools) == 0 {
		return "[]"
	}
	b, _ := json.Marshal(tools)
	return string(b)
}

func decodeTools(raw string) []string {
	if raw == "" || raw == "null" {
		return []string{}
	}
	var tools []string
	if err := json.Unmarshal([]byte(raw), &tools); err != nil {
		return []string{}
	}
	if tools == nil {
		return []string{}
	}
	return tools
}
