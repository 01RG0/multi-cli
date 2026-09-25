import { useEffect, Component, type ReactNode } from 'react'
import useWebSocket, { ReadyState } from 'react-use-websocket'
import { motion } from 'framer-motion'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null }
  static getDerivedStateFromError(e: Error) { return { error: e.message } }
  render() {
    if (this.state.error) return (
      <div style={{ color: '#f87171', padding: 32, fontFamily: 'monospace', background: '#0f172a', minHeight: '100vh' }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>React render error</div>
        <pre style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'pre-wrap' }}>{this.state.error}</pre>
      </div>
    )
    return this.props.children
  }
}
import { useStore } from './store/useStore'
import type { WsEvent } from './store/useStore'
import BrainGraph from './components/BrainGraph'
import LiveFeed from './components/LiveFeed'
import StatsPanel from './components/StatsPanel'

const WS_URL = import.meta.env.VITE_WS_URL ??
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`

export default function App() {
  const applyEvent = useStore((s) => s.applyEvent)
  const setWsConnected = useStore((s) => s.setWsConnected)
  const wsConnected = useStore((s) => s.wsConnected)

  const { lastJsonMessage, readyState } = useWebSocket(WS_URL, {
    shouldReconnect: () => true,
    reconnectInterval: 3000,
  })

  useEffect(() => {
    setWsConnected(readyState === ReadyState.OPEN)
  }, [readyState, setWsConnected])

  useEffect(() => {
    if (lastJsonMessage) {
      applyEvent(lastJsonMessage as WsEvent)
    }
  }, [lastJsonMessage, applyEvent])

  return (
    <ErrorBoundary>
    <div
      style={{
        minHeight: '100vh',
        background: 'radial-gradient(ellipse at 20% 20%, #0f1b35 0%, #0a0f1e 60%, #060b16 100%)',
        color: '#f1f5f9',
        fontFamily: "'JetBrains Mono', 'Courier New', ui-monospace, monospace",
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* ── Header ── */}
      <motion.header
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 24px',
          borderBottom: '1px solid #1e293b',
          background: 'rgba(15,23,42,0.7)',
          backdropFilter: 'blur(12px)',
          flexShrink: 0,
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 22 }}>🧠</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#e0e7ff', letterSpacing: '0.05em' }}>
              AI Agent Orchestrator
            </div>
            <div style={{ fontSize: 10, color: '#475569', letterSpacing: '0.08em' }}>
              multi-cli · go · sqlite · react
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <WsIndicator connected={wsConnected} />
          <a
            href="/health"
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 11, color: '#475569', textDecoration: 'none' }}
          >
            /health ↗
          </a>
        </div>
      </motion.header>

      {/* ── 3-column body ── */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          gap: 12,
          padding: 12,
          overflow: 'hidden',
          alignItems: 'flex-start',
        }}
      >
        {/* Left: Stats sidebar */}
        <motion.div
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          style={{
            flexShrink: 0,
            border: '1px solid #1e293b',
            borderRadius: 12,
            boxShadow: '0 0 0 1px rgba(99,102,241,0.08), 0 8px 32px rgba(0,0,0,0.4)',
          }}
        >
          <StatsPanel />
        </motion.div>

        {/* Center: Brain graph */}
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          style={{
            flex: 1,
            minWidth: 0,
            border: '1px solid #1e293b',
            borderRadius: 12,
            overflow: 'hidden',
            boxShadow: '0 0 0 1px rgba(99,102,241,0.12), 0 8px 32px rgba(0,0,0,0.5)',
          }}
        >
          <div style={{ padding: '10px 14px 0', background: '#0b1120', borderBottom: '1px solid #1e293b' }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#475569', textTransform: 'uppercase' }}>
              agent brain
            </span>
          </div>
          <BrainGraph />
        </motion.div>

        {/* Right: Live feed */}
        <motion.div
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          style={{
            width: 420,
            flexShrink: 0,
            border: '1px solid #1e293b',
            borderRadius: 12,
            overflow: 'hidden',
            boxShadow: '0 0 0 1px rgba(99,102,241,0.08), 0 8px 32px rgba(0,0,0,0.4)',
          }}
        >
          <LiveFeed />
        </motion.div>
      </div>
    </div>
    </ErrorBoundary>
  )
}

function WsIndicator({ connected }: { connected: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <div style={{ position: 'relative', width: 10, height: 10 }}>
        {connected && (
          <motion.div
            animate={{ scale: [1, 2, 1], opacity: [0.6, 0, 0.6] }}
            transition={{ duration: 2, repeat: Infinity }}
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
            background: connected ? '#4ade80' : '#f87171',
          }}
        />
      </div>
      <span style={{ fontSize: 11, color: connected ? '#4ade80' : '#f87171', fontWeight: 600 }}>
        {connected ? 'live' : 'offline'}
      </span>
    </div>
  )
}
