import { useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from '../store/useStore'
import type { Task, TaskStatus } from '../store/useStore'

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

const STATUS_COLOR: Record<TaskStatus, string> = {
  pending:   '#64748b',
  running:   '#facc15',
  suspended: '#fb923c',
  completed: '#4ade80',
  failed:    '#f87171',
}

const STATUS_ICON: Record<TaskStatus, string> = {
  pending:   '○',
  running:   '▶',
  suspended: '⏸',
  completed: '✓',
  failed:    '✗',
}

type Filter = 'all' | 'running' | 'done' | 'failed'
const FILTER_MATCH: Record<Filter, TaskStatus[]> = {
  all:     ['pending', 'running', 'suspended', 'completed', 'failed'],
  running: ['running', 'pending', 'suspended'],
  done:    ['completed'],
  failed:  ['failed'],
}
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all',     label: 'all' },
  { key: 'running', label: 'active' },
  { key: 'done',    label: 'done' },
  { key: 'failed',  label: 'failed' },
]

const AGENTS = ['auto', 'opencode', 'agy', 'grok', 'cline', 'vibe', 'codex', 'kilo']

const mono: React.CSSProperties = {
  fontFamily: "'JetBrains Mono','Fira Code','Courier New',monospace",
}

function TaskRow({ task }: { task: Task }) {
  const [expanded, setExpanded] = useState(false)
  const color = STATUS_COLOR[task.status]
  const icon = STATUS_ICON[task.status]

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      onClick={() => setExpanded(v => !v)}
      style={{
        borderLeft: `2px solid ${color}55`,
        padding: '7px 12px',
        marginBottom: 3,
        cursor: 'pointer',
        borderRadius: '0 6px 6px 0',
        background: expanded ? 'rgba(255,255,255,0.03)' : 'transparent',
        transition: 'background 0.12s',
      }}
    >
      {/* collapsed row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span style={{ ...mono, fontSize: 12, color, flexShrink: 0, fontWeight: 700 }}>
          {task.status === 'running' ? (
            <motion.span
              animate={{ opacity: [1, 0.2, 1] }}
              transition={{ duration: 0.9, repeat: Infinity }}
              style={{ display: 'inline-block' }}
            >{icon}</motion.span>
          ) : icon}
        </span>

        <span style={{
          ...mono, flex: 1, fontSize: 12, color: '#cbd5e1',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={task.prompt}>
          {task.prompt || <span style={{ color: '#334155' }}>(no prompt)</span>}
        </span>

        <span style={{ ...mono, fontSize: 10, color: '#475569', flexShrink: 0 }}>
          {task.agentId || 'auto'}
        </span>

        <span style={{ ...mono, fontSize: 10, color: '#334155', flexShrink: 0 }}>
          {relativeTime(task.createdAt)}
        </span>

        <span style={{
          ...mono, fontSize: 9, fontWeight: 700, color,
          background: color + '15', border: `1px solid ${color}30`,
          borderRadius: 4, padding: '1px 6px', flexShrink: 0,
        }}>
          {task.status}
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
            transition={{ duration: 0.16 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{
              marginTop: 10, paddingTop: 10,
              borderTop: '1px solid rgba(255,255,255,0.05)',
              display: 'flex', flexDirection: 'column', gap: 5,
            }}>
              {task.result && (
                <div style={{ ...mono, fontSize: 11 }}>
                  <span style={{ color: '#4ade80' }}>result</span>
                  <span style={{ color: '#334155', margin: '0 6px' }}>›</span>
                  <span style={{ color: '#94a3b8', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{task.result}</span>
                </div>
              )}
              {task.error && (
                <div style={{ ...mono, fontSize: 11 }}>
                  <span style={{ color: '#f87171' }}>error</span>
                  <span style={{ color: '#334155', margin: '0 6px' }}>›</span>
                  <span style={{ color: '#f87171', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{task.error}</span>
                </div>
              )}
              <div style={{ display: 'flex', gap: 16, marginTop: 2 }}>
                {[
                  ['id', task.id],
                  ['type', task.type],
                  ['priority', String(task.priority)],
                ].map(([k, v]) => (
                  <span key={k} style={{ ...mono, fontSize: 10 }}>
                    <span style={{ color: '#334155' }}>{k} </span>
                    <span style={{ color: '#475569' }}>{v}</span>
                  </span>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

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
      console.error('[LiveFeed] submit failed', err)
    } finally {
      setSubmitting(false)
    }
  }, [prompt, agent, priority, connected])

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) handleSubmit()
  }

  const inputBase: React.CSSProperties = {
    ...mono,
    background: 'rgba(2,8,23,0.6)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 6,
    color: '#e2e8f0',
    fontSize: 12,
    outline: 'none',
    padding: '7px 11px',
    transition: 'border-color 0.12s',
  }

  return (
    <div style={{
      borderTop: '1px solid rgba(255,255,255,0.06)',
      padding: '12px 16px',
      background: 'rgba(2,8,23,0.4)',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      {!connected && (
        <div style={{ ...mono, fontSize: 10, color: '#fb923c', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>⚠</span>
          <span>WebSocket offline — reconnecting...</span>
        </div>
      )}

      {/* prompt input with prefix */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...mono, fontSize: 13, color: '#6366f1', flexShrink: 0, userSelect: 'none' }}>›</span>
        <input
          type="text"
          placeholder="Describe a task for the agents..."
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={handleKey}
          disabled={!connected}
          style={{ ...inputBase, flex: 1, opacity: connected ? 1 : 0.5 }}
        />
      </div>

      {/* controls row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 21 }}>
        <select
          value={agent}
          onChange={e => setAgent(e.target.value)}
          disabled={!connected}
          style={{ ...inputBase, cursor: 'pointer', paddingRight: 20, opacity: connected ? 1 : 0.5 }}
        >
          {AGENTS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
          <span style={{ ...mono, fontSize: 10, color: '#475569', whiteSpace: 'nowrap' }}>p:{priority}</span>
          <input
            type="range" min={1} max={10} value={priority}
            onChange={e => setPriority(Number(e.target.value))}
            disabled={!connected}
            style={{ flex: 1, accentColor: '#6366f1', cursor: connected ? 'pointer' : 'not-allowed', opacity: connected ? 1 : 0.5 }}
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={!connected || !prompt.trim() || submitting}
          style={{
            ...mono,
            background: connected && prompt.trim() ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.03)',
            color: connected && prompt.trim() ? '#a5b4fc' : '#334155',
            border: `1px solid ${connected && prompt.trim() ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.06)'}`,
            borderRadius: 6, padding: '6px 16px', fontSize: 12, fontWeight: 700,
            cursor: connected && prompt.trim() ? 'pointer' : 'not-allowed',
            transition: 'all 0.12s', whiteSpace: 'nowrap',
          }}
        >
          {submitting ? '...' : 'run ↵'}
        </button>
      </div>
    </div>
  )
}

export default function LiveFeed() {
  const tasks = useStore(s => s.tasks)
  const wsConnected = useStore(s => s.wsConnected)
  const [filter, setFilter] = useState<Filter>('all')

  const visible = tasks.filter(t => FILTER_MATCH[filter].includes(t.status))
  const runningCount = tasks.filter(t => t.status === 'running').length

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: 500,
      background: 'transparent', overflow: 'hidden',
    }}>
      {/* header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px 9px',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#6366f1', boxShadow: '0 0 8px #6366f1' }} />
          <span style={{ ...mono, fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', color: '#6366f1', textTransform: 'uppercase' as const }}>
            Task Stream
          </span>
          {runningCount > 0 && (
            <motion.span
              animate={{ opacity: [1, 0.4, 1] }}
              transition={{ duration: 1.2, repeat: Infinity }}
              style={{ ...mono, fontSize: 10, color: '#facc15', background: 'rgba(250,204,21,0.1)', border: '1px solid rgba(250,204,21,0.25)', borderRadius: 9999, padding: '1px 8px' }}
            >
              {runningCount} running
            </motion.span>
          )}
        </div>

        {/* filter tabs */}
        <div style={{ display: 'flex', gap: 2 }}>
          {FILTERS.map(({ key, label }) => {
            const active = filter === key
            return (
              <button key={key} onClick={() => setFilter(key)} style={{
                ...mono,
                background: active ? 'rgba(99,102,241,0.15)' : 'transparent',
                color: active ? '#a5b4fc' : '#334155',
                border: active ? '1px solid rgba(99,102,241,0.3)' : '1px solid transparent',
                borderRadius: 5, padding: '2px 8px', fontSize: 10, fontWeight: active ? 700 : 400,
                cursor: 'pointer', transition: 'all 0.1s',
              }}>
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* task list */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '8px 6px 4px',
        scrollbarWidth: 'thin', scrollbarColor: '#1e293b transparent',
      }}>
        {visible.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            height: '100%', gap: 8,
          }}>
            <div style={{ fontSize: 28, opacity: 0.2 }}>⟳</div>
            <span style={{ ...mono, fontSize: 11, color: '#1e293b', letterSpacing: '0.08em' }}>
              {filter === 'all' ? 'no tasks yet' : `no ${filter} tasks`}
            </span>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {visible.map(task => <TaskRow key={task.id} task={task} />)}
          </AnimatePresence>
        )}
      </div>

      {/* submit bar */}
      <SubmitBar connected={wsConnected} />
    </div>
  )
}
