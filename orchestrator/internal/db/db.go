package db

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

func Open(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	// Single connection — SQLite is not safe with concurrent writers.
	// Must be set BEFORE any Exec so all PRAGMAs run on the same connection
	// that will be reused for all future queries.
	db.SetMaxOpenConns(1)

	// Each PRAGMA in its own Exec — modernc.org/sqlite may stop after the
	// first statement in a multi-statement string, leaving subsequent PRAGMAs unexecuted.
	pragmas := []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA foreign_keys=ON",
		"PRAGMA busy_timeout=5000",
	}
	for _, p := range pragmas {
		if _, err := db.Exec(p); err != nil {
			// journal_mode=WAL returns "memory" on in-memory DBs — not an error
			if p != "PRAGMA journal_mode=WAL" {
				return nil, fmt.Errorf("%s: %w", p, err)
			}
		}
	}
	return db, nil
}

func Migrate(db *sql.DB) error {
	_, err := db.Exec(`
CREATE TABLE IF NOT EXISTS tasks (
    id           TEXT PRIMARY KEY,
    type         TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',
    priority     INTEGER DEFAULT 0,
    agent_id     TEXT,
    prompt       TEXT NOT NULL,
    result       TEXT,
    error        TEXT,
    created_at   INTEGER NOT NULL,
    started_at   INTEGER,
    finished_at  INTEGER,
    suspended_at INTEGER,
    resume_token TEXT,
    metadata     TEXT
);
CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status, priority DESC, created_at);
`)
	return err
}
