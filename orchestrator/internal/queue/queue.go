package queue

import (
	"context"
	"database/sql"
	"fmt"
	"math/rand"
	"time"
)

type Status string

const (
	StatusPending   Status = "pending"
	StatusRunning   Status = "running"
	StatusSuspended Status = "suspended"
	StatusCompleted Status = "completed"
	StatusFailed    Status = "failed"
)

type Task struct {
	ID          string
	Type        string
	Status      Status
	Priority    int
	AgentID     string
	Prompt      string
	Result      string
	Error       string
	CreatedAt   int64
	StartedAt   int64
	FinishedAt  int64
	SuspendedAt int64
	ResumeToken string
	Metadata    string
}

type Queue struct {
	db *sql.DB
}

func New(db *sql.DB) *Queue {
	return &Queue{db: db}
}

func newID() string {
	return fmt.Sprintf("%d-%d", time.Now().UnixNano(), rand.Int63())
}

func (q *Queue) Enqueue(ctx context.Context, t Task) error {
	if t.ID == "" {
		t.ID = newID()
	}
	if t.CreatedAt == 0 {
		t.CreatedAt = time.Now().UnixMilli()
	}
	_, err := q.db.ExecContext(ctx,
		`INSERT INTO tasks (id,type,status,priority,agent_id,prompt,created_at,metadata)
		 VALUES (?,?,?,?,?,?,?,?)`,
		t.ID, t.Type, StatusPending, t.Priority, t.AgentID, t.Prompt, t.CreatedAt, t.Metadata,
	)
	return err
}

// Dequeue atomically claims the highest-priority pending task.
// Blocks (with polling) until a task is available or ctx is cancelled.
func (q *Queue) Dequeue(ctx context.Context) (Task, error) {
	for {
		t, err := q.tryDequeue(ctx)
		if err == nil {
			return t, nil
		}
		if err != sql.ErrNoRows {
			return Task{}, err
		}
		select {
		case <-ctx.Done():
			return Task{}, ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}
}

func (q *Queue) tryDequeue(ctx context.Context) (Task, error) {
	tx, err := q.db.BeginTx(ctx, nil)
	if err != nil {
		return Task{}, err
	}
	defer tx.Rollback()

	var t Task
	err = tx.QueryRowContext(ctx,
		`SELECT id,type,status,priority,agent_id,prompt,created_at,metadata
		 FROM tasks WHERE status=? ORDER BY priority DESC, created_at ASC LIMIT 1`,
		StatusPending,
	).Scan(&t.ID, &t.Type, &t.Status, &t.Priority, &t.AgentID, &t.Prompt, &t.CreatedAt, &t.Metadata)
	if err != nil {
		return Task{}, err
	}

	now := time.Now().UnixMilli()
	_, err = tx.ExecContext(ctx,
		`UPDATE tasks SET status=?, started_at=? WHERE id=? AND status=?`,
		StatusRunning, now, t.ID, StatusPending,
	)
	if err != nil {
		return Task{}, err
	}
	t.Status = StatusRunning
	t.StartedAt = now
	return t, tx.Commit()
}

func (q *Queue) Complete(id, result string) error {
	_, err := q.db.Exec(
		`UPDATE tasks SET status=?, result=?, finished_at=? WHERE id=?`,
		StatusCompleted, result, time.Now().UnixMilli(), id,
	)
	return err
}

func (q *Queue) Fail(id, errMsg string) error {
	_, err := q.db.Exec(
		`UPDATE tasks SET status=?, error=?, finished_at=? WHERE id=?`,
		StatusFailed, errMsg, time.Now().UnixMilli(), id,
	)
	return err
}

func (q *Queue) Suspend(id, token string) error {
	_, err := q.db.Exec(
		`UPDATE tasks SET status=?, suspended_at=?, resume_token=? WHERE id=?`,
		StatusSuspended, time.Now().UnixMilli(), token, id,
	)
	return err
}

func (q *Queue) Resume(id string) error {
	_, err := q.db.Exec(
		`UPDATE tasks SET status=?, suspended_at=NULL, resume_token=NULL WHERE id=?`,
		StatusPending, id,
	)
	return err
}

func (q *Queue) Stats(ctx context.Context) (map[string]int, error) {
	rows, err := q.db.QueryContext(ctx, `SELECT status, COUNT(*) FROM tasks GROUP BY status`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m := make(map[string]int)
	for rows.Next() {
		var status string
		var count int
		if err := rows.Scan(&status, &count); err != nil {
			return nil, err
		}
		m[status] = count
	}
	return m, rows.Err()
}
