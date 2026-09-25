package memory

import "database/sql"

// Migrate creates the full graph memory schema:
// nodes, edges (temporal), episodes, FTS5 virtual tables.
func Migrate(db *sql.DB) error {
	_, err := db.Exec(`
-- Knowledge graph nodes
CREATE TABLE IF NOT EXISTS nodes (
    id          TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'concept',
    source      TEXT NOT NULL DEFAULT 'agent_observed',
    confidence  REAL NOT NULL DEFAULT 1.0,
    embedding   BLOB,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS nodes_source ON nodes(source);

-- FTS5 full-text index over node labels
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
    id UNINDEXED,
    label,
    content='nodes',
    content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
    INSERT INTO nodes_fts(rowid, id, label) VALUES (new.rowid, new.id, new.label);
END;
CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
    INSERT INTO nodes_fts(nodes_fts, rowid, id, label) VALUES('delete', old.rowid, old.id, old.label);
    INSERT INTO nodes_fts(rowid, id, label) VALUES (new.rowid, new.id, new.label);
END;
CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
    INSERT INTO nodes_fts(nodes_fts, rowid, id, label) VALUES('delete', old.rowid, old.id, old.label);
END;

-- Temporal knowledge graph edges (valid_at/invalid_at for time-travel)
CREATE TABLE IF NOT EXISTS edges (
    id          TEXT PRIMARY KEY,
    src         TEXT NOT NULL REFERENCES nodes(id),
    dst         TEXT NOT NULL REFERENCES nodes(id),
    relation    TEXT NOT NULL,
    weight      REAL NOT NULL DEFAULT 1.0,
    valid_at    INTEGER NOT NULL,
    invalid_at  INTEGER,
    metadata    TEXT
);
CREATE INDEX IF NOT EXISTS edges_src ON edges(src, valid_at);
CREATE INDEX IF NOT EXISTS edges_dst ON edges(dst, valid_at);
CREATE INDEX IF NOT EXISTS edges_temporal ON edges(valid_at, invalid_at);

-- Append-only episode log (conversation turns, tool calls, observations)
CREATE TABLE IF NOT EXISTS episodes (
    id               TEXT PRIMARY KEY,
    parent_id        TEXT REFERENCES episodes(id),
    agent_id         TEXT NOT NULL,
    kind             TEXT NOT NULL DEFAULT 'observation',
    checkpoint_type  TEXT,
    content          TEXT NOT NULL,
    node_ids         TEXT,
    created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS episodes_agent ON episodes(agent_id, created_at);
CREATE INDEX IF NOT EXISTS episodes_parent ON episodes(parent_id);

-- FTS5 over episodes content
CREATE VIRTUAL TABLE IF NOT EXISTS episodes_fts USING fts5(
    id UNINDEXED,
    agent_id UNINDEXED,
    content,
    content='episodes',
    content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS episodes_ai AFTER INSERT ON episodes BEGIN
    INSERT INTO episodes_fts(rowid, id, agent_id, content) VALUES (new.rowid, new.id, new.agent_id, new.content);
END;

-- Core memory: a single mutable scratchpad row
CREATE TABLE IF NOT EXISTS core_memory (
    id         INTEGER PRIMARY KEY CHECK(id=1),
    content    TEXT    NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL DEFAULT 0
);
`)
	if err != nil {
		return err
	}
	// vec_nodes: pure-Go cosine-similarity table.
	// sqlite-vec (vec0 virtual table) requires CGO or a loadable extension, neither of which is available
	// with modernc.org/sqlite. We store serialized little-endian float32 blobs (384 dims = nomic-embed-text)
	// in a plain table and do cosine similarity in Go inside Search() / UpsertNode().
	_, err = db.Exec(`
CREATE TABLE IF NOT EXISTS vec_nodes (
    node_id   TEXT PRIMARY KEY,
    embedding BLOB NOT NULL
);
`)
	return err
}
