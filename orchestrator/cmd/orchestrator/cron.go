package main

import (
	"context"
	"database/sql"
	"log"
	"time"

	"github.com/01rg0/orchestrator/internal/queue"
	"github.com/01rg0/orchestrator/internal/server"
)

type cronJobRow struct {
	ID      string
	Cron    string
	AgentID string
	Prompt  string
	LastRun int64
}

// runCronRunner ticks every 60 seconds, checks cron_jobs WHERE enabled=1,
// parses each cron expression, and enqueues matching jobs.
// Stops when ctx is cancelled.
func runCronRunner(ctx context.Context, database *sql.DB, q *queue.Queue, srv *server.Server) {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case tick := <-ticker.C:
			fireCronJobs(ctx, database, q, srv, tick)
		}
	}
}

func fireCronJobs(ctx context.Context, database *sql.DB, q *queue.Queue, srv *server.Server, now time.Time) {
	rows, err := database.QueryContext(ctx,
		`SELECT id, cron, agent_id, prompt, last_run FROM cron_jobs WHERE enabled=1`)
	if err != nil {
		log.Printf("cron: query jobs: %v", err)
		return
	}
	defer rows.Close()

	var jobs []cronJobRow
	for rows.Next() {
		var j cronJobRow
		if err := rows.Scan(&j.ID, &j.Cron, &j.AgentID, &j.Prompt, &j.LastRun); err != nil {
			continue
		}
		jobs = append(jobs, j)
	}
	rows.Close()

	for _, j := range jobs {
		if !server.MatchCron(j.Cron, now) {
			continue
		}
		t := queue.Task{
			Type:    j.AgentID,
			AgentID: j.AgentID,
			Prompt:  j.Prompt,
		}
		if err := q.Enqueue(ctx, t); err != nil {
			log.Printf("cron: enqueue job %s: %v", j.ID, err)
			continue
		}
		database.ExecContext(ctx,
			`UPDATE cron_jobs SET last_run=? WHERE id=?`,
			now.UnixMilli(), j.ID,
		)
		srv.Hub.Broadcast(map[string]any{
			"type":    "task_created",
			"task_id": t.ID,
			"source":  "cron",
			"cron_id": j.ID,
		})
		log.Printf("cron: fired job %s (agent=%s)", j.ID, j.AgentID)
	}
}
