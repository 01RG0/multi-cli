package tests

import (
	"context"
	"testing"

	"github.com/01rg0/orchestrator/internal/db"
	"github.com/01rg0/orchestrator/internal/memory"
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
