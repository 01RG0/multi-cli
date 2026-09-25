package tests

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/01rg0/orchestrator/internal/logbuf"
)

func TestLogBufNew(t *testing.T) {
	// Test positive capacity
	lb := logbuf.New(50)
	if lb == nil {
		t.Fatal("expected non-nil LogBuffer")
	}
	if all := lb.All(0); len(all) != 0 {
		t.Errorf("expected 0 initial entries, got %d", len(all))
	}

	// Test default capacity fallback when capacity <= 0
	lbDefault := logbuf.New(0)
	if lbDefault == nil {
		t.Fatal("expected non-nil LogBuffer with default cap")
	}
	if all := lbDefault.All(0); len(all) != 0 {
		t.Errorf("expected 0 initial entries, got %d", len(all))
	}

	lbNegative := logbuf.New(-10)
	if lbNegative == nil {
		t.Fatal("expected non-nil LogBuffer with negative cap")
	}
}

func TestLogBufAppendAndRingEviction(t *testing.T) {
	capSize := 3
	lb := logbuf.New(capSize)

	// Append entries within capacity
	lb.Append(logbuf.LogEntry{AgentID: "agent-1", TaskID: "task-1", Stream: "stdout", Line: "line 1", TS: 100})
	lb.Append(logbuf.LogEntry{AgentID: "agent-1", TaskID: "task-1", Stream: "stdout", Line: "line 2", TS: 200})

	entries := lb.All(0)
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(entries))
	}
	if entries[0].Line != "line 1" || entries[1].Line != "line 2" {
		t.Errorf("unexpected entry order before eviction: %+v", entries)
	}

	// Reach full capacity
	lb.Append(logbuf.LogEntry{AgentID: "agent-1", TaskID: "task-1", Stream: "stdout", Line: "line 3", TS: 300})
	entries = lb.All(0)
	if len(entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(entries))
	}

	// Exceed capacity: line 1 should be evicted, ring wraps around
	lb.Append(logbuf.LogEntry{AgentID: "agent-1", TaskID: "task-1", Stream: "stdout", Line: "line 4", TS: 400})
	entries = lb.All(0)
	if len(entries) != 3 {
		t.Fatalf("expected capSize 3 entries after 1 eviction, got %d", len(entries))
	}
	expectedLines := []string{"line 2", "line 3", "line 4"}
	for i, want := range expectedLines {
		if entries[i].Line != want {
			t.Errorf("at index %d: got line %q, want %q", i, entries[i].Line, want)
		}
	}

	// Evict again: line 2 should be evicted
	lb.Append(logbuf.LogEntry{AgentID: "agent-2", TaskID: "task-2", Stream: "stderr", Line: "line 5", TS: 500})
	entries = lb.All(0)
	if len(entries) != 3 {
		t.Fatalf("expected capSize 3 entries after 2 evictions, got %d", len(entries))
	}
	expectedLines = []string{"line 3", "line 4", "line 5"}
	for i, want := range expectedLines {
		if entries[i].Line != want {
			t.Errorf("at index %d: got line %q, want %q", i, entries[i].Line, want)
		}
	}
}

func TestLogBufGetByTaskID(t *testing.T) {
	lb := logbuf.New(10)

	// Interleave entries across task-A and task-B
	entriesToAppend := []logbuf.LogEntry{
		{AgentID: "agent-1", TaskID: "task-A", Stream: "stdout", Line: "taskA-1", TS: 100},
		{AgentID: "agent-2", TaskID: "task-B", Stream: "stdout", Line: "taskB-1", TS: 200},
		{AgentID: "agent-1", TaskID: "task-A", Stream: "stderr", Line: "taskA-2", TS: 300},
		{AgentID: "agent-2", TaskID: "task-B", Stream: "stderr", Line: "taskB-2", TS: 400},
		{AgentID: "agent-1", TaskID: "task-A", Stream: "stdout", Line: "taskA-3", TS: 500},
	}
	for _, e := range entriesToAppend {
		lb.Append(e)
	}

	// Filter task-A with limit <= 0 (all)
	taskAAll := lb.Get("task-A", 0)
	if len(taskAAll) != 3 {
		t.Fatalf("expected 3 entries for task-A, got %d", len(taskAAll))
	}
	if taskAAll[0].Line != "taskA-1" || taskAAll[1].Line != "taskA-2" || taskAAll[2].Line != "taskA-3" {
		t.Errorf("task-A entries not in chronological order: %+v", taskAAll)
	}

	// Filter task-B with limit
	taskBAll := lb.Get("task-B", 0)
	if len(taskBAll) != 2 {
		t.Fatalf("expected 2 entries for task-B, got %d", len(taskBAll))
	}
	if taskBAll[0].Line != "taskB-1" || taskBAll[1].Line != "taskB-2" {
		t.Errorf("task-B entries not in chronological order: %+v", taskBAll)
	}

	// Limit smaller than available entries returns most recent entries
	taskALimited := lb.Get("task-A", 2)
	if len(taskALimited) != 2 {
		t.Fatalf("expected 2 entries with limit=2, got %d", len(taskALimited))
	}
	if taskALimited[0].Line != "taskA-2" || taskALimited[1].Line != "taskA-3" {
		t.Errorf("expected most recent 2 entries (taskA-2, taskA-3), got %+v", taskALimited)
	}

	// Limit larger than available returns all matching
	taskBLargeLimit := lb.Get("task-B", 10)
	if len(taskBLargeLimit) != 2 {
		t.Fatalf("expected 2 entries with limit=10, got %d", len(taskBLargeLimit))
	}

	// Non-existent task returns empty slice
	taskNone := lb.Get("task-nonexistent", 0)
	if len(taskNone) != 0 {
		t.Errorf("expected 0 entries for nonexistent task, got %d", len(taskNone))
	}

	// Mutating returned slice should not affect buffer
	taskAAll[0].Line = "mutated"
	refetch := lb.Get("task-A", 0)
	if refetch[0].Line == "mutated" {
		t.Error("buffer returned slice should be detached from internal storage")
	}
}

func TestLogBufAllWithLimit(t *testing.T) {
	lb := logbuf.New(20)

	for i := 1; i <= 10; i++ {
		lb.Append(logbuf.LogEntry{
			AgentID: "agent-1",
			TaskID:  fmt.Sprintf("task-%d", i),
			Stream:  "stdout",
			Line:    fmt.Sprintf("entry-%d", i),
			TS:      int64(i * 100),
		})
	}

	// All entries
	all := lb.All(0)
	if len(all) != 10 {
		t.Fatalf("expected 10 entries, got %d", len(all))
	}
	if all[0].Line != "entry-1" || all[9].Line != "entry-10" {
		t.Errorf("unexpected chronological ordering: first=%s, last=%s", all[0].Line, all[9].Line)
	}

	// Limit = 4 returns the 4 newest entries
	limit4 := lb.All(4)
	if len(limit4) != 4 {
		t.Fatalf("expected 4 entries, got %d", len(limit4))
	}
	for i, want := range []string{"entry-7", "entry-8", "entry-9", "entry-10"} {
		if limit4[i].Line != want {
			t.Errorf("limit 4 index %d: got %s, want %s", i, limit4[i].Line, want)
		}
	}

	// Limit exceeding total count returns all entries
	limit25 := lb.All(25)
	if len(limit25) != 10 {
		t.Fatalf("expected 10 entries with limit 25, got %d", len(limit25))
	}
}

func TestLogBufConcurrent(t *testing.T) {
	lb := logbuf.New(100)
	const numWriters = 10
	const entriesPerWriter = 100
	const numReaders = 5

	var wg sync.WaitGroup
	ctxDone := make(chan struct{})

	// Start reader goroutines
	for r := 0; r < numReaders; r++ {
		wg.Add(1)
		go func(readerID int) {
			defer wg.Done()
			for {
				select {
				case <-ctxDone:
					return
				default:
					_ = lb.All(10)
					_ = lb.Get(fmt.Sprintf("task-%d", readerID%numWriters), 5)
					time.Sleep(1 * time.Millisecond)
				}
			}
		}(r)
	}

	// Start writer goroutines
	var writerWg sync.WaitGroup
	for w := 0; w < numWriters; w++ {
		writerWg.Add(1)
		go func(writerID int) {
			defer writerWg.Done()
			taskID := fmt.Sprintf("task-%d", writerID)
			for i := 0; i < entriesPerWriter; i++ {
				lb.Append(logbuf.LogEntry{
					AgentID: fmt.Sprintf("agent-%d", writerID),
					TaskID:  taskID,
					Stream:  "stdout",
					Line:    fmt.Sprintf("writer-%d-line-%d", writerID, i),
					TS:      time.Now().UnixMilli(),
				})
			}
		}(w)
	}

	writerWg.Wait()
	close(ctxDone)
	wg.Wait()

	// Buffer should have exactly 100 entries (capped)
	finalEntries := lb.All(0)
	if len(finalEntries) != 100 {
		t.Errorf("expected 100 capped entries after concurrent writes, got %d", len(finalEntries))
	}
}
