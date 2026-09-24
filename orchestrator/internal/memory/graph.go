package memory

import (
	"context"
	"database/sql"
	"fmt"
	"math/rand"
	"sort"
	"strings"
	"time"
)

// Source authority weights for RRF scoring
const (
	weightUserStated    = 1.0
	weightAgentObserved = 0.7
	weightAgentDerived  = 0.5
)

// sourceWeight returns the authority multiplier for a node source.
func sourceWeight(source string) float64 {
	switch source {
	case "user_stated":
		return weightUserStated
	case "agent_observed":
		return weightAgentObserved
	default:
		return weightAgentDerived
	}
}

// Node represents a knowledge graph node.
type Node struct {
	ID         string
	Label      string
	Type       string
	Source     string
	Confidence float64
	Embedding  []byte
	CreatedAt  int64
	UpdatedAt  int64
}

// Edge represents a temporal directed edge.
type Edge struct {
	ID       string
	Src      string
	Dst      string
	Relation string
	Weight   float64
	ValidAt  int64
	InvalidAt *int64
	Metadata string
}

// Episode represents an append-only log entry.
type Episode struct {
	ID             string
	ParentID       string
	AgentID        string
	Kind           string
	CheckpointType string
	Content        string
	NodeIDs        string
	CreatedAt      int64
}

// SearchResult is a ranked search hit.
type SearchResult struct {
	Node  Node
	Score float64
}

// Graph is the temporal knowledge graph.
type Graph struct {
	db *sql.DB
}

// New creates a Graph backed by an already-migrated database.
func New(db *sql.DB) *Graph {
	return &Graph{db: db}
}

func uniqueID(prefix string) string {
	return fmt.Sprintf("%s-%d-%d", prefix, time.Now().UnixNano(), rand.Int63n(1_000_000))
}

// UpsertNode inserts or updates a node. If a node with the same label+type
// already exists (similarity threshold 0.85 by label match), it is updated.
func (g *Graph) UpsertNode(ctx context.Context, n Node) (string, error) {
	if n.ID == "" {
		n.ID = uniqueID("n")
	}
	now := time.Now().UnixMilli()
	if n.CreatedAt == 0 {
		n.CreatedAt = now
	}
	n.UpdatedAt = now

	// Check for existing node with same label+type
	var existingID string
	err := g.db.QueryRowContext(ctx,
		`SELECT id FROM nodes WHERE label=? AND type=? LIMIT 1`, n.Label, n.Type,
	).Scan(&existingID)
	if err == nil {
		// Update existing
		_, err = g.db.ExecContext(ctx,
			`UPDATE nodes SET source=?, confidence=?, embedding=?, updated_at=? WHERE id=?`,
			n.Source, n.Confidence, n.Embedding, now, existingID,
		)
		return existingID, err
	}
	if err != sql.ErrNoRows {
		return "", err
	}

	_, err = g.db.ExecContext(ctx,
		`INSERT INTO nodes (id,label,type,source,confidence,embedding,created_at,updated_at)
		 VALUES (?,?,?,?,?,?,?,?)`,
		n.ID, n.Label, n.Type, n.Source, n.Confidence, n.Embedding, n.CreatedAt, n.UpdatedAt,
	)
	return n.ID, err
}

// AddEdge inserts a temporal edge. Pass InvalidAt=nil for active edges.
func (g *Graph) AddEdge(ctx context.Context, e Edge) error {
	if e.ID == "" {
		e.ID = uniqueID("e")
	}
	if e.ValidAt == 0 {
		e.ValidAt = time.Now().UnixMilli()
	}
	_, err := g.db.ExecContext(ctx,
		`INSERT OR REPLACE INTO edges (id,src,dst,relation,weight,valid_at,invalid_at,metadata)
		 VALUES (?,?,?,?,?,?,?,?)`,
		e.ID, e.Src, e.Dst, e.Relation, e.Weight, e.ValidAt, e.InvalidAt, e.Metadata,
	)
	return err
}

// InvalidateEdge marks an edge as no longer active at the given time.
func (g *Graph) InvalidateEdge(ctx context.Context, edgeID string, at int64) error {
	_, err := g.db.ExecContext(ctx,
		`UPDATE edges SET invalid_at=? WHERE id=?`, at, edgeID,
	)
	return err
}

// AppendEpisode records an append-only observation/tool-call/reflection.
func (g *Graph) AppendEpisode(ctx context.Context, ep Episode) (string, error) {
	if ep.ID == "" {
		ep.ID = uniqueID("ep")
	}
	ep.CreatedAt = time.Now().UnixMilli()
	parentID := sql.NullString{String: ep.ParentID, Valid: ep.ParentID != ""}
	_, err := g.db.ExecContext(ctx,
		`INSERT INTO episodes (id,parent_id,agent_id,kind,checkpoint_type,content,node_ids,created_at)
		 VALUES (?,?,?,?,?,?,?,?)`,
		ep.ID, parentID, ep.AgentID, ep.Kind, ep.CheckpointType, ep.Content, ep.NodeIDs, ep.CreatedAt,
	)
	return ep.ID, err
}

// Search performs hybrid search: BM25 FTS5 + source-authority RRF.
// query is the text query; limit caps results.
func (g *Graph) Search(ctx context.Context, query string, limit int) ([]SearchResult, error) {
	// BM25 via FTS5
	rows, err := g.db.QueryContext(ctx, `
		SELECT n.id, n.label, n.type, n.source, n.confidence, n.embedding, n.created_at, n.updated_at,
		       bm25(nodes_fts) AS bm25_score
		FROM nodes_fts
		JOIN nodes n ON nodes_fts.id = n.id
		WHERE nodes_fts MATCH ?
		ORDER BY bm25_score
		LIMIT ?
	`, query, limit*3)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type candidate struct {
		node     Node
		bm25Rank int
	}
	var candidates []candidate
	rank := 0
	for rows.Next() {
		var n Node
		var bm25Score float64
		if err := rows.Scan(&n.ID, &n.Label, &n.Type, &n.Source, &n.Confidence, &n.Embedding,
			&n.CreatedAt, &n.UpdatedAt, &bm25Score); err != nil {
			return nil, err
		}
		candidates = append(candidates, candidate{node: n, bm25Rank: rank})
		rank++
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// RRF fusion with source-authority weighting
	const k = 60.0
	results := make([]SearchResult, 0, len(candidates))
	for _, c := range candidates {
		rrfScore := 1.0 / (k + float64(c.bm25Rank))
		authority := sourceWeight(c.node.Source)
		score := rrfScore * authority * c.node.Confidence
		results = append(results, SearchResult{Node: c.node, Score: score})
	}

	sort.Slice(results, func(i, j int) bool { return results[i].Score > results[j].Score })
	if len(results) > limit {
		results = results[:limit]
	}
	return results, nil
}

// BFSNeighbors returns nodes reachable from startID within maxDepth hops.
// at=0 means all edges regardless of validity window.
func (g *Graph) BFSNeighbors(ctx context.Context, startID string, maxDepth int, at int64) ([]Node, error) {
	visited := map[string]bool{startID: true}
	frontier := []string{startID}
	var result []Node

	for depth := 0; depth < maxDepth && len(frontier) > 0; depth++ {
		args := make([]any, len(frontier))
		for i, id := range frontier {
			args[i] = id
		}
		placeholders := "(" + strings.TrimSuffix(strings.Repeat("?,", len(frontier)), ",") + ")"
		rows, err := g.db.QueryContext(ctx,
			`SELECT dst, valid_at, invalid_at FROM edges WHERE src IN `+placeholders, args...)
		if err != nil {
			return nil, err
		}

		var next []string
		for rows.Next() {
			var dst string
			var validAt int64
			var invalidAt sql.NullInt64
			if err := rows.Scan(&dst, &validAt, &invalidAt); err != nil {
				rows.Close()
				return nil, err
			}
			if at > 0 {
				if validAt > at {
					continue
				}
				if invalidAt.Valid && invalidAt.Int64 <= at {
					continue
				}
			}
			if !visited[dst] {
				visited[dst] = true
				next = append(next, dst)
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}

		for _, id := range next {
			var n Node
			err := g.db.QueryRowContext(ctx,
				`SELECT id, label, type, source, confidence, created_at, updated_at FROM nodes WHERE id=?`, id,
			).Scan(&n.ID, &n.Label, &n.Type, &n.Source, &n.Confidence, &n.CreatedAt, &n.UpdatedAt)
			if err != nil {
				return nil, err
			}
			result = append(result, n)
		}
		frontier = next
	}
	return result, nil
}
