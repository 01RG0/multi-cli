import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AreaChart, Area, ResponsiveContainer } from 'recharts'
import { useStore } from '../store/useStore'

const FALLBACK_AGENTS = [
  'opencode', 'agy', 'grok', 'cline', 'vibe', 'codex', 'kilo',
]

const PROVIDERS = [
  'groq', 'apmix', 'bedrock', 'tokenharbor', 'codecraft', 'aihubmix', 'ollama', 'anthropic',
]

interface AgentNode {
  id?: string
  name?: string
  status?: string
}

function AnimatedNumber({ value }: { value: number }) {
  const [displayed, setDisplayed] = useState(value)
  const [key, setKey] = useState(0)

  useEffect(() => {
    if (value !== displayed) {
      setKey(k => k + 1)
      setDisplayed(value)
    }
  }, [value])

  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={key}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.25 }}
        style={{ display: 'inline-block' }}
      >
        {displayed}
      </motion.span>
    </AnimatePresence>
  )
}

const STAT_CARDS = [
  { key: 'running',   label: 'Running',   icon: '▶',  color: '#facc15', bg: '#1e1a08' },
  { key: 'pending',   label: 'Pending',   icon: '⏳', color: '#94a3b8', bg: '#161b22' },
  { key: 'completed', label: 'Completed', icon: '✓',  color: '#4ade80', bg: '#0a1f14' },
  { key: 'failed',    label: 'Failed',    icon: '✗',  color: '#f87171', bg: '#1f0a0a' },
  { key: 'suspended', label: 'Suspended', icon: '⏸',  color: '#fb923c', bg: '#1f1208' },
] as const

function agentColor(status?: string): string {
  if (status === 'working' || status === 'running') return '#facc15'
  if (status === 'error' || status === 'failed') return '#f87171'
  return '#4ade80'
}

export default function StatsPanel() {
  const stats = useStore((s: any) => s.stats) ?? {
    pending: 0, running: 0, suspended: 0, completed: 0, failed: 0,
  }
  const wsConnected = useStore((s: any) => s.wsConnected) ?? false
  const storeAgents: AgentNode[] = useStore((s: any) => s.agents) ?? []

  const agents = storeAgents.length > 0
    ? storeAgents
    : FALLBACK_AGENTS.map(name => ({ id: name, name, status: 'idle' }))

  const [sparkData, setSparkData] = useState<{ v: number }[]>(() =>
    Array.from({ length: 20 }, () => ({ v: 0 }))
  )
  const prevCompleted = useRef(stats.completed)

  useEffect(() => {
    if (stats.completed !== prevCompleted.current) {
      prevCompleted.current = stats.completed
      setSparkData(prev => {
        const next = [...prev.slice(-19), { v: stats.completed }]
        return next
      })
    }
  }, [stats.completed])

  const panelStyle: React.CSSProperties = {
    background: '#0f172a',
    width: '220px',
    minWidth: '220px',
    height: '500px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    padding: '16px',
    boxSizing: 'border-box',
    borderRadius: '12px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    scrollbarWidth: 'thin',
    scrollbarColor: '#1e293b #0f172a',
  }

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: '10px',
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: '#475569',
    marginBottom: '8px',
  }

  const sectionStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
  }

  return (
    <div style={panelStyle}>
      {/* 1. Connection Status */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Connection</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ position: 'relative', width: '14px', height: '14px' }}>
            {wsConnected && (
              <motion.div
                animate={{ scale: [1, 1.4, 1], opacity: [0.6, 0, 0.6] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '50%',
                  background: '#4ade80',
                }}
              />
            )}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                background: wsConnected ? '#4ade80' : '#f87171',
              }}
            />
          </div>
          <span style={{
            fontSize: '13px',
            fontWeight: 600,
            color: wsConnected ? '#4ade80' : '#f87171',
          }}>
            {wsConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: '1px', background: '#1e293b' }} />

      {/* 2. Task Counters */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Task Counters</div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '6px',
        }}>
          {STAT_CARDS.map(card => (
            <div
              key={card.key}
              style={{
                background: card.bg,
                border: `1px solid ${card.color}22`,
                borderRadius: '8px',
                padding: '8px 10px',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '11px', color: card.color }}>{card.icon}</span>
                <span style={{ fontSize: '10px', color: '#64748b', fontWeight: 600 }}>
                  {card.label}
                </span>
              </div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: card.color, lineHeight: 1.1 }}>
                <AnimatedNumber value={(stats as any)[card.key] ?? 0} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: '1px', background: '#1e293b' }} />

      {/* 3. Agent Status Grid */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Agents</div>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}>
          {agents.map((agent, i) => {
            const name = agent.name ?? agent.id ?? FALLBACK_AGENTS[i] ?? `agent-${i}`
            const color = agentColor(agent.status)
            return (
              <div
                key={agent.id ?? name}
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <motion.div
                  animate={agent.status === 'working' || agent.status === 'running'
                    ? { scale: [1, 1.25, 1] }
                    : { scale: 1 }
                  }
                  transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: color,
                    flexShrink: 0,
                  }}
                />
                <span style={{
                  fontSize: '11px',
                  color: '#94a3b8',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {name}
                </span>
                <span style={{
                  marginLeft: 'auto',
                  fontSize: '9px',
                  color: color,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}>
                  {agent.status ?? 'idle'}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: '1px', background: '#1e293b' }} />

      {/* 4. Provider Chain */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Provider Chain</div>
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px',
        }}>
          {PROVIDERS.map((provider, i) => (
            <div
              key={provider}
              style={{
                padding: '2px 8px',
                borderRadius: '9999px',
                fontSize: '10px',
                fontWeight: 600,
                background: i === 0 ? '#4338ca' : '#1e293b',
                color: i === 0 ? '#e0e7ff' : '#64748b',
                border: `1px solid ${i === 0 ? '#6366f1' : '#334155'}`,
                letterSpacing: '0.04em',
              }}
            >
              {provider}
            </div>
          ))}
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: '1px', background: '#1e293b' }} />

      {/* 5. Throughput Sparkline */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Throughput</div>
        <div style={{ width: '100%', height: '60px' }}>
          <ResponsiveContainer width="100%" height={60}>
            <AreaChart data={sparkData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="v"
                stroke="#6366f1"
                strokeWidth={1.5}
                fill="url(#sparkGrad)"
                dot={false}
                isAnimationActive
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
