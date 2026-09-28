package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/01rg0/orchestrator/internal/autonomous"
)

// handleAutonomousTasks handles GET (list) and POST (create) for /api/autonomous/tasks
func (s *Server) handleAutonomousTasks(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if handleCORSPreflight(w, r, "GET, POST") {
		return
	}

	switch r.Method {
	case http.MethodGet:
		rows, err := s.db.QueryContext(r.Context(),
			`SELECT id, goal, status, current_step, total_steps, steps_json, created_at, updated_at, deadline_ms, retry_count, last_error
			 FROM autonomous_tasks ORDER BY created_at DESC LIMIT 100`)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		var tasks []map[string]any
		for rows.Next() {
			var (
				id, goal, status, stepsJSON, lastErr string
				currentStep, totalSteps, retryCount  int
				createdAt, updatedAt                 int64
				deadlineMs                           *int64
			)
			if err := rows.Scan(&id, &goal, &status, &currentStep, &totalSteps, &stepsJSON,
				&createdAt, &updatedAt, &deadlineMs, &retryCount, &lastErr); err != nil {
				continue
			}
			var steps []autonomous.Step
			json.Unmarshal([]byte(stepsJSON), &steps) //nolint
			t := map[string]any{
				"id": id, "goal": goal, "status": status,
				"current_step": currentStep, "total_steps": totalSteps,
				"steps": steps, "created_at": createdAt, "updated_at": updatedAt,
				"retry_count": retryCount, "last_error": lastErr,
			}
			if deadlineMs != nil {
				t["deadline_ms"] = *deadlineMs
			}
			tasks = append(tasks, t)
		}
		if tasks == nil {
			tasks = []map[string]any{}
		}
		json.NewEncoder(w).Encode(tasks)

	case http.MethodPost:
		var body struct {
			Goal        string             `json:"goal"`
			Steps       []autonomous.Step  `json:"steps"`
			DeadlineHrs float64            `json:"deadline_hours"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "parse body: "+err.Error(), http.StatusBadRequest)
			return
		}
		if body.Goal == "" {
			http.Error(w, "goal is required", http.StatusBadRequest)
			return
		}
		// Assign indexes
		for i := range body.Steps {
			body.Steps[i].Index = i
			if body.Steps[i].Status == "" {
				body.Steps[i].Status = "pending"
			}
		}
		var deadlineMs int64
		if body.DeadlineHrs > 0 {
			deadlineMs = time.Now().Add(time.Duration(body.DeadlineHrs * float64(time.Hour))).UnixMilli()
		}
		id, err := autonomous.CreateTask(r.Context(), s.db, body.Goal, body.Steps, deadlineMs)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		// Broadcast task created
		s.Hub.Broadcast(map[string]any{
			"type":    "autonomous_task_created",
			"task_id": id,
			"goal":    body.Goal,
			"steps":   len(body.Steps),
		})
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]string{"id": id})

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleAutonomousTaskByID handles GET /api/autonomous/tasks/{id}
func (s *Server) handleAutonomousTaskByID(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if handleCORSPreflight(w, r, "GET") {
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/autonomous/tasks/")
	id = strings.Split(id, "/")[0]

	var (
		goal, status, stepsJSON, lastErr string
		currentStep, totalSteps          int
		createdAt, updatedAt             int64
		deadlineMs                       *int64
		retryCount                       int
	)
	err := s.db.QueryRowContext(r.Context(),
		`SELECT goal, status, current_step, total_steps, steps_json, created_at, updated_at, deadline_ms, retry_count, last_error
		 FROM autonomous_tasks WHERE id = ?`, id).
		Scan(&goal, &status, &currentStep, &totalSteps, &stepsJSON, &createdAt, &updatedAt, &deadlineMs, &retryCount, &lastErr)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	var steps []autonomous.Step
	json.Unmarshal([]byte(stepsJSON), &steps) //nolint
	t := map[string]any{
		"id": id, "goal": goal, "status": status,
		"current_step": currentStep, "total_steps": totalSteps,
		"steps": steps, "created_at": createdAt, "updated_at": updatedAt,
		"retry_count": retryCount, "last_error": lastErr,
	}
	if deadlineMs != nil {
		t["deadline_ms"] = *deadlineMs
	}
	json.NewEncoder(w).Encode(t)
}

// handleAutonomousTaskPause handles POST /api/autonomous/tasks/{id}/pause
func (s *Server) handleAutonomousTaskPause(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if handleCORSPreflight(w, r, "POST") {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/autonomous/tasks/")
	id = strings.TrimSuffix(id, "/pause")
	_, err := s.db.ExecContext(r.Context(),
		`UPDATE autonomous_tasks SET status='paused', updated_at=? WHERE id=?`,
		time.Now().UnixMilli(), id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

// handleAutonomousTaskResume handles POST /api/autonomous/tasks/{id}/resume
func (s *Server) handleAutonomousTaskResume(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if handleCORSPreflight(w, r, "POST") {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/autonomous/tasks/")
	id = strings.TrimSuffix(id, "/resume")
	_, err := s.db.ExecContext(r.Context(),
		`UPDATE autonomous_tasks SET status='running', updated_at=? WHERE id=?`,
		time.Now().UnixMilli(), id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

// handleAutonomousTaskStep handles POST /api/autonomous/tasks/{id}/step — worker reports step result
func (s *Server) handleAutonomousTaskStep(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if handleCORSPreflight(w, r, "POST") {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/autonomous/tasks/")
	id = strings.TrimSuffix(id, "/step")

	var body struct {
		StepIndex int    `json:"step_index"`
		Status    string `json:"status"`
		Result    string `json:"result"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "parse body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Load task steps, update the reported step, save back
	var stepsJSON string
	err := s.db.QueryRowContext(r.Context(),
		`SELECT steps_json FROM autonomous_tasks WHERE id = ?`, id).Scan(&stepsJSON)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	var steps []autonomous.Step
	json.Unmarshal([]byte(stepsJSON), &steps) //nolint
	if body.StepIndex >= 0 && body.StepIndex < len(steps) {
		steps[body.StepIndex].Status = body.Status
		steps[body.StepIndex].Result = body.Result
		steps[body.StepIndex].CompletedAt = time.Now().UnixMilli()
	}
	updated, _ := json.Marshal(steps)
	_, err = s.db.ExecContext(r.Context(),
		`UPDATE autonomous_tasks SET steps_json=?, updated_at=? WHERE id=?`,
		string(updated), time.Now().UnixMilli(), id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}
