import { useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from '../store/useStore'
import type { Task, TaskStatus } from '../store/useStore'

// --- helpers ---

function relativeTime(ms: number): string {
  if (!ms) return '—'
  const diff = Math.floor((Date.now() - ms) / 1000)
  if (diff < 5) return 'just now'
  if (diff < 60) return `${diff}s ago`
  const m = Math.floor(diff / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// --- status config ---

const STATUS_COLOR: Record<TaskStatus, string> = {
  pending: '#94a3b8',
  running: '#facc15',
  suspended: '#fb923c',
  completed: '#4ade80',
  failed: '#f87171',
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: 'pending',
  running: 'running',
  suspended: 'suspended',
  completed: 'done',
  failed: 'failed',
}

// --- sub-components ---

function PulsingDot() {
  return (
    <motion.span
      animate={{ opacity: [1, 0.2, 1] }}
      transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
      style={{
        display: 'inline-block',
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: '#facc15',
        marginRight: 5,
        verticalAlign: 'middle',
        position: 'relative',
        top: -1,
      }}
    />
  )
}

function StatusBadge({ status }: { status: TaskStatus }) {
  const color = STATUS_COLOR[status]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '1px 8px',
        borderRadius: 9999,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.04em',
        background: color + '22',
        color,
        border: `1px solid ${color}55`,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {status === 'running' && <PulsingDot />}
      {STATUS_LABEL[status]}
    </span>
  )
}

function TaskRow({ task }: { task: Task }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      onClick={() => setExpanded((v) => !v)}
      style={{
        background: '#0f172a',
        border: '1px solid #1e293b',
        borderRadius: 6,
        padding: '8px 12px',
        marginBottom: 6,
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      {/* collapsed row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          minWidth: 0,
        }}
      >
        <StatusBadge status={task.status} />

        <span
          style={{
            flex: 1,
            fontSize: 12,
            color: '#e2e8f0',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={task.prompt}
        >
          {task.prompt || <span style={{ color: '#475569' }}>(no prompt)</span>}
        </span>

        <span style={{ fontSize: 11, color: '#475569', whiteSpace: 'nowrap' }}>
          {task.agentId || 'auto'}
        </span>

        <span style={{ fontSize: 11, color: '#334155', whiteSpace: 'nowrap' }}>
          {relativeTime(task.createdAt)}
        </span>
      </div>

      {/* expanded detail */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            key="detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{ overflow: 'hidden' }}
          >
            <div
              style={{
                marginTop: 10,
                paddingTop: 10,
                borderTop: '1px solid #1e293b',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <DetailRow label="prompt" value={task.prompt} />
              {task.result && <DetailRow label="result" value={task.result} color="#4ade80" />}
              {task.error && <DetailRow label="error" value={task.error} color="#f87171" />}
              <div style={{ display: 'flex', gap: 16, marginTop: 2 }}>
                <Meta label="id" value={task.id} />
                <Meta label="type" value={task.type} />
                <Meta label="priority" value={String(task.priority)} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function DetailRow({
  label,
  value,
  color = '#cbd5e1',
}: {
  label: string
  value: string
  color?: string
}) {
  return (
    <div style={{ fontSize: 12 }}>
      <span style={{ color: '#475569', marginRight: 6 }}>{label}:</span>
      <span
        style={{
          color,
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      >
        {value}
      </span>
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ fontSize: 11, color: '#334155' }}>
      <span style={{ color: '#1e293b', marginRight: 3 }}>{label}</span>
      <span style={{ color: '#475569' }}>{value}</span>
    </span>
  )
}

// --- filter types ---

type Filter = 'all' | 'running' | 'done' | 'failed'

const FILTER_MATCH: Record<Filter, TaskStatus[]> = {
  all: ['pending', 'running', 'suspended', 'completed', 'failed'],
  running: ['running', 'pending', 'suspended'],
  done: ['completed'],
  failed: ['failed'],
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'running', label: 'Running' },
  { key: 'done', label: 'Done' },
  { key: 'failed', label: 'Failed' },
]

// --- submit form ---

const AGENTS = ['auto', 'opencode', 'agy', 'grok', 'cline', 'vibe', 'codex', 'kilo']

function SubmitBar({ connected }: { connected: boolean }) {
  const [prompt, setPrompt] = useState('')
  const [agent, setAgent] = useState('auto')
  const [priority, setPriority] = useState(5)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() || !connected) return
    setSubmitting(true)
    const payload = { prompt: prompt.trim(), agentId: agent, priority }
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setPrompt('')
    } catch (err) {
      console.log('[LiveFeed] submit task', payload, err)
    } finally {
      setSubmitting(false)
    }
  }, [prompt, agent, priority, connected])

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) handleSubmit()
  }

  const inputBase: React.CSSProperties = {
    background: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: 5,
    color: '#e2e8f0',
    fontSize: 12,
    fontFamily: "'JetBrains Mono', 'Courier New', monospace",
    outline: 'none',
    padding: '6px 10px',
  }

  return (
    <div
      style={{
        borderTop: '1px solid #1e293b',
        padding: '12px 14px',
        background: '#080f1a',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {!connected && (
        <div
          style={{
            fontSize: 11,
            color: '#fb923c',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 2,
          }}
        >
          <span>⚠</span>
          <span>Not connected — reconnect WebSocket to submit tasks</span>
        </div>
      )}

      {/* prompt row */}
      <input
        type="text"
        placeholder="Describe a task for the agents..."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={handleKey}
        disabled={!connected}
        style={{
          ...inputBase,
          width: '100%',
          boxSizing: 'border-box',
          opacity: connected ? 1 : 0.5,
        }}
      />

      {/* controls row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* agent select */}
        <select
          value={agent}
          onChange={(e) => setAgent(e.target.value)}
          disabled={!connected}
          style={{
            ...inputBase,
            cursor: 'pointer',
            appearance: 'none' as const,
            WebkitAppearance: 'none' as const,
            paddingRight: 24,
            opacity: connected ? 1 : 0.5,
          }}
        >
          {AGENTS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>

        {/* priority slider */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flex: 1,
          }}
        >
          <span style={{ fontSize: 11, color: '#475569', whiteSpace: 'nowrap' }}>
            p:{priority}
          </span>
          <input
            type="range"
            min={1}
            max={10}
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            disabled={!connected}
            style={{
              flex: 1,
              accentColor: '#6366f1',
              cursor: connected ? 'pointer' : 'not-allowed',
              opacity: connected ? 1 : 0.5,
            }}
          />
        </div>

        {/* submit */}
        <button
          onClick={handleSubmit}
          disabled={!connected || !prompt.trim() || submitting}
          style={{
            background: connected && prompt.trim() ? '#6366f1' : '#1e293b',
            color: connected && prompt.trim() ? '#fff' : '#475569',
            border: 'none',
            borderRadius: 5,
            padding: '6px 16px',
            fontSize: 12,
            fontFamily: "'JetBrains Mono', 'Courier New', monospace",
            fontWeight: 600,
            cursor: connected && prompt.trim() ? 'pointer' : 'not-allowed',
            transition: 'background 0.15s, color 0.15s',
            whiteSpace: 'nowrap',
          }}
        >
          {submitting ? '...' : 'submit'}
        </button>
      </div>
    </div>
  )
}

// --- main component ---

export default function LiveFeed() {
  const tasks = useStore((s) => s.tasks)
  const wsConnected = useStore((s) => s.wsConnected)
  const [filter, setFilter] = useState<Filter>('all')

  const visible = tasks.filter((t) => FILTER_MATCH[filter].includes(t.status))

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 500,
        background: '#0f172a',
        overflow: 'hidden',
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
        color: '#e2e8f0',
      }}
    >
      {/* header + filter bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px 8px',
          borderBottom: '1px solid #1e293b',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', letterSpacing: '0.05em' }}>
            live feed
          </span>
          <motion.span
            animate={{ opacity: wsConnected ? [1, 0.4, 1] : 1 }}
            transition={{ duration: 2, repeat: Infinity }}
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: wsConnected ? '#4ade80' : '#f87171',
              display: 'inline-block',
            }}
          />
          <span style={{ fontSize: 10, color: wsConnected ? '#4ade80' : '#f87171' }}>
            {wsConnected ? 'ws:ok' : 'ws:off'}
          </span>
        </div>

        {/* filter buttons */}
        <div style={{ display: 'flex', gap: 4 }}>
          {FILTERS.map(({ key, label }) => {
            const active = filter === key
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                style={{
                  background: active ? '#1e3a5f' : 'transparent',
                  color: active ? '#60a5fa' : '#475569',
                  border: active ? '1px solid #2563eb55' : '1px solid transparent',
                  borderRadius: 4,
                  padding: '2px 8px',
                  fontSize: 11,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  fontWeight: active ? 600 : 400,
                  transition: 'all 0.12s',
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* scrollable task list */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '10px 10px 4px',
          maxHeight: 380,
          scrollbarWidth: 'thin',
          scrollbarColor: '#1e293b #0f172a',
        }}
      >
        {visible.length === 0 ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#1e293b',
              fontSize: 12,
              letterSpacing: '0.06em',
            }}
          >
            no tasks
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {visible.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* submit bar */}
      <SubmitBar connected={wsConnected} />
    </div>
  )
}
