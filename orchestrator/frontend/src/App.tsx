import { useEffect } from 'react'
import useWebSocket, { ReadyState } from 'react-use-websocket'
import { useStore } from './store/useStore'
import type { WsEvent } from './store/useStore'
import StatsBar from './components/StatsBar'
import AgentGraph from './components/AgentGraph'
import TaskList from './components/TaskList'

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8080/ws'

export default function App() {
  const applyEvent = useStore((s) => s.applyEvent)
  const setWsConnected = useStore((s) => s.setWsConnected)

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
    <div
      style={{
        minHeight: '100vh',
        background: '#0f172a',
        color: '#f1f5f9',
        fontFamily: 'system-ui, sans-serif',
        padding: 24,
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20, color: '#6366f1' }}>
        AI Agent Orchestrator
      </h1>
      <StatsBar />
      <section style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 14, color: '#64748b', marginBottom: 8 }}>Agent Graph</h2>
        <AgentGraph />
      </section>
      <section>
        <h2 style={{ fontSize: 14, color: '#64748b', marginBottom: 8 }}>Task Queue</h2>
        <TaskList />
      </section>
    </div>
  )
}
