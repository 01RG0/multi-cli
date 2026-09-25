import { useEffect, useRef, useState, useCallback, Component, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { useStore } from './store/useStore'
import type { WsEvent } from './store/useStore'
import BrainGraph from './components/BrainGraph'
import LiveFeed from './components/LiveFeed'
import StatsPanel from './components/StatsPanel'
import { FloatingDock, buildDockItems } from './components/FloatingDock'

const WS_URL = import.meta.env.VITE_WS_URL ??
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`

function useWS(url: string, onMessage: (data: unknown) => void) {
  const ws    = useRef<WebSocket | null>(null)
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
      <div className="flex items-center justify-center min-h-screen bg-[#020817]">
        <div className="text-red-400 font-mono text-sm p-8 max-w-lg">
          <div className="font-bold mb-2">render error</div>
          <pre className="text-slate-500 whitespace-pre-wrap text-xs">{this.state.error}</pre>
        </div>
      </div>
    )
    return this.props.children
  }
}

export default function App() {
  const applyEvent     = useStore(s => s.applyEvent)
  const setWsConnected = useStore(s => s.setWsConnected)
  const wsConnected    = useStore(s => s.wsConnected)

  const connected = useWS(WS_URL, data => applyEvent(data as WsEvent))
  useEffect(() => { setWsConnected(connected) }, [connected, setWsConnected])

  return (
    <ErrorBoundary>
      {/* Page wrapper */}
      <div className="min-h-screen flex flex-col" style={{
        background: `
          radial-gradient(ellipse 80% 40% at 50% -2%, rgba(99,102,241,0.2) 0%, transparent 55%),
          radial-gradient(ellipse 50% 30% at 90% 30%, rgba(139,92,246,0.08) 0%, transparent 50%),
          #020817`,
      }}>

        {/* ── Header ── */}
        <motion.header
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex items-center justify-between flex-shrink-0"
          style={{
            padding: '12px 20px',
            background: 'rgba(2,8,23,0.8)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          <div className="flex items-center gap-3">
            <div style={{
              width: 32, height: 32, borderRadius: 9,
              background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
              boxShadow: '0 0 14px rgba(99,102,241,0.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16,
            }}>🧠</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.01em' }}>
                AI Agent Orchestrator
              </div>
              <div style={{ fontSize: 10, color: '#334155', letterSpacing: '0.05em', marginTop: 1 }}>
                go · sqlite · react · 9 providers
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Live pill */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '3px 10px',
              background: wsConnected ? 'rgba(16,185,129,0.08)' : 'rgba(244,63,94,0.08)',
              border: `1px solid ${wsConnected ? 'rgba(16,185,129,0.25)' : 'rgba(244,63,94,0.25)'}`,
              borderRadius: 9999,
            }}>
              {wsConnected && (
                <motion.div
                  animate={{ scale: [1, 2.2, 1], opacity: [0.6, 0, 0.6] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  style={{
                    position: 'absolute',
                    width: 7, height: 7, borderRadius: '50%',
                    background: '#10b981',
                  }}
                />
              )}
              <div style={{
                width: 7, height: 7, borderRadius: '50%',
                background: wsConnected ? '#10b981' : '#f43f5e',
                position: 'relative',
                boxShadow: `0 0 6px ${wsConnected ? '#10b981' : '#f43f5e'}`,
              }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: wsConnected ? '#10b981' : '#f43f5e' }}>
                {wsConnected ? 'live' : 'offline'}
              </span>
            </div>

            <a href="/health" target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 10, color: '#334155', textDecoration: 'none', fontFamily: 'monospace', letterSpacing: '0.04em' }}>
              /health ↗
            </a>
          </div>
        </motion.header>

        {/* ── Main content ── */}
        <div className="flex-1 flex flex-col" style={{ padding: '10px 10px 90px', gap: 10 }}>

          {/* Brain graph */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.05 }}
            style={{
              background: 'rgba(9,14,31,0.6)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid rgba(99,102,241,0.12)',
              borderRadius: 16,
              overflow: 'hidden',
              boxShadow: '0 0 0 1px rgba(99,102,241,0.06), 0 20px 60px rgba(0,0,0,0.5)',
            }}
          >
            {/* card header */}
            <div style={{
              padding: '9px 16px',
              borderBottom: '1px solid rgba(255,255,255,0.04)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <div style={{
                  width: 5, height: 5, borderRadius: '50%',
                  background: '#6366f1', boxShadow: '0 0 6px #6366f1',
                }} />
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
                  color: '#6366f1', textTransform: 'uppercase',
                }}>Agent Brain</span>
              </div>
              <span style={{ fontSize: 10, color: '#1e293b', fontFamily: 'monospace' }}>
                {(useStore.getState().agents ?? []).length || 7} agents · 1 orchestrator
              </span>
            </div>
            <BrainGraph />
          </motion.div>

          {/* Bottom row */}
          <div className="flex gap-2.5">

            {/* Stats */}
            <motion.div
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.45, delay: 0.2 }}
            >
              <StatsPanel />
            </motion.div>

            {/* Feed */}
            <motion.div
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.45, delay: 0.25 }}
              className="flex-1 min-w-0"
              style={{
                background: 'rgba(9,14,31,0.6)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: '1px solid rgba(255,255,255,0.05)',
                borderRadius: 16,
                overflow: 'hidden',
                boxShadow: '0 4px 32px rgba(0,0,0,0.4)',
              }}
            >
              <LiveFeed />
            </motion.div>

          </div>
        </div>

        {/* ── Floating dock ── */}
        <div style={{
          position: 'fixed', bottom: 16, left: '50%',
          transform: 'translateX(-50%)', zIndex: 100,
        }}>
          <FloatingDock items={buildDockItems()} />
        </div>

      </div>
    </ErrorBoundary>
  )
}
