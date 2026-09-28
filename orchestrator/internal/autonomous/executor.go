package autonomous

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"time"

	"github.com/01rg0/orchestrator/internal/hub"
)

// Step represents one unit of work within an autonomous task.
type Step struct {
	Index          int    `json:"index"`
	Description    string `json:"description"`
	AgentID        string `json:"agentId"`
	Prompt         string `json:"prompt"`
	Status         string `json:"status"` // pending|running|completed|failed|skipped
	Result         string `json:"result"`
	Retries        int    `json:"retries"`
	MaxRetries     int    `json:"max_retries,omitempty"`     // 0 = use default (5)
	TimeoutMinutes int    `json:"timeout_minutes,omitempty"` // 0 = use default (120)
	StartedAt      int64  `json:"started_at"`
	CompletedAt    int64  `json:"completed_at"`
}

// AutonomousTask is the DB record for a long-running multi-step task.
type AutonomousTask struct {
	ID          string  `json:"id"`
	Goal        string  `json:"goal"`
	Status      string  `json:"status"`
	CurrentStep int     `json:"current_step"`
	TotalSteps  int     `json:"total_steps"`
	Steps       []Step  `json:"steps"`
	CreatedAt   int64   `json:"created_at"`
	UpdatedAt   int64   `json:"updated_at"`
	DeadlineMs  int64   `json:"deadline_ms,omitempty"`
	RetryCount  int     `json:"retry_count"`
	LastError   string  `json:"last_error,omitempty"`
}

// Executor runs autonomous tasks in the background.
type Executor struct {
	db         *sql.DB
	hub        *hub.Hub
	proxyAddr  string
}

// NewExecutor creates an Executor. proxyAddr defaults to "http://localhost:8080".
func NewExecutor(db *sql.DB, h *hub.Hub, proxyAddr string) *Executor {
	if proxyAddr == "" {
		proxyAddr = "http://localhost:8080"
	}
	return &Executor{db: db, hub: h, proxyAddr: proxyAddr}
}

// Run polls for runnable autonomous tasks every 30s and advances them.
func (e *Executor) Run(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	// Run once immediately on start to resume tasks from before a restart.
	e.tick(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			e.tick(ctx)
		}
	}
}

func (e *Executor) tick(ctx context.Context) {
	tasks, err := e.listRunning(ctx)
	if err != nil {
		log.Printf("autonomous executor: list running: %v", err)
		return
	}
	for _, t := range tasks {
		if ctx.Err() != nil {
			return
		}
		// Check deadline
		if t.DeadlineMs > 0 && time.Now().UnixMilli() > t.DeadlineMs {
			e.updateStatus(ctx, t.ID, "expired", "deadline exceeded")
			e.broadcast("autonomous_task_complete", map[string]any{
				"task_id": t.ID, "goal": t.Goal, "status": "expired", "reason": "deadline exceeded",
			})
			continue
		}
		e.advanceTask(ctx, &t)
	}
}

func (e *Executor) advanceTask(ctx context.Context, t *AutonomousTask) {
	if len(t.Steps) == 0 || t.CurrentStep >= len(t.Steps) {
		e.updateStatus(ctx, t.ID, "completed", "")
		e.broadcast("autonomous_task_complete", map[string]any{
			"task_id": t.ID, "goal": t.Goal, "status": "completed",
			"steps_completed": t.TotalSteps,
		})
		return
	}

	step := &t.Steps[t.CurrentStep]
	if step.Status == "completed" || step.Status == "skipped" {
		// Advance to next step
		t.CurrentStep++
		e.saveSteps(ctx, t)
		e.advanceTask(ctx, t)
		return
	}

	maxRetries := step.MaxRetries
	if maxRetries <= 0 {
		maxRetries = 5
	}
	if step.Status == "failed" && step.Retries >= maxRetries {
		// Skip this step
		step.Status = "skipped"
		t.CurrentStep++
		e.saveSteps(ctx, t)
		e.broadcast("autonomous_step_complete", map[string]any{
			"task_id": t.ID, "step_index": step.Index,
			"description": step.Description, "status": "skipped",
			"reason": "max retries exceeded",
		})
		e.advanceTask(ctx, t)
		return
	}

	// Mark step as running
	step.Status = "running"
	step.StartedAt = time.Now().UnixMilli()
	e.saveSteps(ctx, t)

	// Dispatch step to CLI queue
	taskID, err := e.enqueueStep(step)
	if err != nil {
		log.Printf("autonomous executor: enqueue step %d for task %s: %v", step.Index, t.ID, err)
		step.Status = "failed"
		step.Retries++
		e.saveSteps(ctx, t)
		return
	}

	// Poll for task completion — default 2h, overridable per step
	stepTimeout := time.Duration(step.TimeoutMinutes) * time.Minute
	if stepTimeout <= 0 {
		stepTimeout = 2 * time.Hour
	}
	result, runErr := e.pollTaskCompletion(ctx, taskID, stepTimeout)
	step.CompletedAt = time.Now().UnixMilli()
	if runErr != nil {
		step.Status = "failed"
		step.Retries++
		step.Result = runErr.Error()
		t.LastError = runErr.Error()
	} else {
		step.Status = "completed"
		step.Result = result
		t.CurrentStep++
	}
	e.saveSteps(ctx, t)

	statusLabel := step.Status
	e.broadcast("autonomous_step_complete", map[string]any{
		"task_id":     t.ID,
		"goal":        t.Goal,
		"step_index":  step.Index,
		"description": step.Description,
		"status":      statusLabel,
		"result":      truncate(result, 200),
		"progress":    fmt.Sprintf("%d/%d", t.CurrentStep, t.TotalSteps),
	})

	// Continue advancing
	if step.Status == "completed" {
		e.advanceTask(ctx, t)
	}
}

func (e *Executor) enqueueStep(step *Step) (string, error) {
	body, _ := json.Marshal(map[string]any{
		"agentId":  step.AgentID,
		"prompt":   step.Prompt,
		"priority": 5,
	})
	resp, err := http.Post(e.proxyAddr+"/api/tasks/enqueue", "application/json", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var res map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return "", err
	}
	id, ok := res["id"]
	if !ok {
		return "", fmt.Errorf("no id in enqueue response")
	}
	return id, nil
}

func (e *Executor) pollTaskCompletion(ctx context.Context, taskID string, timeout time.Duration) (string, error) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		var status, result, errStr sql.NullString
		row := e.db.QueryRowContext(ctx,
			`SELECT status, result, error FROM tasks WHERE id = ?`, taskID)
		if err := row.Scan(&status, &result, &errStr); err != nil {
			time.Sleep(15 * time.Second)
			continue
		}
		switch status.String {
		case "completed":
			return result.String, nil
		case "failed", "cancelled":
			return "", fmt.Errorf("task %s: %s — %s", taskID, status.String, errStr.String)
		}
		time.Sleep(15 * time.Second)
	}
	return "", fmt.Errorf("task %s timed out after %s", taskID, timeout)
}

func (e *Executor) listRunning(ctx context.Context) ([]AutonomousTask, error) {
	rows, err := e.db.QueryContext(ctx,
		`SELECT id, goal, status, current_step, total_steps, steps_json, created_at, updated_at, deadline_ms, retry_count, last_error
		 FROM autonomous_tasks WHERE status = 'running'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tasks []AutonomousTask
	for rows.Next() {
		var t AutonomousTask
		var stepsJSON, lastErr sql.NullString
		var deadline sql.NullInt64
		if err := rows.Scan(&t.ID, &t.Goal, &t.Status, &t.CurrentStep, &t.TotalSteps,
			&stepsJSON, &t.CreatedAt, &t.UpdatedAt, &deadline, &t.RetryCount, &lastErr); err != nil {
			continue
		}
		t.DeadlineMs = deadline.Int64
		t.LastError = lastErr.String
		if stepsJSON.Valid {
			json.Unmarshal([]byte(stepsJSON.String), &t.Steps) //nolint
		}
		tasks = append(tasks, t)
	}
	return tasks, nil
}

func (e *Executor) saveSteps(ctx context.Context, t *AutonomousTask) {
	b, _ := json.Marshal(t.Steps)
	now := time.Now().UnixMilli()
	e.db.ExecContext(ctx,
		`UPDATE autonomous_tasks SET steps_json=?, current_step=?, updated_at=?, last_error=? WHERE id=?`,
		string(b), t.CurrentStep, now, t.LastError, t.ID)
}

func (e *Executor) updateStatus(ctx context.Context, id, status, lastErr string) {
	e.db.ExecContext(ctx,
		`UPDATE autonomous_tasks SET status=?, last_error=?, updated_at=? WHERE id=?`,
		status, lastErr, time.Now().UnixMilli(), id)
}

func (e *Executor) broadcast(msgType string, data map[string]any) {
	data["type"] = msgType
	e.hub.Broadcast(data)
}

// CreateTask persists a new autonomous task and returns its ID.
func CreateTask(ctx context.Context, db *sql.DB, goal string, steps []Step, deadlineMs int64) (string, error) {
	id := fmt.Sprintf("auto_%d_%s", time.Now().UnixMilli(), randStr(6))
	b, _ := json.Marshal(steps)
	now := time.Now().UnixMilli()
	_, err := db.ExecContext(ctx,
		`INSERT INTO autonomous_tasks (id, goal, status, current_step, total_steps, steps_json, created_at, updated_at, deadline_ms)
		 VALUES (?, ?, 'running', 0, ?, ?, ?, ?, ?)`,
		id, goal, len(steps), string(b), now, now, deadlineMs)
	return id, err
}

func randStr(n int) string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, n)
	for i := range b {
		b[i] = chars[rand.Intn(len(chars))]
	}
	return string(b)
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}
