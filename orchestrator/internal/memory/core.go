package memory

import (
	"context"
	"database/sql"
	"time"
)

// Core holds the contents of the single-row core memory scratchpad.
type Core struct {
	Content   string
	UpdatedAt int64
}

// ReadCore reads the core memory row. Returns an empty Core (not an error)
// if no row has been written yet.
func ReadCore(ctx context.Context, db *sql.DB) (Core, error) {
	var c Core
	err := db.QueryRowContext(ctx,
		`SELECT content, updated_at FROM core_memory WHERE id=1`,
	).Scan(&c.Content, &c.UpdatedAt)
	if err == sql.ErrNoRows {
		return Core{}, nil
	}
	return c, err
}

// WriteCore upserts the core memory content.
func WriteCore(ctx context.Context, db *sql.DB, content string) error {
	_, err := db.ExecContext(ctx,
		`INSERT OR REPLACE INTO core_memory (id, content, updated_at) VALUES (1, ?, ?)`,
		content, time.Now().UnixMilli(),
	)
	return err
}

// ReadCore reads core memory using the Graph's internal DB connection.
func (g *Graph) ReadCore(ctx context.Context) (Core, error) {
	return ReadCore(ctx, g.db)
}

// WriteCore writes core memory using the Graph's internal DB connection.
func (g *Graph) WriteCore(ctx context.Context, content string) error {
	return WriteCore(ctx, g.db, content)
}
