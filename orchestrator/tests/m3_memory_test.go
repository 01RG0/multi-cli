package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/01rg0/orchestrator/internal/config"
	"github.com/01rg0/orchestrator/internal/db"
	"github.com/01rg0/orchestrator/internal/memory"
	"github.com/01rg0/orchestrator/internal/server"
)

func openMemoryDB(t *testing.T) *memory.Graph {
	t.Helper()
	database, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.Migrate(database); err != nil {
		t.Fatalf("queue migrate: %v", err)
	}
	if err := memory.Migrate(database); err != nil {
		t.Fatalf("memory migrate: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return memory.New(database)
}

func TestUpsertNode(t *testing.T) {
	g := openMemoryDB(t)
	ctx := context.Background()

	id1, err := g.UpsertNode(ctx, memory.Node{Label: "Go", Type: "language", Source: "user_stated", Confidence: 1.0})
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}

	// Second upsert with same label+type should return the same ID
	id2, err := g.UpsertNode(ctx, memory.Node{Label: "Go", Type: "language", Source: "agent_observed", Confidence: 0.9})
	if err != nil {
		t.Fatalf("upsert2: %v", err)
	}
	if id1 != id2 {
		t.Errorf("upsert should return existing node id: got %q want %q", id2, id1)
	}
}

func TestAddEdgeAndBFS(t *testing.T) {
	g := openMemoryDB(t)
	ctx := context.Background()

	nA, _ := g.UpsertNode(ctx, memory.Node{Label: "A", Type: "concept", Source: "user_stated", Confidence: 1.0})
	nB, _ := g.UpsertNode(ctx, memory.Node{Label: "B", Type: "concept", Source: "user_stated", Confidence: 1.0})
	nC, _ := g.UpsertNode(ctx, memory.Node{Label: "C", Type: "concept", Source: "user_stated", Confidence: 1.0})

	g.AddEdge(ctx, memory.Edge{Src: nA, Dst: nB, Relation: "knows"})
	g.AddEdge(ctx, memory.Edge{Src: nB, Dst: nC, Relation: "knows"})

	neighbors, err := g.BFSNeighbors(ctx, nA, 2, 0)
	if err != nil {
		t.Fatalf("bfs: %v", err)
	}
	if len(neighbors) < 2 {
		t.Errorf("bfs: got %d neighbors want >=2", len(neighbors))
	}
}

func TestTemporalEdgeInvalidation(t *testing.T) {
	g := openMemoryDB(t)
	ctx := context.Background()

	nA, _ := g.UpsertNode(ctx, memory.Node{Label: "X", Type: "concept", Source: "user_stated", Confidence: 1.0})
	nB, _ := g.UpsertNode(ctx, memory.Node{Label: "Y", Type: "concept", Source: "user_stated", Confidence: 1.0})

	edgeID := "e-test-123"
	g.AddEdge(ctx, memory.Edge{ID: edgeID, Src: nA, Dst: nB, Relation: "linked", ValidAt: 1000})
	g.InvalidateEdge(ctx, edgeID, 2000)

	// BFS at time before invalidation should find neighbor
	before, _ := g.BFSNeighbors(ctx, nA, 1, 1500)
	if len(before) == 0 {
		t.Error("expected neighbor before invalidation")
	}

	// BFS at time after invalidation should find no neighbor
	after, _ := g.BFSNeighbors(ctx, nA, 1, 2500)
	if len(after) > 0 {
		t.Errorf("expected no neighbors after invalidation, got %d", len(after))
	}
}

func TestAppendEpisode(t *testing.T) {
	g := openMemoryDB(t)
	ctx := context.Background()

	epID, err := g.AppendEpisode(ctx, memory.Episode{
		AgentID: "codex",
		Kind:    "observation",
		Content: "User asked about Go memory model",
	})
	if err != nil {
		t.Fatalf("episode: %v", err)
	}
	if epID == "" {
		t.Error("episode id empty")
	}

	// Chain a child episode
	_, err = g.AppendEpisode(ctx, memory.Episode{
		ParentID: epID,
		AgentID:  "codex",
		Kind:     "reflection",
		Content:  "Go uses happens-before for memory ordering",
	})
	if err != nil {
		t.Fatalf("child episode: %v", err)
	}
}

func TestHybridSearch(t *testing.T) {
	g := openMemoryDB(t)
	ctx := context.Background()

	g.UpsertNode(ctx, memory.Node{Label: "Golang concurrency", Type: "concept", Source: "user_stated", Confidence: 1.0})
	g.UpsertNode(ctx, memory.Node{Label: "Python async", Type: "concept", Source: "agent_derived", Confidence: 0.8})
	g.UpsertNode(ctx, memory.Node{Label: "Rust ownership", Type: "concept", Source: "agent_observed", Confidence: 0.9})

	results, err := g.Search(ctx, "Golang", 5)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(results) == 0 {
		t.Error("search: expected at least 1 result")
	}
	if results[0].Node.Label != "Golang concurrency" {
		t.Errorf("top result: got %q want Golang concurrency", results[0].Node.Label)
	}
	// user_stated node should score higher than agent_derived
	if results[0].Score <= 0 {
		t.Error("score should be positive")
	}
}

func TestGetGraphAndDeleteNode(t *testing.T) {
	g := openMemoryDB(t)
	ctx := context.Background()

	// Initial graph should be empty
	nodes, edges, err := g.GetGraph(ctx)
	if err != nil {
		t.Fatalf("GetGraph: %v", err)
	}
	if len(nodes) != 0 || len(edges) != 0 {
		t.Fatalf("expected empty graph, got %d nodes, %d edges", len(nodes), len(edges))
	}

	// Insert nodes and edges
	nA, err := g.UpsertNode(ctx, memory.Node{Label: "NodeA", Type: "semantic", Source: "user_stated", Confidence: 1.0})
	if err != nil {
		t.Fatalf("upsert A: %v", err)
	}
	nB, err := g.UpsertNode(ctx, memory.Node{Label: "NodeB", Type: "procedural", Source: "agent_observed", Confidence: 0.8})
	if err != nil {
		t.Fatalf("upsert B: %v", err)
	}

	err = g.AddEdge(ctx, memory.Edge{Src: nA, Dst: nB, Relation: "connects_to", Weight: 0.9})
	if err != nil {
		t.Fatalf("addEdge: %v", err)
	}

	// Inactive edge (invalidated)
	now := int64(100)
	err = g.AddEdge(ctx, memory.Edge{Src: nB, Dst: nA, Relation: "old_relation", Weight: 0.5, InvalidAt: &now})
	if err != nil {
		t.Fatalf("add old edge: %v", err)
	}

	// Fetch graph - should only have 1 active edge and 2 nodes
	nodes, edges, err = g.GetGraph(ctx)
	if err != nil {
		t.Fatalf("GetGraph: %v", err)
	}
	if len(nodes) != 2 {
		t.Fatalf("expected 2 nodes, got %d", len(nodes))
	}
	if len(edges) != 1 {
		t.Fatalf("expected 1 active edge, got %d", len(edges))
	}
	if edges[0].Src != nA || edges[0].Dst != nB {
		t.Errorf("unexpected edge: %+v", edges[0])
	}

	// Delete Node A
	if err := g.DeleteNode(ctx, nA); err != nil {
		t.Fatalf("DeleteNode: %v", err)
	}

	// Graph should now have 1 node and 0 edges
	nodes, edges, err = g.GetGraph(ctx)
	if err != nil {
		t.Fatalf("GetGraph after delete: %v", err)
	}
	if len(nodes) != 1 || nodes[0].ID != nB {
		t.Fatalf("expected 1 remaining node %q, got %d nodes", nB, len(nodes))
	}
	if len(edges) != 0 {
		t.Fatalf("expected 0 edges after delete, got %d", len(edges))
	}
}

func TestMemoryServerAPIs(t *testing.T) {
	database, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer database.Close()
	if err := db.Migrate(database); err != nil {
		t.Fatalf("db.Migrate: %v", err)
	}
	if err := memory.Migrate(database); err != nil {
		t.Fatalf("memory.Migrate: %v", err)
	}

	g := memory.New(database)
	cfg := &config.Config{ProxyPort: 8080}
	srv := server.New(nil, cfg, g)
	srv.RegisterUltronRoutes(database, g, nil)

	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	// 1. GET /api/memory/graph -> empty
	resp, err := http.Get(ts.URL + "/api/memory/graph")
	if err != nil {
		t.Fatalf("GET /api/memory/graph: %v", err)
	}
	var graphRes struct {
		Nodes []memory.Node `json:"nodes"`
		Edges []memory.Edge `json:"edges"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&graphRes); err != nil {
		resp.Body.Close()
		t.Fatalf("decode graph response: %v", err)
	}
	resp.Body.Close()
	if len(graphRes.Nodes) != 0 || len(graphRes.Edges) != 0 {
		t.Errorf("expected 0 nodes and 0 edges, got %d nodes, %d edges", len(graphRes.Nodes), len(graphRes.Edges))
	}

	// 2. POST /api/memory/upsert
	nodePayload := map[string]any{
		"label":      "Neural Memory",
		"type":       "semantic",
		"source":     "user_stated",
		"confidence": 1.0,
	}
	b, _ := json.Marshal(nodePayload)
	resp, err = http.Post(ts.URL+"/api/memory/upsert", "application/json", bytes.NewReader(b))
	if err != nil {
		t.Fatalf("POST /api/memory/upsert: %v", err)
	}
	var upsertRes struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&upsertRes); err != nil {
		resp.Body.Close()
		t.Fatalf("decode upsert response: %v", err)
	}
	resp.Body.Close()
	if upsertRes.ID == "" {
		t.Fatal("expected non-empty node id from upsert")
	}

	// 3. GET /api/memory/graph -> 1 node
	resp, err = http.Get(ts.URL + "/api/memory/graph")
	if err != nil {
		t.Fatalf("GET /api/memory/graph: %v", err)
	}
	if err := json.NewDecoder(resp.Body).Decode(&graphRes); err != nil {
		resp.Body.Close()
		t.Fatalf("decode graph response: %v", err)
	}
	resp.Body.Close()
	if len(graphRes.Nodes) != 1 || graphRes.Nodes[0].ID != upsertRes.ID {
		t.Fatalf("expected 1 node with id %q, got %d nodes", upsertRes.ID, len(graphRes.Nodes))
	}

	// 4. DELETE /api/memory/nodes/{id}
	req, _ := http.NewRequest(http.MethodDelete, ts.URL+"/api/memory/nodes/"+upsertRes.ID, nil)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("DELETE /api/memory/nodes: %v", err)
	}
	var delRes struct {
		Deleted string `json:"deleted"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&delRes); err != nil {
		resp.Body.Close()
		t.Fatalf("decode delete response: %v", err)
	}
	resp.Body.Close()
	if delRes.Deleted != upsertRes.ID {
		t.Errorf("delete response: got %q want %q", delRes.Deleted, upsertRes.ID)
	}

	// 5. GET /api/memory/graph -> 0 nodes
	resp, err = http.Get(ts.URL + "/api/memory/graph")
	if err != nil {
		t.Fatalf("GET /api/memory/graph after delete: %v", err)
	}
	if err := json.NewDecoder(resp.Body).Decode(&graphRes); err != nil {
		resp.Body.Close()
		t.Fatalf("decode graph response: %v", err)
	}
	resp.Body.Close()
	if len(graphRes.Nodes) != 0 {
		t.Errorf("expected 0 nodes after delete, got %d", len(graphRes.Nodes))
	}
}


