package improvement

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"
)

// Phase represents a step in the self-improvement loop.
type Phase string

const (
	PhaseObserve  Phase = "observe"
	PhaseReflect  Phase = "reflect"
	PhaseValidate Phase = "validate"
	PhaseApply    Phase = "apply"
)

// Observation is raw data collected from task execution.
type Observation struct {
	AgentID   string
	TaskID    string
	Prompt    string
	Result    string
	Error     string
	LatencyMs int64
	Timestamp time.Time
}

// Reflection is the analysis produced from one or more observations.
type Reflection struct {
	ID          string
	Insight     string
	Confidence  float64
	SourceIDs   []string
	GeneratedAt time.Time
}

// Mutation is a proposed system change derived from a reflection.
type Mutation struct {
	ID           string
	ReflectionID string
	Kind         string // "prompt_patch" | "config_patch" | "weight_update"
	Payload      string
	Valid        bool
	AppliedAt    time.Time
}

// Observer collects observations from task outcomes.
type Observer struct {
	mu   sync.Mutex
	buf  []Observation
	size int
}

func NewObserver(bufSize int) *Observer {
	if bufSize <= 0 {
		bufSize = 100
	}
	return &Observer{buf: make([]Observation, 0, bufSize), size: bufSize}
}

// Record adds an observation to the buffer.
func (o *Observer) Record(obs Observation) {
	if obs.Timestamp.IsZero() {
		obs.Timestamp = time.Now()
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if len(o.buf) >= o.size {
		o.buf = o.buf[1:] // drop oldest
	}
	o.buf = append(o.buf, obs)
}

// Drain returns and clears all buffered observations.
func (o *Observer) Drain() []Observation {
	o.mu.Lock()
	defer o.mu.Unlock()
	out := make([]Observation, len(o.buf))
	copy(out, o.buf)
	o.buf = o.buf[:0]
	return out
}

// Reflector produces insights from observations.
type Reflector struct {
	minSamples int
}

func NewReflector(minSamples int) *Reflector {
	if minSamples <= 0 {
		minSamples = 3
	}
	return &Reflector{minSamples: minSamples}
}

// Reflect analyses observations and produces reflections.
func (r *Reflector) Reflect(obs []Observation) []Reflection {
	if len(obs) < r.minSamples {
		return nil
	}

	var errors, total int
	var slow []string
	for _, o := range obs {
		total++
		if o.Error != "" {
			errors++
		}
		if o.LatencyMs > 5000 {
			slow = append(slow, o.AgentID)
		}
	}

	var refs []Reflection
	errorRate := float64(errors) / float64(total)
	if errorRate > 0.3 {
		refs = append(refs, Reflection{
			ID:          fmt.Sprintf("ref-%d", time.Now().UnixNano()),
			Insight:     fmt.Sprintf("error rate %.0f%% exceeds threshold; consider prompt hardening", errorRate*100),
			Confidence:  errorRate,
			GeneratedAt: time.Now(),
		})
	}
	if len(slow) > 0 {
		refs = append(refs, Reflection{
			ID:          fmt.Sprintf("ref-%d-slow", time.Now().UnixNano()),
			Insight:     fmt.Sprintf("slow agents: %s — consider timeout reduction or provider swap", strings.Join(slow, ", ")),
			Confidence:  float64(len(slow)) / float64(total),
			GeneratedAt: time.Now(),
		})
	}
	return refs
}

// Validator checks whether a mutation is safe to apply.
type Validator struct{}

func (v *Validator) Validate(m *Mutation) bool {
	if m.Payload == "" {
		return false
	}
	// Reject mutations that look like destructive ops (SQL checked case-insensitive, shell case-sensitive)
	sqlDangerous := []string{"DROP TABLE", "DELETE FROM", "TRUNCATE"}
	upper := strings.ToUpper(m.Payload)
	for _, d := range sqlDangerous {
		if strings.Contains(upper, d) {
			return false
		}
	}
	shellDangerous := []string{"rm -rf", "rm -f ", "mkfs", "dd if="}
	for _, d := range shellDangerous {
		if strings.Contains(m.Payload, d) {
			return false
		}
	}
	m.Valid = true
	return true
}

// Mutator applies validated mutations and records them.
type Mutator struct {
	mu      sync.Mutex
	applied []Mutation
}

func NewMutator() *Mutator { return &Mutator{} }

// Apply records a validated mutation as applied.
func (m *Mutator) Apply(mut Mutation) error {
	if !mut.Valid {
		return fmt.Errorf("mutation %s not validated", mut.ID)
	}
	mut.AppliedAt = time.Now()
	m.mu.Lock()
	m.applied = append(m.applied, mut)
	m.mu.Unlock()
	log.Printf("improvement: applied mutation %s (%s)", mut.ID, mut.Kind)
	return nil
}

// History returns all applied mutations.
func (m *Mutator) History() []Mutation {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Mutation, len(m.applied))
	copy(out, m.applied)
	return out
}

// Loop orchestrates the Observe→Reflect→Validate→Apply cycle.
type Loop struct {
	observer  *Observer
	reflector *Reflector
	validator *Validator
	mutator   *Mutator
	interval  time.Duration
}

// NewLoop creates a Loop with default interval of 30s.
func NewLoop(observer *Observer, reflector *Reflector, interval time.Duration) *Loop {
	if interval <= 0 {
		interval = 30 * time.Second
	}
	return &Loop{
		observer:  observer,
		reflector: reflector,
		validator: &Validator{},
		mutator:   NewMutator(),
		interval:  interval,
	}
}

// MutationHistory exposes applied mutations for inspection.
func (l *Loop) MutationHistory() []Mutation { return l.mutator.History() }

// RunOnce executes one cycle synchronously.
func (l *Loop) RunOnce() []Mutation {
	obs := l.observer.Drain()
	refs := l.reflector.Reflect(obs)

	var applied []Mutation
	for _, ref := range refs {
		mut := Mutation{
			ID:           fmt.Sprintf("mut-%d", time.Now().UnixNano()),
			ReflectionID: ref.ID,
			Kind:         "prompt_patch",
			Payload:      ref.Insight,
		}
		if l.validator.Validate(&mut) {
			if err := l.mutator.Apply(mut); err == nil {
				applied = append(applied, mut)
			}
		}
	}
	return applied
}

// Start runs the improvement loop in the background until ctx is cancelled.
func (l *Loop) Start(ctx context.Context) {
	ticker := time.NewTicker(l.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			l.RunOnce()
		}
	}
}
