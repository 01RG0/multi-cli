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
	StatusCancelled Status = "cancelled"
	StatusReplaced  Status = "replaced"
)

type Task struct {
	ID            string
	Type          string
	Status        Status
	Priority      int
	AgentID       string
	Prompt        string
	Result        string
	Error         string
	CreatedAt     int64
	StartedAt     int64
	FinishedAt    int64
	SuspendedAt   int64
	ResumeToken   string
	Metadata      string
	OriginalAgent string
	Attempt       int
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
	if t.Attempt == 0 {
		t.Attempt = 1
	}
	_, err := q.db.ExecContext(ctx,
		`INSERT INTO tasks (id,type,status,priority,agent_id,prompt,created_at,metadata,original_agent,attempt)
		 VALUES (?,?,?,?,?,?,?,?,?,?)`,
		t.ID, t.Type, StatusPending, t.Priority, t.AgentID, t.Prompt, t.CreatedAt, t.Metadata, t.OriginalAgent, t.Attempt,
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
	var origAgent sql.NullString
	var attempt sql.NullInt64
	err = tx.QueryRowContext(ctx,
		`SELECT id,type,status,priority,agent_id,prompt,created_at,metadata,original_agent,attempt
		 FROM tasks WHERE status=? ORDER BY priority DESC, created_at ASC LIMIT 1`,
		StatusPending,
	).Scan(&t.ID, &t.Type, &t.Status, &t.Priority, &t.AgentID, &t.Prompt, &t.CreatedAt, &t.Metadata, &origAgent, &attempt)
	if err != nil {
		return Task{}, err
	}
	t.OriginalAgent = origAgent.String
	if attempt.Valid {
		t.Attempt = int(attempt.Int64)
	} else {
		t.Attempt = 1
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

// GetByID fetches a task by its ID.
func (q *Queue) GetByID(ctx context.Context, id string) (Task, error) {
	var t Task
	var origAgent sql.NullString
	var attempt sql.NullInt64
	err := q.db.QueryRowContext(ctx,
		`SELECT id, type, status, priority, agent_id, prompt, created_at, metadata, original_agent, attempt
		 FROM tasks WHERE id=?`, id,
	).Scan(&t.ID, &t.Type, &t.Status, &t.Priority, &t.AgentID, &t.Prompt, &t.CreatedAt, &t.Metadata, &origAgent, &attempt)
	if err != nil {
		return Task{}, err
	}
	t.OriginalAgent = origAgent.String
	if attempt.Valid {
		t.Attempt = int(attempt.Int64)
	} else {
		t.Attempt = 1
	}
	return t, nil
}

// Cancel marks a pending task as cancelled. Returns (true, nil) if cancelled,
// (false, nil) if the task was not in pending state.
func (q *Queue) Cancel(ctx context.Context, id string) (bool, error) {
	res, err := q.db.ExecContext(ctx,
		`UPDATE tasks SET status=?, finished_at=? WHERE id=? AND status=?`,
		StatusCancelled, time.Now().UnixMilli(), id, StatusPending,
	)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// MarkReplaced marks a task as replaced by a fallback agent.
func (q *Queue) MarkReplaced(ctx context.Context, id, by string) error {
	_, err := q.db.ExecContext(ctx,
		`UPDATE tasks SET status=?, error=?, finished_at=? WHERE id=?`,
		StatusReplaced, "replaced by "+by, time.Now().UnixMilli(), id,
	)
	return err
}

func (q *Queue) Complete(id, result string) error {
	_, err := q.db.Exec(
		`UPDATE tasks SET status=?, result=?, finished_at=? WHERE id=? AND status IN ('running','pending')`,
		StatusCompleted, result, time.Now().UnixMilli(), id,
	)
	return err
}

func (q *Queue) Fail(id, errMsg string) error {
	_, err := q.db.Exec(
		`UPDATE tasks SET status=?, error=?, finished_at=? WHERE id=? AND status IN ('running','pending')`,
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
