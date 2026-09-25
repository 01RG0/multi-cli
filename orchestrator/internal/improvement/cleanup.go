package improvement

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"time"

	"github.com/01rg0/orchestrator/internal/memory"
)

// EpisodeCleanup trims old episodes on a schedule.
//
// maxRows: keep only the most recent N episodes (0 = no row limit).
// maxAgeDays: delete episodes older than N days (0 = no age limit).
// At least one limit must be non-zero.
//
// Each tick the function:
//  1. If count > maxRows: selects the (count-maxRows) oldest rows, creates a rollup
//     node in the graph, then deletes them. (No LLM call — rollup is a compact summary.)
//  2. If maxAgeDays > 0: deletes episodes older than maxAgeDays*86400 seconds.
//     Age-based deletes are silent (no rollup node).
//  3. Never deletes from nodes or edges tables.
//
// Wiring: main.go should call:
//
//	go improvement.EpisodeCleanup(ctx, db, graph, interval, maxRows, maxAgeDays)
//
// The improvement.Loop.Start() method already occupies its own goroutine;
// this function is intentionally separate so it can be started independently
// (or not at all when both limits are zero).
func EpisodeCleanup(ctx context.Context, db *sql.DB, graph *memory.Graph, interval time.Duration, maxRows, maxAgeDays int) {
	if maxRows == 0 && maxAgeDays == 0 {
		log.Println("improvement: EpisodeCleanup: both maxRows and maxAgeDays are 0 — nothing to do")
		return
	}
	if interval <= 0 {
		interval = time.Hour
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			runCleanupTick(ctx, db, graph, maxRows, maxAgeDays)
		}
	}
}

func runCleanupTick(ctx context.Context, db *sql.DB, graph *memory.Graph, maxRows, maxAgeDays int) {
	// --- 1. Row-count limit ---
	if maxRows > 0 {
		var total int
		if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM episodes`).Scan(&total); err != nil {
			log.Printf("improvement: cleanup count: %v", err)
		} else if total > maxRows {
			excess := total - maxRows
			rows, err := db.QueryContext(ctx,
				`SELECT id, created_at FROM episodes ORDER BY created_at ASC LIMIT ?`, excess)
			if err != nil {
				log.Printf("improvement: cleanup select oldest: %v", err)
			} else {
				var ids []string
				var oldestTS, newestTS int64
				first := true
				for rows.Next() {
					var id string
					var createdAt int64
					if err := rows.Scan(&id, &createdAt); err != nil {
						continue
					}
					ids = append(ids, id)
					if first {
						oldestTS = createdAt
						first = false
					}
					newestTS = createdAt
				}
				rows.Close()
				if err := rows.Err(); err != nil {
					log.Printf("improvement: cleanup scan: %v", err)
				}

				if len(ids) > 0 {
					// Rollup node summarises the deleted episodes
					summary := fmt.Sprintf("Rolled up %d episodes from %s to %s",
						len(ids),
						time.UnixMilli(oldestTS).UTC().Format(time.RFC3339),
						time.UnixMilli(newestTS).UTC().Format(time.RFC3339),
					)
					if _, err := graph.UpsertNode(ctx, memory.Node{
						Label:      summary,
						Type:       "episode_rollup",
						Source:     "agent_derived",
						Confidence: 1.0,
					}); err != nil {
						log.Printf("improvement: cleanup upsert rollup node: %v", err)
					}

					// Delete the episodes
					for i := 0; i < len(ids); i += 100 {
						end := i + 100
						if end > len(ids) {
							end = len(ids)
						}
						chunk := ids[i:end]
						placeholders := make([]string, len(chunk))
						args := make([]any, len(chunk))
						for j, id := range chunk {
							placeholders[j] = "?"
							args[j] = id
						}
						q := "DELETE FROM episodes WHERE id IN (" + joinStrings(placeholders, ",") + ")"
						if _, err := db.ExecContext(ctx, q, args...); err != nil {
							log.Printf("improvement: cleanup delete episodes: %v", err)
						}
					}
					log.Printf("improvement: cleanup: rolled up and deleted %d episodes", len(ids))
				}
			}
		}
	}

	// --- 2. Age-based limit ---
	if maxAgeDays > 0 {
		cutoff := time.Now().UnixMilli() - int64(maxAgeDays)*86400*1000
		res, err := db.ExecContext(ctx, `DELETE FROM episodes WHERE created_at < ?`, cutoff)
		if err != nil {
			log.Printf("improvement: cleanup age-delete: %v", err)
		} else if n, _ := res.RowsAffected(); n > 0 {
			log.Printf("improvement: cleanup: age-deleted %d episodes older than %d days", n, maxAgeDays)
		}
	}
}

func joinStrings(ss []string, sep string) string {
	result := ""
	for i, s := range ss {
		if i > 0 {
			result += sep
		}
		result += s
	}
	return result
}
