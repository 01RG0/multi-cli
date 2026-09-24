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
	// SQLite settings for concurrent access
	if _, err := db.Exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;"); err != nil {
		return nil, fmt.Errorf("pragma: %w", err)
	}
	db.SetMaxOpenConns(1) // SQLite WAL: single writer, multiple readers
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
