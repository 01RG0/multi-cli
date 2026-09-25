import { useEffect, useRef, useState, useCallback, Component, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { useStore } from './store/useStore'
import type { WsEvent } from './store/useStore'
import BrainGraph from './components/BrainGraph'
import LiveFeed from './components/LiveFeed'
import StatsPanel from './components/StatsPanel'

const WS_URL = import.meta.env.VITE_WS_URL ??
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`

function useWS(url: string, onMessage: (data: unknown) => void) {
  const ws = useRef<WebSocket | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [connected, setConnected] = useState(false)
  const onMsg = useRef(onMessage)
  onMsg.current = onMessage
  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) return
    const sock = new WebSocket(url)
    ws.current = sock
    sock.onopen  = () => setConnected(true)
    sock.onclose = () => { setConnected(false); timer.current = setTimeout(connect, 3000) }
    sock.onerror = () => sock.close()
    sock.onmessage = e => { try { onMsg.current(JSON.parse(e.data)) } catch {} }
  }, [url])
  useEffect(() => {
    connect()
    return () => { if (timer.current) clearTimeout(timer.current); ws.current?.close() }
  }, [connect])
  return connected
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null }
  static getDerivedStateFromError(e: Error) { return { error: e.message } }
  render() {
    if (this.state.error) return (
      <div style={{ color: '#f87171', padding: 32, fontFamily: 'monospace', background: '#020817', minHeight: '100vh' }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Render error</div>
        <pre style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'pre-wrap' }}>{this.state.error}</pre>
      </div>
    )
    return this.props.children
  }
}

export default function App() {
  const applyEvent    = useStore(s => s.applyEvent)
  const setWsConnected = useStore(s => s.setWsConnected)
  const wsConnected   = useStore(s => s.wsConnected)

  const connected = useWS(WS_URL, data => applyEvent(data as WsEvent))
  useEffect(() => { setWsConnected(connected) }, [connected, setWsConnected])

  return (
    <ErrorBoundary>
      <div style={{
        minHeight: '100vh',
        background: `
          radial-gradient(ellipse 90% 50% at 50% -5%, rgba(99,102,241,0.22) 0%, transparent 60%),
          radial-gradient(ellipse 60% 40% at 85% 40%, rgba(168,85,247,0.1) 0%, transparent 50%),
          radial-gradient(ellipse 50% 30% at 10% 80%, rgba(59,130,246,0.08) 0%, transparent 50%),
          #020817`,
        display: 'flex',
        flexDirection: 'column',
      }}>

        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 24px',
            background: 'rgba(2,8,23,0.7)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
              boxShadow: '0 0 16px rgba(99,102,241,0.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18,
            }}>🧠</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.01em' }}>
                AI Agent Orchestrator
              </div>
              <div style={{ fontSize: 10, color: '#475569', letterSpacing: '0.06em', marginTop: 1 }}>
                go · sqlite · react · 9 providers
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            {/* WS pill */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7,
              background: wsConnected ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
              border: `1px solid ${wsConnected ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
              borderRadius: 9999, padding: '4px 12px',
            }}>
              <div style={{ position: 'relative', width: 8, height: 8 }}>
                {wsConnected && (
                  <motion.div
                    animate={{ scale: [1, 2.5, 1], opacity: [0.6, 0, 0.6] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#22c55e' }}
                  />
                )}
                <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: wsConnected ? '#22c55e' : '#ef4444' }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, color: wsConnected ? '#22c55e' : '#ef4444' }}>
                {wsConnected ? 'live' : 'offline'}
              </span>
            </div>

            <a href="/health" target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: '#475569', textDecoration: 'none', fontFamily: 'monospace' }}>
              /health ↗
            </a>
          </div>
        </motion.header>

        {/* Body */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, padding: 12 }}>

          {/* Brain graph — full width glass card */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            style={{
              background: 'rgba(15,23,42,0.5)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid rgba(99,102,241,0.15)',
              borderRadius: 16,
              overflow: 'hidden',
              boxShadow: '0 0 0 1px rgba(99,102,241,0.1), 0 20px 60px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{
              padding: '10px 16px',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#6366f1', boxShadow: '0 0 8px #6366f1' }} />
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', color: '#6366f1', textTransform: 'uppercase' }}>
                Agent Brain
              </span>
            </div>
            <BrainGraph />
          </motion.div>

          {/* Bottom row: stats + feed */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>

            {/* Stats */}
            <motion.div
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.25 }}
            >
              <StatsPanel />
            </motion.div>

            {/* Live feed */}
            <motion.div
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              style={{
                flex: 1, minWidth: 0,
                background: 'rgba(15,23,42,0.5)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 16,
                overflow: 'hidden',
                boxShadow: '0 4px 32px rgba(0,0,0,0.4)',
              }}
            >
              <LiveFeed />
            </motion.div>

          </div>
        </div>
      </div>
    </ErrorBoundary>
  )
}
