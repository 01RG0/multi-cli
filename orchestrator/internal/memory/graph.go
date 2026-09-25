package memory

import (
	"context"
	"database/sql"
	"fmt"
	"log"
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
	ID         string  `json:"id"`
	Label      string  `json:"label"`
	Type       string  `json:"type"`
	Source     string  `json:"source"`
	Confidence float64 `json:"confidence"`
	Embedding  []byte  `json:"embedding,omitempty"`
	CreatedAt  int64   `json:"created_at"`
	UpdatedAt  int64   `json:"updated_at"`
}

// Edge represents a temporal directed edge.
type Edge struct {
	ID        string  `json:"id"`
	Src       string  `json:"src"`
	Dst       string  `json:"dst"`
	Relation  string  `json:"relation"`
	Weight    float64 `json:"weight"`
	ValidAt   int64   `json:"valid_at"`
	InvalidAt *int64  `json:"invalid_at,omitempty"`
	Metadata  string  `json:"metadata,omitempty"`
}

// Episode represents an append-only log entry.
type Episode struct {
	ID             string `json:"id"`
	ParentID       string `json:"parent_id,omitempty"`
	AgentID        string `json:"agent_id"`
	Kind           string `json:"kind"`
	CheckpointType string `json:"checkpoint_type,omitempty"`
	Content        string `json:"content"`
	NodeIDs        string `json:"node_ids,omitempty"`
	CreatedAt      int64  `json:"created_at"`
}

// SearchResult is a ranked search hit.
type SearchResult struct {
	Node  Node    `json:"node"`
	Score float64 `json:"score"`
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

// upsertVecNode inserts or replaces a row in vec_nodes. Soft-fails (log+return).
func (g *Graph) upsertVecNode(ctx context.Context, nodeID string, emb []float32) {
	blob := vecSerialize(emb)
	if _, err := g.db.ExecContext(ctx,
		`INSERT OR REPLACE INTO vec_nodes(node_id, embedding) VALUES (?, ?)`,
		nodeID, blob,
	); err != nil {
		log.Printf("memory: vec_nodes upsert for %s: %v", nodeID, err)
	}
}

// UpsertNode inserts or updates a node.
// Dedup order (Step 7):
//  1. Exact label+type match — fast, no embedding needed.
//  2. Embedding-similarity dedup — cosine similarity > 0.85 (only when Ollama available).
//  3. Insert new node.
//
// Embedding is computed via Ollama nomic-embed-text (soft-fail: nil when unreachable).
func (g *Graph) UpsertNode(ctx context.Context, n Node) (string, error) {
	if n.ID == "" {
		n.ID = uniqueID("n")
	}
	now := time.Now().UnixMilli()
	if n.CreatedAt == 0 {
		n.CreatedAt = now
	}
	n.UpdatedAt = now

	// Compute embedding for this label (soft-fail: nil if Ollama unavailable)
	emb, _ := EmbedLabel(ctx, n.Label)

	// --- 1) Exact label+type match (fast path, no embedding needed) ---
	var existingID string
	err := g.db.QueryRowContext(ctx,
		`SELECT id FROM nodes WHERE label=? AND type=? LIMIT 1`, n.Label, n.Type,
	).Scan(&existingID)
	if err == nil {
		// Update existing node
		_, err = g.db.ExecContext(ctx,
			`UPDATE nodes SET source=?, confidence=?, embedding=?, updated_at=? WHERE id=?`,
			n.Source, n.Confidence, n.Embedding, now, existingID,
		)
		if err != nil {
			return existingID, err
		}
		// Refresh embedding in vec_nodes
		if emb != nil {
			g.upsertVecNode(ctx, existingID, emb)
		}
		return existingID, nil
	}
	if err != sql.ErrNoRows {
		return "", err
	}

	// --- 2) Embedding similarity dedup (threshold cosine similarity > 0.85) ---
	if emb != nil {
		closestID, closestSim := g.vecClosest(ctx, emb, 1)
		if closestID != "" && closestSim > 0.85 {
			// Close-enough match — update it
			_, err = g.db.ExecContext(ctx,
				`UPDATE nodes SET source=?, confidence=?, embedding=?, updated_at=? WHERE id=?`,
				n.Source, n.Confidence, n.Embedding, now, closestID,
			)
			if err != nil {
				return closestID, err
			}
			g.upsertVecNode(ctx, closestID, emb)
			return closestID, nil
		}
	}

	// --- 3) Insert new node ---
	_, err = g.db.ExecContext(ctx,
		`INSERT INTO nodes (id,label,type,source,confidence,embedding,created_at,updated_at)
		 VALUES (?,?,?,?,?,?,?,?)`,
		n.ID, n.Label, n.Type, n.Source, n.Confidence, n.Embedding, n.CreatedAt, n.UpdatedAt,
	)
	if err != nil {
		return "", err
	}
	if emb != nil {
		g.upsertVecNode(ctx, n.ID, emb)
	}
	return n.ID, nil
}

// vecClosest returns the node_id and cosine similarity of the closest embedding
// in vec_nodes, scanning all rows. Returns ("", 0) if table is empty or on error.
func (g *Graph) vecClosest(ctx context.Context, query []float32, topK int) (string, float64) {
	rows, err := g.db.QueryContext(ctx, `SELECT node_id, embedding FROM vec_nodes`)
	if err != nil {
		return "", 0
	}
	defer rows.Close()

	type hit struct {
		id  string
		sim float64
	}
	var hits []hit
	for rows.Next() {
		var nodeID string
		var blob []byte
		if err := rows.Scan(&nodeID, &blob); err != nil {
			continue
		}
		v := vecDeserialize(blob)
		if v == nil {
			continue
		}
		sim := cosineSimilarity(query, v)
		hits = append(hits, hit{id: nodeID, sim: sim})
	}
	if err := rows.Err(); err != nil {
		return "", 0
	}
	if len(hits) == 0 {
		return "", 0
	}
	sort.Slice(hits, func(i, j int) bool { return hits[i].sim > hits[j].sim })
	if topK > 0 && len(hits) > topK {
		hits = hits[:topK]
	}
	return hits[0].id, hits[0].sim
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

// Search performs hybrid search: BM25 FTS5 + cosine-similarity RRF leg.
// Public signature is unchanged: (ctx, query, limit). The cosine leg is
// computed in-process via Ollama embeddings; if Ollama is unreachable the
// function falls back to BM25-only — no error is returned in that case.
func (g *Graph) Search(ctx context.Context, query string, limit int) ([]SearchResult, error) {
	if strings.TrimSpace(query) == "" {
		return []SearchResult{}, nil
	}
	// Escape FTS5 special chars by wrapping in double-quotes (phrase search).
	ftsQuery := `"` + strings.ReplaceAll(query, `"`, `""`) + `"`

	const k = 60.0

	// --- BM25 leg via FTS5 ---
	bm25Rows, err := g.db.QueryContext(ctx, `
		SELECT n.id, n.label, n.type, n.source, n.confidence, n.embedding, n.created_at, n.updated_at,
		       bm25(nodes_fts) AS bm25_score
		FROM nodes_fts
		JOIN nodes n ON nodes_fts.id = n.id
		WHERE nodes_fts MATCH ?
		ORDER BY bm25_score
		LIMIT ?
	`, ftsQuery, limit*3)
	if err != nil {
		return nil, err
	}
	defer bm25Rows.Close()

	// nodeID -> Node (union set)
	nodeMap := map[string]Node{}
	// nodeID -> bm25Rank (absent = not in BM25 results)
	bm25RankMap := map[string]int{}

	bm25Rank := 0
	for bm25Rows.Next() {
		var n Node
		var bm25Score float64
		if err := bm25Rows.Scan(&n.ID, &n.Label, &n.Type, &n.Source, &n.Confidence, &n.Embedding,
			&n.CreatedAt, &n.UpdatedAt, &bm25Score); err != nil {
			return nil, err
		}
		nodeMap[n.ID] = n
		bm25RankMap[n.ID] = bm25Rank
		bm25Rank++
	}
	if err := bm25Rows.Err(); err != nil {
		return nil, err
	}

	// --- Cosine similarity (vec) leg ---
	// vecRankMap: nodeID -> rank (0-based, sorted by similarity descending)
	vecRankMap := map[string]int{}

	queryEmb, _ := EmbedLabel(ctx, query) // soft-fail: nil when Ollama unavailable
	if queryEmb != nil {
		vecRankMap = g.vecRankedSearch(ctx, queryEmb, limit*3, nodeMap)
	}

	// --- RRF fusion ---
	const bigRank = 1_000_000 // placeholder for "not in this leg"
	results := make([]SearchResult, 0, len(nodeMap))
	for id, n := range nodeMap {
		br, bOK := bm25RankMap[id]
		if !bOK {
			br = bigRank
		}
		vr, vOK := vecRankMap[id]
		if !vOK {
			vr = bigRank
		}
		rrfScore := 1.0/(k+float64(br)) + 1.0/(k+float64(vr))
		authority := sourceWeight(n.Source)
		score := rrfScore * authority * n.Confidence
		results = append(results, SearchResult{Node: n, Score: score})
	}

	sort.Slice(results, func(i, j int) bool { return results[i].Score > results[j].Score })
	if len(results) > limit {
		results = results[:limit]
	}
	return results, nil
}

// vecRankedSearch computes cosine similarity between queryEmb and all rows in vec_nodes,
// returns a nodeID -> rank map (sorted by similarity descending). Also enriches nodeMap
// with nodes found in vec_nodes but not in BM25 results.
func (g *Graph) vecRankedSearch(ctx context.Context, queryEmb []float32, topK int, nodeMap map[string]Node) map[string]int {
	rows, err := g.db.QueryContext(ctx, `SELECT node_id, embedding FROM vec_nodes`)
	if err != nil {
		log.Printf("memory: vec_rankedSearch query: %v", err)
		return map[string]int{}
	}
	defer rows.Close()

	type hit struct {
		id  string
		sim float64
	}
	var hits []hit
	for rows.Next() {
		var nodeID string
		var blob []byte
		if err := rows.Scan(&nodeID, &blob); err != nil {
			continue
		}
		v := vecDeserialize(blob)
		if v == nil {
			continue
		}
		sim := cosineSimilarity(queryEmb, v)
		hits = append(hits, hit{id: nodeID, sim: sim})
	}
	if err := rows.Err(); err != nil {
		log.Printf("memory: vec_rankedSearch scan: %v", err)
		return map[string]int{}
	}

	sort.Slice(hits, func(i, j int) bool { return hits[i].sim > hits[j].sim })
	if topK > 0 && len(hits) > topK {
		hits = hits[:topK]
	}

	rankMap := make(map[string]int, len(hits))
	for rank, h := range hits {
		rankMap[h.id] = rank
		// If this node isn't in the BM25 results, load it for the union
		if _, ok := nodeMap[h.id]; !ok {
			var n Node
			err := g.db.QueryRowContext(ctx,
				`SELECT id, label, type, source, confidence, embedding, created_at, updated_at FROM nodes WHERE id=?`,
				h.id,
			).Scan(&n.ID, &n.Label, &n.Type, &n.Source, &n.Confidence, &n.Embedding, &n.CreatedAt, &n.UpdatedAt)
			if err == nil {
				nodeMap[h.id] = n
			}
		}
	}
	return rankMap
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

// GetGraph returns all nodes and currently active edges in the knowledge graph.
func (g *Graph) GetGraph(ctx context.Context) ([]Node, []Edge, error) {
	nodeRows, err := g.db.QueryContext(ctx,
		`SELECT id, label, type, source, confidence, created_at, updated_at FROM nodes ORDER BY created_at ASC`)
	if err != nil {
		return nil, nil, fmt.Errorf("query nodes: %w", err)
	}
	defer nodeRows.Close()

	nodes := make([]Node, 0)
	for nodeRows.Next() {
		var n Node
		if err := nodeRows.Scan(&n.ID, &n.Label, &n.Type, &n.Source, &n.Confidence, &n.CreatedAt, &n.UpdatedAt); err != nil {
			return nil, nil, fmt.Errorf("scan node: %w", err)
		}
		nodes = append(nodes, n)
	}
	if err := nodeRows.Err(); err != nil {
		return nil, nil, fmt.Errorf("nodes iteration: %w", err)
	}

	edgeRows, err := g.db.QueryContext(ctx,
		`SELECT id, src, dst, relation, weight, valid_at, invalid_at, metadata FROM edges WHERE invalid_at IS NULL ORDER BY weight DESC`)
	if err != nil {
		return nil, nil, fmt.Errorf("query edges: %w", err)
	}
	defer edgeRows.Close()

	edges := make([]Edge, 0)
	for edgeRows.Next() {
		var e Edge
		var invalidAt sql.NullInt64
		var metadata sql.NullString
		if err := edgeRows.Scan(&e.ID, &e.Src, &e.Dst, &e.Relation, &e.Weight, &e.ValidAt, &invalidAt, &metadata); err != nil {
			return nil, nil, fmt.Errorf("scan edge: %w", err)
		}
		if invalidAt.Valid {
			e.InvalidAt = &invalidAt.Int64
		}
		if metadata.Valid {
			e.Metadata = metadata.String
		}
		edges = append(edges, e)
	}
	if err := edgeRows.Err(); err != nil {
		return nil, nil, fmt.Errorf("edges iteration: %w", err)
	}

	return nodes, edges, nil
}

// DeleteNode deletes a node, its associated edges, and removes any corresponding embedding from vec_nodes.
func (g *Graph) DeleteNode(ctx context.Context, id string) error {
	tx, err := g.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM edges WHERE src = ? OR dst = ?`, id, id); err != nil {
		return fmt.Errorf("delete edges: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM vec_nodes WHERE node_id = ?`, id); err != nil {
		return fmt.Errorf("delete vec_nodes: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM nodes WHERE id = ?`, id); err != nil {
		return fmt.Errorf("delete node: %w", err)
	}

	return tx.Commit()
}

