import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '../store/useStore'

const PROVIDERS = ['groq', 'apmix', 'bedrock', 'tokenharbor', 'codecraft', 'aihubmix', 'ollama', 'anthropic']
const FALLBACK_AGENTS = ['opencode', 'agy', 'grok', 'cline', 'vibe', 'codex', 'kilo']

const STATS = [
  { key: 'running',   label: 'Running',   color: '#eab308', bg: 'rgba(234,179,8,0.08)',   icon: '▶' },
  { key: 'pending',   label: 'Pending',   color: '#94a3b8', bg: 'rgba(148,163,184,0.06)', icon: '○' },
  { key: 'completed', label: 'Done',      color: '#22c55e', bg: 'rgba(34,197,94,0.08)',   icon: '✓' },
  { key: 'failed',    label: 'Failed',    color: '#ef4444', bg: 'rgba(239,68,68,0.08)',   icon: '✗' },
] as const

function agentColor(s?: string) {
  if (s === 'working') return '#eab308'
  if (s === 'error') return '#ef4444'
  return '#22c55e'
}

function AnimatedNumber({ value }: { value: number }) {
  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={value}
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 6 }}
        transition={{ duration: 0.2 }}
        style={{ display: 'inline-block' }}
      >{value}</motion.span>
    </AnimatePresence>
  )
}

function SvgSparkline({ data }: { data: number[] }) {
  const w = 168, h = 40
  const max = Math.max(...data, 1)
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * (h - 4) - 2}`).join(' ')
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', opacity: 0.9 }}>
      <defs>
        <linearGradient id="sg2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" stopOpacity={0.5} />
          <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill="url(#sg2)" />
      <polyline points={pts} fill="none" stroke="#818cf8" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  )
}

const glass: React.CSSProperties = {
  background: 'rgba(15,23,42,0.6)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: 12,
}

const label: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
  textTransform: 'uppercase', color: '#475569', marginBottom: 10,
}

export default function StatsPanel() {
  const stats  = useStore((s: any) => s.stats) ?? { pending:0, running:0, suspended:0, completed:0, failed:0 }
  const ws     = useStore((s: any) => s.wsConnected) ?? false
  const agents = (useStore((s: any) => s.agents) ?? []) as { id?: string; name?: string; status?: string }[]
  const list   = agents.length > 0 ? agents : FALLBACK_AGENTS.map(n => ({ id: n, name: n, status: 'idle' }))

  const [spark, setSpark] = useState(() => Array.from({ length: 20 }, () => ({ v: 0 })))
  const prev = useRef(0)
  useEffect(() => {
    if (stats.completed !== prev.current) {
      prev.current = stats.completed
      setSpark(p => [...p.slice(-19), { v: stats.completed }])
    }
  }, [stats.completed])

  return (
    <div style={{
      width: 200, display: 'flex', flexDirection: 'column', gap: 8,
      fontFamily: "'JetBrains Mono','Courier New',monospace",
    }}>

      {/* WS status */}
      <div style={{ ...glass, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ position: 'relative', width: 10, height: 10, flexShrink: 0 }}>
          {ws && (
            <motion.div
              animate={{ scale: [1, 2.2, 1], opacity: [0.5, 0, 0.5] }}
              transition={{ duration: 1.8, repeat: Infinity }}
              style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#22c55e' }}
            />
          )}
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: ws ? '#22c55e' : '#ef4444' }} />
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, color: ws ? '#22c55e' : '#ef4444' }}>
          {ws ? 'Connected' : 'Offline'}
        </span>
      </div>

      {/* Task counters */}
      <div style={{ ...glass, padding: '12px 14px' }}>
        <div style={label}>Tasks</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {STATS.map(c => (
            <div key={c.key} style={{
              background: c.bg, border: `1px solid ${c.color}22`,
              borderRadius: 8, padding: '8px 10px',
            }}>
              <div style={{ fontSize: 9, color: c.color, marginBottom: 2 }}>{c.icon} {c.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: c.color }}>
                <AnimatedNumber value={(stats as any)[c.key] ?? 0} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Agents */}
      <div style={{ ...glass, padding: '12px 14px' }}>
        <div style={label}>Agents</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {list.map((a, i) => {
            const name = a.name ?? a.id ?? FALLBACK_AGENTS[i]
            const col = agentColor(a.status)
            return (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <motion.div
                  animate={a.status === 'working' ? { scale: [1, 1.4, 1] } : { scale: 1 }}
                  transition={{ duration: 1.1, repeat: Infinity }}
                  style={{ width: 6, height: 6, borderRadius: '50%', background: col, flexShrink: 0, boxShadow: `0 0 6px ${col}` }}
                />
                <span style={{ fontSize: 11, color: '#94a3b8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                <span style={{ fontSize: 9, color: col, fontWeight: 700, letterSpacing: '0.08em' }}>
                  {(a.status ?? 'idle').toUpperCase()}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Providers */}
      <div style={{ ...glass, padding: '12px 14px' }}>
        <div style={label}>Provider chain</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {PROVIDERS.map((p, i) => (
            <span key={p} style={{
              fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 9999,
              background: i === 0 ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
              color: i === 0 ? '#a5b4fc' : '#475569',
              border: `1px solid ${i === 0 ? '#6366f155' : '#1e293b'}`,
            }}>{p}</span>
          ))}
        </div>
      </div>

      {/* Sparkline */}
      <div style={{ ...glass, padding: '12px 14px' }}>
        <div style={label}>Throughput</div>
        <SvgSparkline data={spark.map(d => d.v)} />
      </div>
    </div>
  )
}
