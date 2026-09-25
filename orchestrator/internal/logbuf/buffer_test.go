package logbuf

import (
	"fmt"
	"sync"
	"testing"
)

func TestLogBufferAppendAndGet(t *testing.T) {
	lb := New(5)

	lb.Append(LogEntry{AgentID: "agent1", TaskID: "task-1", Stream: "stdout", Line: "line 1", TS: 100})
	lb.Append(LogEntry{AgentID: "agent1", TaskID: "task-1", Stream: "stderr", Line: "line 2", TS: 200})
	lb.Append(LogEntry{AgentID: "agent2", TaskID: "task-2", Stream: "stdout", Line: "task 2 line", TS: 300})

	task1Logs := lb.Get("task-1", 10)
	if len(task1Logs) != 2 {
		t.Fatalf("expected 2 logs for task-1, got %d", len(task1Logs))
	}
	if task1Logs[0].Line != "line 1" || task1Logs[1].Line != "line 2" {
		t.Errorf("unexpected logs content: %+v", task1Logs)
	}

	task2Logs := lb.Get("task-2", 1)
	if len(task2Logs) != 1 || task2Logs[0].Line != "task 2 line" {
		t.Errorf("unexpected task-2 logs: %+v", task2Logs)
	}

	allLogs := lb.All(10)
	if len(allLogs) != 3 {
		t.Fatalf("expected 3 total logs, got %d", len(allLogs))
	}
}

func TestLogBufferEviction(t *testing.T) {
	lb := New(3)

	for i := 1; i <= 5; i++ {
		lb.Append(LogEntry{
			AgentID: "agent",
			TaskID:  "task-1",
			Stream:  "stdout",
			Line:    fmt.Sprintf("line %d", i),
			TS:      int64(i * 10),
		})
	}

	all := lb.All(10)
	if len(all) != 3 {
		t.Fatalf("expected 3 entries after eviction, got %d", len(all))
	}
	if all[0].Line != "line 3" || all[1].Line != "line 4" || all[2].Line != "line 5" {
		t.Errorf("expected lines 3, 4, 5; got %+v", all)
	}
}

func TestLogBufferConcurrency(t *testing.T) {
	lb := New(100)
	var wg sync.WaitGroup

	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				lb.Append(LogEntry{
					AgentID: fmt.Sprintf("agent-%d", workerID),
					TaskID:  fmt.Sprintf("task-%d", workerID),
					Stream:  "stdout",
					Line:    fmt.Sprintf("worker %d line %d", workerID, j),
					TS:      int64(j),
				})
				_ = lb.Get(fmt.Sprintf("task-%d", workerID), 5)
				_ = lb.All(10)
			}
		}(i)
	}

	wg.Wait()
}
