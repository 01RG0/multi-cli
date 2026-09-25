package logbuf

import "sync"

// LogEntry is a single line of CLI output captured during task execution.
type LogEntry struct {
	AgentID string `json:"agent_id"`
	TaskID  string `json:"task_id"`
	Stream  string `json:"stream"` // "stdout" or "stderr"
	Line    string `json:"line"`
	TS      int64  `json:"ts"` // Unix milliseconds
}

// LogBuffer is a fixed-capacity ring buffer of log entries with per-task lookup.
// It is safe for concurrent use.
type LogBuffer struct {
	mu      sync.RWMutex
	entries []LogEntry
	head    int // index of the oldest entry in the ring
	count   int // number of valid entries currently stored
	cap     int // maximum number of entries
}

// New returns a LogBuffer that holds at most maxSize entries.
func New(maxSize int) *LogBuffer {
	if maxSize <= 0 {
		maxSize = 1000
	}
	return &LogBuffer{
		entries: make([]LogEntry, maxSize),
		cap:     maxSize,
	}
}

// Append adds an entry to the buffer, evicting the oldest entry when full.
func (b *LogBuffer) Append(entry LogEntry) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.count == b.cap {
		// Overwrite oldest slot and advance head
		idx := b.head
		b.entries[idx] = entry
		b.head = (b.head + 1) % b.cap
	} else {
		idx := (b.head + b.count) % b.cap
		b.entries[idx] = entry
		b.count++
	}
}

// Get returns the most recent `limit` entries for the given taskID.
// If limit <= 0 all matching entries are returned.
// The caller receives a fresh slice; mutations do not affect the buffer.
func (b *LogBuffer) Get(taskID string, limit int) []LogEntry {
	b.mu.RLock()
	defer b.mu.RUnlock()

	// Collect all matching entries in oldest->newest order.
	var matched []LogEntry
	for i := 0; i < b.count; i++ {
		idx := (b.head + i) % b.cap
		if b.entries[idx].TaskID == taskID {
			matched = append(matched, b.entries[idx])
		}
	}

	if limit > 0 && len(matched) > limit {
		matched = matched[len(matched)-limit:]
	}
	return matched
}

// All returns up to `limit` most recent entries across all tasks.
// If limit <= 0 all entries are returned.
func (b *LogBuffer) All(limit int) []LogEntry {
	b.mu.RLock()
	defer b.mu.RUnlock()

	result := make([]LogEntry, b.count)
	for i := 0; i < b.count; i++ {
		result[i] = b.entries[(b.head+i)%b.cap]
	}

	if limit > 0 && len(result) > limit {
		result = result[len(result)-limit:]
	}
	return result
}
