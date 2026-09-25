package tests

import (
	"context"
	"testing"
	"time"

	"github.com/01rg0/orchestrator/internal/db"
	"github.com/01rg0/orchestrator/internal/queue"
)

func openTestDB(t *testing.T) *queue.Queue {
	t.Helper()
	database, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return queue.New(database)
}

func TestEnqueueDequeue(t *testing.T) {
	q := openTestDB(t)
	ctx := context.Background()

	_, err := q.Enqueue(ctx, queue.Task{Type: "llm", Prompt: "hello", Priority: 0})
	if err != nil {
		t.Fatalf("enqueue: %v", err)
	}

	ctx2, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	task, err := q.Dequeue(ctx2)
	if err != nil {
		t.Fatalf("dequeue: %v", err)
	}
	if task.Prompt != "hello" {
		t.Errorf("prompt: got %q want hello", task.Prompt)
	}
	if task.Status != queue.StatusRunning {
		t.Errorf("status: got %q want running", task.Status)
	}
}

func TestPriorityOrdering(t *testing.T) {
	q := openTestDB(t)
	ctx := context.Background()

	_, _ = q.Enqueue(ctx, queue.Task{Type: "llm", Prompt: "low", Priority: 0})
	_, _ = q.Enqueue(ctx, queue.Task{Type: "llm", Prompt: "high", Priority: 10})
	_, _ = q.Enqueue(ctx, queue.Task{Type: "llm", Prompt: "medium", Priority: 5})

	ctx2, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	first, _ := q.Dequeue(ctx2)
	if first.Prompt != "high" {
		t.Errorf("first: got %q want high", first.Prompt)
	}
	second, _ := q.Dequeue(ctx2)
	if second.Prompt != "medium" {
		t.Errorf("second: got %q want medium", second.Prompt)
	}
}

func TestCompleteAndFail(t *testing.T) {
	q := openTestDB(t)
	ctx := context.Background()

	_, _ = q.Enqueue(ctx, queue.Task{Type: "llm", Prompt: "test1"})
	_, _ = q.Enqueue(ctx, queue.Task{Type: "llm", Prompt: "test2"})

	ctx2, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	t1, _ := q.Dequeue(ctx2)
	q.Complete(t1.ID, "result1")

	t2, _ := q.Dequeue(ctx2)
	q.Fail(t2.ID, "something broke")

	stats, err := q.Stats(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if stats["completed"] != 1 {
		t.Errorf("completed: got %d want 1", stats["completed"])
	}
	if stats["failed"] != 1 {
		t.Errorf("failed: got %d want 1", stats["failed"])
	}
}

func TestSuspendResume(t *testing.T) {
	q := openTestDB(t)
	ctx := context.Background()

	_, _ = q.Enqueue(ctx, queue.Task{Type: "llm", Prompt: "suspendable"})
	ctx2, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	task, _ := q.Dequeue(ctx2)
	q.Suspend(task.ID, "checkpoint-abc")

	stats, _ := q.Stats(ctx)
	if stats["suspended"] != 1 {
		t.Errorf("suspended: got %d want 1", stats["suspended"])
	}

	q.Resume(task.ID)
	stats2, _ := q.Stats(ctx)
	if stats2["pending"] != 1 {
		t.Errorf("after resume pending: got %d want 1", stats2["pending"])
	}
}

func TestWorkerPool(t *testing.T) {
	q := openTestDB(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Enqueue 6 tasks
	for i := 0; i < 6; i++ {
		_, _ = q.Enqueue(ctx, queue.Task{Type: "llm", Prompt: "task"})
	}

	processed := make(chan struct{}, 10)
	pool := queue.NewWorkerPool(3, q, func(ctx context.Context, t queue.Task) (string, error) {
		time.Sleep(50 * time.Millisecond)
		processed <- struct{}{}
		return "done", nil
	})

	go pool.Start(ctx)

	timeout := time.After(5 * time.Second)
	count := 0
	for count < 6 {
		select {
		case <-processed:
			count++
		case <-timeout:
			t.Fatalf("timeout: only processed %d/6 tasks", count)
		}
	}
}
