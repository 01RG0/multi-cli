import '@xyflow/react/dist/style.css'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react'
import { motion } from 'framer-motion'
import { useEffect, useMemo } from 'react'
import { useStore } from '../store/useStore'

type AgentStatus = 'idle' | 'working' | 'error'

const STATUS_COLOR: Record<AgentStatus, string> = {
  idle: '#4ade80',
  working: '#facc15',
  error: '#f87171',
}

const PLACEHOLDER_AGENTS = [
  'opencode', 'agy', 'grok', 'cline', 'vibe', 'codex', 'kilo',
]

const ORCHESTRATOR_KEYFRAMES = `
@keyframes orchestratorPulse {
  0%, 100% { transform: scale(1.0); }
  50%       { transform: scale(1.05); }
}
`

function OrchestratorNode({ data }: NodeProps) {
  return (
    <div
      style={{
        width: 120,
        height: 120,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
        border: '2px solid #818cf8',
        boxShadow: '0 0 32px 8px rgba(129,140,248,0.55), 0 0 64px 16px rgba(109,40,217,0.3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column' as const,
        gap: 4,
        animation: 'orchestratorPulse 2.4s ease-in-out infinite',
        cursor: 'default',
        userSelect: 'none' as const,
      }}
    >
      <span style={{ fontSize: 28 }}>🧠</span>
      <span style={{ color: '#e0e7ff', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em' }}>
        {data.label as string}
      </span>
    </div>
  )
}

interface AgentNodeData {
  label: string
  status: AgentStatus
}

function AgentNode({ data }: NodeProps) {
  const d = data as unknown as AgentNodeData
  const color = STATUS_COLOR[d.status]
  return (
    <div
      style={{
        minWidth: 100,
        padding: '10px 14px',
        borderRadius: 12,
        background: '#1e293b',
        border: `2px solid ${color}`,
        boxShadow: `0 0 12px 2px ${color}55`,
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'center',
        gap: 6,
        cursor: 'default',
        userSelect: 'none' as const,
      }}
    >
      <span style={{ color: '#f1f5f9', fontSize: 13, fontWeight: 600 }}>{d.label}</span>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase' as const,
          color,
        }}
      >
        {d.status}
      </span>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
          boxShadow: `0 0 6px 2px ${color}88`,
        }}
      />
    </div>
  )
}

const nodeTypes = {
  orchestrator: OrchestratorNode,
  agent: AgentNode,
}

const CENTER_X = 300
const CENTER_Y = 300
const RADIUS = 220

export default function BrainGraph() {
  const storeAgents = useStore((s) => s.agents)

  const agentList = useMemo(() => {
    if (storeAgents && storeAgents.length > 0) return storeAgents
    return PLACEHOLDER_AGENTS.map((name) => ({
      id: name,
      label: name,
      status: 'idle' as AgentStatus,
      currentTaskId: null,
    }))
  }, [storeAgents])

  const initialNodes: Node[] = useMemo(() => {
    const orchestrator: Node = {
      id: 'orchestrator',
      type: 'orchestrator',
      position: { x: CENTER_X - 60, y: CENTER_Y - 60 },
      data: { label: 'Orchestrator' },
      draggable: false,
    }

    const agentNodes: Node[] = agentList.map((agent, i) => {
      const angle = (2 * Math.PI * i) / agentList.length - Math.PI / 2
      const x = CENTER_X + RADIUS * Math.cos(angle) - 50
      const y = CENTER_Y + RADIUS * Math.sin(angle) - 30
      return {
        id: agent.id,
        type: 'agent',
        position: { x, y },
        data: { label: agent.label, status: agent.status },
        draggable: false,
      }
    })

    return [orchestrator, ...agentNodes]
  }, [agentList])

  const initialEdges: Edge[] = useMemo(() => {
    return agentList
      .filter((a) => a.currentTaskId !== null)
      .map((a) => ({
        id: `orch-${a.id}`,
        source: 'orchestrator',
        target: a.id,
        animated: true,
        style: { stroke: STATUS_COLOR[a.status as AgentStatus], strokeWidth: 2 },
      }))
  }, [agentList])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  useEffect(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [initialNodes, initialEdges, setNodes, setEdges])

  return (
    <>
      <style>{ORCHESTRATOR_KEYFRAMES}</style>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        style={{ width: '100%', height: 500, background: '#0f172a', borderRadius: 16, overflow: 'hidden' }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          style={{ background: '#0f172a' }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#1e293b" gap={24} />
          <Controls
            style={{
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: 8,
            }}
          />
          <MiniMap
            style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
            nodeColor={(node) => {
              if (node.type === 'orchestrator') return '#6366f1'
              const status = (node.data as unknown as AgentNodeData).status
              return STATUS_COLOR[status] ?? '#4ade80'
            }}
            maskColor="rgba(15,23,42,0.7)"
          />
        </ReactFlow>
      </motion.div>
    </>
  )
}
