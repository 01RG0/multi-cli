import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState,
  type Node, type Edge, type NodeProps,
} from '@xyflow/react'
import { motion } from 'framer-motion'
import { useEffect, useMemo } from 'react'
import { useStore } from '../store/useStore'

type AgentStatus = 'idle' | 'working' | 'error'

const STATUS: Record<AgentStatus, { color: string; glow: string; label: string }> = {
  idle:    { color: '#22c55e', glow: 'rgba(34,197,94,0.4)',   label: 'IDLE' },
  working: { color: '#eab308', glow: 'rgba(234,179,8,0.4)',   label: 'WORKING' },
  error:   { color: '#ef4444', glow: 'rgba(239,68,68,0.4)',   label: 'ERROR' },
}

const AGENTS = ['opencode', 'agy', 'grok', 'cline', 'vibe', 'codex', 'kilo']

const PULSE_KF = `
@keyframes orbPulse {
  0%,100% { transform: scale(1); opacity: 0.6; }
  50%      { transform: scale(1.5); opacity: 0; }
}
@keyframes corePulse {
  0%,100% { box-shadow: 0 0 30px 8px rgba(99,102,241,0.5), 0 0 60px 16px rgba(99,102,241,0.2), inset 0 0 20px rgba(99,102,241,0.3); }
  50%      { box-shadow: 0 0 50px 16px rgba(99,102,241,0.7), 0 0 100px 32px rgba(99,102,241,0.3), inset 0 0 30px rgba(99,102,241,0.4); }
}
@keyframes nodeBlink {
  0%,100% { opacity: 1; }
  50%      { opacity: 0.4; }
}`

function OrchestratorNode(_: NodeProps) {
  return (
    <div style={{ position: 'relative', width: 110, height: 110 }}>
      {/* Outer pulse ring */}
      <div style={{
        position: 'absolute', inset: -20, borderRadius: '50%',
        background: 'rgba(99,102,241,0.15)',
        animation: 'orbPulse 2.5s ease-in-out infinite',
      }} />
      {/* Core */}
      <div style={{
        width: 110, height: 110, borderRadius: '50%',
        background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #4338ca 100%)',
        border: '1.5px solid rgba(165,180,252,0.4)',
        animation: 'corePulse 3s ease-in-out infinite',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 4, cursor: 'default',
      }}>
        <span style={{ fontSize: 28, lineHeight: 1 }}>🧠</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#e0e7ff', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Orchestrator
        </span>
      </div>
    </div>
  )
}

function AgentNode({ data }: NodeProps) {
  const d = data as { label: string; status: AgentStatus; active: boolean }
  const s = STATUS[d.status] ?? STATUS.idle
  return (
    <div style={{
      width: 100,
      background: 'rgba(15,23,42,0.85)',
      backdropFilter: 'blur(12px)',
      border: `1px solid ${s.color}33`,
      borderLeft: `3px solid ${s.color}`,
      borderRadius: 10,
      padding: '10px 12px',
      boxShadow: `0 0 16px ${s.glow}, 0 4px 24px rgba(0,0,0,0.5)`,
      display: 'flex', flexDirection: 'column', gap: 6,
      cursor: 'default',
    }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: '#f1f5f9', letterSpacing: '0.02em' }}>
        {d.label}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: s.color,
          boxShadow: `0 0 6px ${s.color}`,
          animation: d.status === 'working' ? 'nodeBlink 1s ease-in-out infinite' : 'none',
        }} />
        <span style={{ fontSize: 9, fontWeight: 700, color: s.color, letterSpacing: '0.12em' }}>
          {s.label}
        </span>
      </div>
    </div>
  )
}

const nodeTypes = { orchestrator: OrchestratorNode, agent: AgentNode }

export default function BrainGraph() {
  const storeAgents = useStore(s => s.agents)

  const agentList = useMemo(() =>
    storeAgents?.length > 0 ? storeAgents :
    AGENTS.map(name => ({ id: name, label: name, status: 'idle' as AgentStatus, currentTaskId: null })),
  [storeAgents])

  const buildGraph = useMemo(() => {
    const cx = 340, cy = 280, r = 210
    const orch: Node = {
      id: 'orchestrator', type: 'orchestrator',
      position: { x: cx - 55, y: cy - 55 },
      data: { label: 'Orchestrator' }, draggable: false,
    }
    const agents: Node[] = agentList.map((a, i) => {
      const angle = (2 * Math.PI * i / agentList.length) - Math.PI / 2
      return {
        id: a.id, type: 'agent',
        position: { x: cx + r * Math.cos(angle) - 50, y: cy + r * Math.sin(angle) - 28 },
        data: { label: a.label, status: a.status, active: !!a.currentTaskId },
        draggable: false,
      }
    })
    const edges: Edge[] = agentList
      .filter(a => a.currentTaskId)
      .map(a => {
        const s = STATUS[a.status as AgentStatus] ?? STATUS.idle
        return {
          id: `e-${a.id}`, source: 'orchestrator', target: a.id,
          animated: true,
          style: { stroke: s.color, strokeWidth: 2, filter: `drop-shadow(0 0 4px ${s.color})` },
        }
      })
    return { nodes: [orch, ...agents], edges }
  }, [agentList])

  const [nodes, setNodes, onNodesChange] = useNodesState(buildGraph.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(buildGraph.edges)

  useEffect(() => { setNodes(buildGraph.nodes); setEdges(buildGraph.edges) }, [buildGraph, setNodes, setEdges])

  return (
    <>
      <style>{PULSE_KF}</style>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
        style={{ width: '100%', height: 400 }}
      >
        <ReactFlow
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView fitViewOptions={{ padding: 0.15 }}
          style={{ background: 'transparent' }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#1e293b" gap={32} size={1} />
          <Controls />
          <MiniMap
            nodeColor={n => n.type === 'orchestrator' ? '#6366f1' : STATUS[(n.data as { status: AgentStatus }).status]?.color ?? '#22c55e'}
            maskColor="rgba(2,8,23,0.75)"
          />
        </ReactFlow>
      </motion.div>
    </>
  )
}
