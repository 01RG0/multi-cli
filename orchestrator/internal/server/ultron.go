package server

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/01rg0/orchestrator/internal/mcp"
	"github.com/01rg0/orchestrator/internal/memory"
	"github.com/01rg0/orchestrator/internal/queue"
	"github.com/01rg0/orchestrator/internal/skills"
)

// ─── Memory endpoints ────────────────────────────────────────────────────────

func (s *Server) handleMemorySearch(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.graph == nil {
		json.NewEncoder(w).Encode([]any{})
		return
	}
	q := r.URL.Query().Get("q")
	limit := 10
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 {
			limit = n
		}
	}
	results, err := s.graph.Search(r.Context(), q, limit)
	if err != nil || results == nil {
		json.NewEncoder(w).Encode([]any{})
		return
	}
	json.NewEncoder(w).Encode(results)
}

func (s *Server) handleMemoryUpsert(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if handleCORSPreflight(w, r, "POST") {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.graph == nil {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{"ok": false, "reason": "memory not enabled"})
		return
	}
	var n memory.Node
	if err := json.NewDecoder(r.Body).Decode(&n); err != nil {
		http.Error(w, "parse body: "+err.Error(), http.StatusBadRequest)
		return
	}
	id, err := s.graph.UpsertNode(r.Context(), n)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	n.ID = id
	if s.Hub != nil {
		s.Hub.Broadcast(map[string]any{
			"type":   "memory_updated",
			"action": "upsert",
			"node":   n,
		})
	}
	json.NewEncoder(w).Encode(map[string]string{"id": id})
}

func (s *Server) handleMemoryGraph(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if handleCORSPreflight(w, r, "GET") {
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.graph == nil {
		json.NewEncoder(w).Encode(map[string]any{"nodes": []any{}, "edges": []any{}})
		return
	}
	nodes, edges, err := s.graph.GetGraph(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if nodes == nil {
		nodes = []memory.Node{}
	}
	if edges == nil {
		edges = []memory.Edge{}
	}
	json.NewEncoder(w).Encode(map[string]any{
		"nodes": nodes,
		"edges": edges,
	})
}

func (s *Server) handleMemoryNodeDelete(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if handleCORSPreflight(w, r, "DELETE") {
		return
	}
	if r.Method != http.MethodDelete {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.graph == nil {
		http.Error(w, "memory not enabled", http.StatusServiceUnavailable)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing node id", http.StatusBadRequest)
		return
	}
	if err := s.graph.DeleteNode(r.Context(), id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if s.Hub != nil {
		s.Hub.Broadcast(map[string]any{
			"type":   "memory_updated",
			"action": "delete",
			"id":     id,
		})
	}
	json.NewEncoder(w).Encode(map[string]string{"deleted": id})
}

func (s *Server) handleMemoryEdgeAdd(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if handleCORSPreflight(w, r, "POST") {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.graph == nil {
		json.NewEncoder(w).Encode(map[string]any{"ok": false, "reason": "memory not enabled"})
		return
	}
	var e memory.Edge
	if err := json.NewDecoder(r.Body).Decode(&e); err != nil {
		http.Error(w, "parse body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if err := s.graph.AddEdge(r.Context(), e); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if s.Hub != nil {
		s.Hub.Broadcast(map[string]any{
			"type":   "memory_updated",
			"action": "edge_added",
			"edge":   e,
		})
	}
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func (s *Server) handleMemoryCore(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if handleCORSPreflight(w, r, "GET, POST") {
		return
	}
	if s.graph == nil {
		json.NewEncoder(w).Encode(map[string]any{"ok": false, "reason": "memory not enabled"})
		return
	}
	switch r.Method {
	case http.MethodGet:
		core, err := s.graph.ReadCore(r.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"content": core.Content, "updated_at": core.UpdatedAt})
	case http.MethodPost:
		var body struct {
			Content string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "parse body: "+err.Error(), http.StatusBadRequest)
			return
		}
		if err := s.graph.WriteCore(r.Context(), body.Content); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleMemoryEpisodes(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if handleCORSPreflight(w, r, "GET, POST") {
		return
	}
	if r.Method == http.MethodPost {
		if s.graph == nil {
			http.Error(w, "memory not enabled", http.StatusServiceUnavailable)
			return
		}
		var ep memory.Episode
		if err := json.NewDecoder(r.Body).Decode(&ep); err != nil {
			http.Error(w, "parse body: "+err.Error(), http.StatusBadRequest)
			return
		}
		id, err := s.graph.AppendEpisode(r.Context(), ep)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		ep.ID = id
		if s.Hub != nil {
			s.Hub.Broadcast(map[string]any{
				"type":    "memory_updated",
				"action":  "upsert",
				"episode": ep,
			})
		}
		json.NewEncoder(w).Encode(map[string]string{"id": id})
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	limit := 20
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 {
			if n > 100 {
				n = 100
			}
			limit = n
		}
	}
	rows, err := s.db.QueryContext(r.Context(),
		`SELECT id, agent_id, kind, content, created_at FROM episodes ORDER BY created_at DESC LIMIT ?`, limit)
	if err != nil {
		json.NewEncoder(w).Encode([]any{})
		return
	}
	defer rows.Close()
	type epRow struct {
		ID        string `json:"id"`
		AgentID   string `json:"agent_id"`
		Kind      string `json:"kind"`
		Content   string `json:"content"`
		CreatedAt int64  `json:"created_at"`
	}
	var eps []epRow
	for rows.Next() {
		var e epRow
		if err := rows.Scan(&e.ID, &e.AgentID, &e.Kind, &e.Content, &e.CreatedAt); err != nil {
			continue
		}
		eps = append(eps, e)
	}
	if eps == nil {
		eps = []epRow{}
	}
	json.NewEncoder(w).Encode(eps)
}

// ─── Task control ────────────────────────────────────────────────────────────

func (s *Server) handleTaskCancel(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if handleCORSPreflight(w, r, "POST") {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.q == nil {
		json.NewEncoder(w).Encode(map[string]any{"ok": false, "reason": "queue not enabled"})
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing task id", http.StatusBadRequest)
		return
	}
	ok, err := s.q.Cancel(r.Context(), id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if !ok {
		json.NewEncoder(w).Encode(map[string]any{"ok": false, "reason": "task already running, cannot cancel"})
		return
	}
	s.Hub.Broadcast(map[string]any{
		"type": "task_update",
		"id":   id,
		"status": "cancelled",
	})
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func (s *Server) handleTaskRetry(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if handleCORSPreflight(w, r, "POST") {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.q == nil {
		json.NewEncoder(w).Encode(map[string]any{"ok": false, "reason": "queue not enabled"})
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing task id", http.StatusBadRequest)
		return
	}
	orig, err := s.q.GetByID(r.Context(), id)
	if err == sql.ErrNoRows {
		http.Error(w, "task not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	newTask := queue.Task{
		Type:     orig.Type,
		AgentID:  orig.AgentID,
		Prompt:   orig.Prompt,
		Priority: orig.Priority,
		Metadata: orig.Metadata,
	}
	newTaskID, err := s.q.Enqueue(r.Context(), newTask)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	newTask.ID = newTaskID
	s.Hub.Broadcast(map[string]any{
		"type":    "task_created",
		"id":      newTask.ID,
		"agentId": newTask.AgentID,
		"prompt":  newTask.Prompt,
	})
	json.NewEncoder(w).Encode(map[string]any{"ok": true, "new_task_id": newTask.ID})
}

// ─── Agent status ────────────────────────────────────────────────────────────

var knownAgents = []string{
	"opencode", "codex", "vibe", "agy", "grok", "cline", "kilo", "kilocode",
	"cursor", "researcher", "debugger", "jules",
	"hermes", "deepseek", "harness", "kimocode", "pi",
}

func (s *Server) handleAgentStatus(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Count running tasks per agent
	running := make(map[string]int)
	if s.db != nil {
		rows, err := s.db.QueryContext(r.Context(),
			`SELECT agent_id, COUNT(*) FROM tasks WHERE status='running' GROUP BY agent_id`)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var agentID string
				var count int
				if rows.Scan(&agentID, &count) == nil {
					running[agentID] = count
				}
			}
		}
	}

	type agentStatus struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	agents := make([]agentStatus, 0, len(knownAgents))
	for _, name := range knownAgents {
		status := "idle"
		if running[name] > 0 {
			status = "running"
		}
		agents = append(agents, agentStatus{ID: name, Status: status})
	}
	json.NewEncoder(w).Encode(map[string]any{"agents": agents})
}

func (s *Server) handleAgentFallbacks(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// Return per-agent provider chains as the fallback map
	if s.cfg.AgentProviders != nil {
		json.NewEncoder(w).Encode(s.cfg.AgentProviders)
		return
	}
	json.NewEncoder(w).Encode(map[string]any{})
}

func (s *Server) handleAgentProviderChains(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.cfg.AgentProviders == nil {
		json.NewEncoder(w).Encode(map[string]any{})
		return
	}
	json.NewEncoder(w).Encode(s.cfg.AgentProviders)
}

// ─── Cron scheduling ─────────────────────────────────────────────────────────

func cronUniqueID() string {
	return fmt.Sprintf("cron-%d", time.Now().UnixNano())
}

func (s *Server) handleCronSchedule(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if handleCORSPreflight(w, r, "POST") {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Cron    string `json:"cron"`
		AgentID string `json:"agent_id"`
		Prompt  string `json:"prompt"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "parse body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if body.Cron == "" || body.AgentID == "" || body.Prompt == "" {
		http.Error(w, "cron, agent_id, and prompt are required", http.StatusBadRequest)
		return
	}
	id := cronUniqueID()
	_, err := s.db.ExecContext(r.Context(),
		`INSERT INTO cron_jobs (id, cron, agent_id, prompt, created_at, last_run, enabled) VALUES (?,?,?,?,?,0,1)`,
		id, body.Cron, body.AgentID, body.Prompt, time.Now().UnixMilli(),
	)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]string{"id": id})
}

func (s *Server) handleCronJobs(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	rows, err := s.db.QueryContext(r.Context(),
		`SELECT id, cron, agent_id, prompt, created_at, last_run, enabled FROM cron_jobs ORDER BY created_at DESC`)
	if err != nil {
		json.NewEncoder(w).Encode([]any{})
		return
	}
	defer rows.Close()
	type cronJob struct {
		ID        string `json:"id"`
		Cron      string `json:"cron"`
		AgentID   string `json:"agent_id"`
		Prompt    string `json:"prompt"`
		CreatedAt int64  `json:"created_at"`
		LastRun   int64  `json:"last_run"`
		Enabled   int    `json:"enabled"`
	}
	var jobs []cronJob
	for rows.Next() {
		var j cronJob
		if err := rows.Scan(&j.ID, &j.Cron, &j.AgentID, &j.Prompt, &j.CreatedAt, &j.LastRun, &j.Enabled); err != nil {
			continue
		}
		jobs = append(jobs, j)
	}
	if jobs == nil {
		jobs = []cronJob{}
	}
	json.NewEncoder(w).Encode(jobs)
}

func (s *Server) handleCronJobByID(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if handleCORSPreflight(w, r, "DELETE") {
		return
	}
	if r.Method != http.MethodDelete {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing id", http.StatusBadRequest)
		return
	}
	_, err := s.db.ExecContext(r.Context(), `DELETE FROM cron_jobs WHERE id=?`, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

// ─── Routing rules ───────────────────────────────────────────────────────────

func routingUniqueID() string {
	return fmt.Sprintf("rule-%d", time.Now().UnixNano())
}

func (s *Server) handleRoutingRules(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if handleCORSPreflight(w, r, "GET, POST") {
		return
	}
	switch r.Method {
	case http.MethodGet:
		rows, err := s.db.QueryContext(r.Context(),
			`SELECT id, name, condition, target_provider, priority, created_at FROM routing_rules ORDER BY priority DESC, created_at DESC`)
		if err != nil {
			json.NewEncoder(w).Encode([]any{})
			return
		}
		defer rows.Close()
		type rule struct {
			ID             string `json:"id"`
			Name           string `json:"name"`
			Condition      string `json:"condition"`
			TargetProvider string `json:"target_provider"`
			Priority       int    `json:"priority"`
			CreatedAt      int64  `json:"created_at"`
		}
		var rules []rule
		for rows.Next() {
			var rr rule
			if err := rows.Scan(&rr.ID, &rr.Name, &rr.Condition, &rr.TargetProvider, &rr.Priority, &rr.CreatedAt); err != nil {
				continue
			}
			rules = append(rules, rr)
		}
		if rules == nil {
			rules = []rule{}
		}
		json.NewEncoder(w).Encode(rules)

	case http.MethodPost:
		var body struct {
			Name           string `json:"name"`
			Condition      string `json:"condition"`
			TargetProvider string `json:"target_provider"`
			Priority       int    `json:"priority"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "parse body: "+err.Error(), http.StatusBadRequest)
			return
		}
		id := routingUniqueID()
		_, err := s.db.ExecContext(r.Context(),
			`INSERT INTO routing_rules (id, name, condition, target_provider, priority, created_at) VALUES (?,?,?,?,?,?)`,
			id, body.Name, body.Condition, body.TargetProvider, body.Priority, time.Now().UnixMilli(),
		)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]string{"id": id})

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleRoutingRuleByID(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if handleCORSPreflight(w, r, "DELETE") {
		return
	}
	if r.Method != http.MethodDelete {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing id", http.StatusBadRequest)
		return
	}
	_, err := s.db.ExecContext(r.Context(), `DELETE FROM routing_rules WHERE id=?`, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

// ─── Feedback ────────────────────────────────────────────────────────────────

func (s *Server) handleFeedback(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if handleCORSPreflight(w, r, "POST") {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		TaskID  string `json:"task_id"`
		Outcome string `json:"outcome"`
		Notes   string `json:"notes"`
		AgentID string `json:"agent_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "parse body: "+err.Error(), http.StatusBadRequest)
		return
	}

	if s.graph != nil {
		content, _ := json.Marshal(body)
		go func() {
			ctx := r.Context()
			ep := memory.Episode{
				AgentID: body.AgentID,
				Kind:    "feedback",
				Content: string(content),
			}
			s.graph.AppendEpisode(ctx, ep)
			memNode := memory.Node{
				Type:       "feedback",
				Label:      "feedback:" + body.TaskID,
				Source:     "user",
				Confidence: 1.0,
			}
			nid, _ := s.graph.UpsertNode(ctx, memNode)
			memNode.ID = nid
			if s.Hub != nil {
				s.Hub.Broadcast(map[string]any{
					"type":   "memory_updated",
					"action": "upsert",
					"node":   memNode,
				})
			}
		}()
	}

	s.Hub.Broadcast(map[string]any{
		"type":    "feedback_recorded",
		"task_id": body.TaskID,
	})
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

// ─── Cron runner helpers ──────────────────────────────────────────────────────

// MatchCron returns true if t matches the 5-field cron expression
// (minute hour day-of-month month day-of-week).
func MatchCron(expr string, t time.Time) bool {
	fields := strings.Fields(expr)
	if len(fields) != 5 {
		return false
	}
	return matchField(fields[0], t.Minute(), 0, 59) &&
		matchField(fields[1], t.Hour(), 0, 23) &&
		matchField(fields[2], t.Day(), 1, 31) &&
		matchField(fields[3], int(t.Month()), 1, 12) &&
		matchField(fields[4], int(t.Weekday()), 0, 6)
}

func matchField(field string, value, min, _ int) bool {
	if field == "*" {
		return true
	}
	// Handle */n step
	if strings.HasPrefix(field, "*/") {
		n, err := strconv.Atoi(field[2:])
		if err != nil || n <= 0 {
			return false
		}
		return (value-min)%n == 0
	}
	// Comma-separated list of values / ranges
	for _, part := range strings.Split(field, ",") {
		if strings.Contains(part, "-") {
			rng := strings.SplitN(part, "-", 2)
			lo, e1 := strconv.Atoi(rng[0])
			hi, e2 := strconv.Atoi(rng[1])
			if e1 == nil && e2 == nil && value >= lo && value <= hi {
				return true
			}
		} else {
			n, err := strconv.Atoi(part)
			if err == nil && n == value {
				return true
			}
		}
	}
	return false
}

// ─── Skills endpoints ─────────────────────────────────────────────────────────

func (s *Server) handleSkills(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if handleCORSPreflight(w, r, "GET, POST") {
		return
	}
	switch r.Method {
	case http.MethodGet:
		list, err := skills.ListSkills(r.Context(), s.db)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(list)

	case http.MethodPost:
		var sk skills.Skill
		if err := json.NewDecoder(r.Body).Decode(&sk); err != nil {
			http.Error(w, "parse body: "+err.Error(), http.StatusBadRequest)
			return
		}
		if sk.Name == "" || sk.PromptTemplate == "" {
			http.Error(w, "name and prompt_template are required", http.StatusBadRequest)
			return
		}
		id, err := skills.UpsertSkill(r.Context(), s.db, sk)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]string{"id": id})

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleSkillByID(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if handleCORSPreflight(w, r, "GET, DELETE") {
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing id", http.StatusBadRequest)
		return
	}
	switch r.Method {
	case http.MethodGet:
		sk, err := skills.GetSkill(r.Context(), s.db, id)
		if err == sql.ErrNoRows {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(sk)

	case http.MethodDelete:
		if err := skills.DeleteSkill(r.Context(), s.db, id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]bool{"ok": true})

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleSkillRun(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if handleCORSPreflight(w, r, "POST") {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.q == nil {
		http.Error(w, "queue not enabled", http.StatusServiceUnavailable)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing id", http.StatusBadRequest)
		return
	}
	sk, err := skills.GetSkill(r.Context(), s.db, id)
	if err == sql.ErrNoRows {
		http.Error(w, "skill not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	var body struct {
		Input   string `json:"input"`
		Context string `json:"context"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		// tolerate empty body
		body.Input = ""
	}

	prompt := skills.RenderSkill(sk, body.Input, body.Context)
	task := queue.Task{
		Type:    "prompt",
		AgentID: sk.AgentID,
		Prompt:  prompt,
	}
	task.CreatedAt = time.Now().UnixMilli()
	taskID, err := s.q.Enqueue(r.Context(), task)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	task.ID = taskID
	s.Hub.Broadcast(map[string]any{
		"type": "task_created",
		"task": map[string]any{
			"id":      task.ID,
			"prompt":  prompt,
			"status":  string(queue.StatusPending),
			"agentId": task.AgentID,
		},
	})
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"task_id": task.ID})
}

// ─── MCP endpoints ────────────────────────────────────────────────────────────

func (s *Server) handleMCPServers(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	type serverInfo struct {
		Name      string     `json:"name"`
		Status    string     `json:"status"`
		ToolCount int        `json:"tool_count"`
		Tools     []mcp.Tool `json:"tools"`
	}
	var list []serverInfo
	if s.mcpManager != nil {
		for _, name := range s.mcpManager.ServerNames() {
			c, _ := s.mcpManager.GetClient(name)
			count := 0
			var tools []mcp.Tool
			if c != nil {
				tools = c.CachedTools()
				count = len(tools)
			}
			if tools == nil {
				tools = []mcp.Tool{}
			}
			list = append(list, serverInfo{Name: name, Status: "running", ToolCount: count, Tools: tools})
		}
	}
	if list == nil {
		list = []serverInfo{}
	}
	json.NewEncoder(w).Encode(list)
}

func (s *Server) handleMCPServerTools(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	name := r.PathValue("name")
	if name == "" {
		http.Error(w, "missing server name", http.StatusBadRequest)
		return
	}
	if s.mcpManager == nil {
		json.NewEncoder(w).Encode([]any{})
		return
	}
	c, ok := s.mcpManager.GetClient(name)
	if !ok {
		http.Error(w, "server not found", http.StatusNotFound)
		return
	}
	tools := c.CachedTools()
	if tools == nil {
		tools = []mcp.Tool{}
	}
	json.NewEncoder(w).Encode(tools)
}

func (s *Server) handleMCPCall(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if handleCORSPreflight(w, r, "POST") {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.mcpManager == nil {
		http.Error(w, "MCP not configured", http.StatusServiceUnavailable)
		return
	}
	var body struct {
		Server string                 `json:"server"`
		Tool   string                 `json:"tool"`
		Input  map[string]interface{} `json:"input"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "parse body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if body.Server == "" || body.Tool == "" {
		http.Error(w, "server and tool are required", http.StatusBadRequest)
		return
	}
	result, err := s.mcpManager.CallTool(r.Context(), body.Server, body.Tool, body.Input)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]string{"result": result})
}

// ─── Provider health endpoint ─────────────────────────────────────────────────

func (s *Server) handleProviderHealth(w http.ResponseWriter, r *http.Request) {
	corsJSON(w)
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	type ProviderInfo struct {
		Name    string `json:"name"`
		BaseURL string `json:"base_url"`
		Status  string `json:"status"`
	}
	providers := make([]ProviderInfo, 0, len(s.cfg.Providers))
	for _, p := range s.cfg.Providers {
		providers = append(providers, ProviderInfo{
			Name:    p.Name,
			BaseURL: p.BaseURL,
			Status:  "active",
		})
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"providers": providers})
}
