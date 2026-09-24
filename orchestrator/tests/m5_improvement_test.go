package tests

import (
	"testing"
	"time"

	"github.com/01rg0/orchestrator/internal/improvement"
)

func TestObserver(t *testing.T) {
	o := improvement.NewObserver(5)

	for i := 0; i < 3; i++ {
		o.Record(improvement.Observation{
			AgentID: "codex",
			TaskID:  "task",
			Result:  "ok",
		})
	}

	obs := o.Drain()
	if len(obs) != 3 {
		t.Errorf("drain: got %d want 3", len(obs))
	}

	// Buffer should be empty after drain
	obs2 := o.Drain()
	if len(obs2) != 0 {
		t.Errorf("second drain: got %d want 0", len(obs2))
	}
}

func TestObserverRingBuffer(t *testing.T) {
	o := improvement.NewObserver(3)
	for i := 0; i < 5; i++ {
		o.Record(improvement.Observation{AgentID: "test"})
	}
	obs := o.Drain()
	if len(obs) != 3 {
		t.Errorf("ring buffer: got %d want 3 (capped at bufSize)", len(obs))
	}
}

func TestReflectorBelowMinSamples(t *testing.T) {
	r := improvement.NewReflector(5)
	refs := r.Reflect([]improvement.Observation{{AgentID: "x"}})
	if refs != nil {
		t.Error("below min samples: expected nil reflections")
	}
}

func TestReflectorHighErrorRate(t *testing.T) {
	r := improvement.NewReflector(3)
	obs := []improvement.Observation{
		{AgentID: "a", Error: "timeout"},
		{AgentID: "b", Error: "500"},
		{AgentID: "c", Error: "nil response"},
		{AgentID: "d"},
	}
	refs := r.Reflect(obs)
	if len(refs) == 0 {
		t.Error("expected reflection for high error rate")
	}
}

func TestReflectorSlowAgents(t *testing.T) {
	r := improvement.NewReflector(2)
	obs := []improvement.Observation{
		{AgentID: "slow-agent", LatencyMs: 8000},
		{AgentID: "fast-agent", LatencyMs: 100},
		{AgentID: "slow-agent2", LatencyMs: 9000},
	}
	refs := r.Reflect(obs)
	if len(refs) == 0 {
		t.Error("expected reflection for slow agents")
	}
}

func TestValidatorSafe(t *testing.T) {
	v := &improvement.Validator{}
	m := &improvement.Mutation{Payload: "add retry on 503"}
	if !v.Validate(m) {
		t.Error("safe mutation should be valid")
	}
	if !m.Valid {
		t.Error("Valid field should be set to true")
	}
}

func TestValidatorDangerous(t *testing.T) {
	v := &improvement.Validator{}
	dangerous := []string{
		"DROP TABLE users",
		"rm -rf /data",
		"DELETE FROM tasks",
	}
	for _, payload := range dangerous {
		m := &improvement.Mutation{Payload: payload}
		if v.Validate(m) {
			t.Errorf("dangerous payload should be rejected: %q", payload)
		}
	}
}

func TestLoopRunOnce(t *testing.T) {
	obs := improvement.NewObserver(100)
	ref := improvement.NewReflector(3)
	loop := improvement.NewLoop(obs, ref, time.Hour)

	// Seed with enough observations to trigger reflection (4 errors / 4 total = 100%)
	for i := 0; i < 4; i++ {
		obs.Record(improvement.Observation{
			AgentID: "codex",
			Error:   "provider error",
		})
	}

	applied := loop.RunOnce()
	if len(applied) == 0 {
		t.Error("expected at least one mutation applied")
	}
	if len(loop.MutationHistory()) == 0 {
		t.Error("history should not be empty after RunOnce")
	}
}
