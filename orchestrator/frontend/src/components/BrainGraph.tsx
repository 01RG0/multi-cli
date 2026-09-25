import {
  ReactFlow, Background, Controls, BackgroundVariant,
  useNodesState, useEdgesState,
  type Node, type Edge, type NodeProps,
} from '@xyflow/react'
import { motion } from 'framer-motion'
import { useEffect, useMemo } from 'react'
import { useStore } from '../store/useStore'

type AgentStatus = 'idle' | 'working' | 'error'

const STATUS: Record<AgentStatus, { color: string; glow: string }> = {
  idle:    { color: '#10b981', glow: 'rgba(16,185,129,0.5)' },
  working: { color: '#f59e0b', glow: 'rgba(245,158,11,0.5)' },
  error:   { color: '#f43f5e', glow: 'rgba(244,63,94,0.5)'  },
}

const AGENTS = ['opencode', 'agy', 'grok', 'cline', 'vibe', 'codex', 'kilo']

const KF = `
@keyframes orbCore {
  0%,100% { box-shadow: 0 0 32px 10px rgba(99,102,241,0.55), 0 0 64px 20px rgba(99,102,241,0.2); }
  50%      { box-shadow: 0 0 52px 18px rgba(139,92,246,0.7), 0 0 100px 36px rgba(139,92,246,0.25); }
}
@keyframes orbRing {
  0%,100% { transform: scale(1); opacity: 0.5; }
  50%      { transform: scale(1.6); opacity: 0; }
}
@keyframes dotPulse {
  0%,100% { transform: scale(1); opacity: 1; }
  50%      { transform: scale(1.8); opacity: 0.3; }
}`

function OrchestratorNode(_: NodeProps) {
  return (
    <div style={{ position: 'relative', width: 96, height: 96 }}>
      {/* Ripple rings */}
      <div style={{
        position: 'absolute', inset: -18, borderRadius: '50%',
        border: '1px solid rgba(99,102,241,0.3)',
        animation: 'orbRing 2.8s ease-in-out infinite',
      }} />
      <div style={{
        position: 'absolute', inset: -8, borderRadius: '50%',
        border: '1px solid rgba(99,102,241,0.2)',
        animation: 'orbRing 2.8s ease-in-out infinite 0.4s',
      }} />
      {/* Core */}
      <div style={{
        width: 96, height: 96, borderRadius: '50%',
        background: 'linear-gradient(135deg, #4338ca 0%, #6d28d9 50%, #4f46e5 100%)',
        animation: 'orbCore 3s ease-in-out infinite',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 2,
        cursor: 'default',
      }}>
        <span style={{ fontSize: 26, lineHeight: 1, filter: 'drop-shadow(0 0 6px rgba(167,139,250,0.8))' }}>🧠</span>
        <span style={{
          fontSize: 8, fontWeight: 700, color: 'rgba(224,231,255,0.7)',
          letterSpacing: '0.18em', textTransform: 'uppercase',
        }}>Core</span>
      </div>
    </div>
  )
}

function AgentNode({ data }: NodeProps) {
  const d = data as { label: string; status: AgentStatus; active: boolean }
  const s = STATUS[d.status] ?? STATUS.idle
  const working = d.status === 'working'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 9,
      padding: '8px 16px 8px 11px',
      background: working
        ? `rgba(15,23,42,0.92)`
        : 'rgba(15,23,42,0.75)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      border: `1px solid ${working ? s.color + '40' : 'rgba(255,255,255,0.07)'}`,
      borderRadius: 100,
      boxShadow: working
        ? `0 0 20px ${s.glow}, 0 4px 16px rgba(0,0,0,0.5)`
        : '0 2px 12px rgba(0,0,0,0.35)',
      cursor: 'default',
      whiteSpace: 'nowrap',
      minWidth: 100,
      transition: 'box-shadow 0.3s, border-color 0.3s',
    }}>
      {/* Status dot */}
      <div style={{ position: 'relative', width: 8, height: 8, flexShrink: 0 }}>
        {working && (
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            background: s.color,
            animation: 'dotPulse 1.2s ease-in-out infinite',
          }} />
        )}
        <div style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          background: s.color,
          boxShadow: `0 0 ${working ? 8 : 4}px ${s.color}`,
        }} />
      </div>

      {/* Name */}
      <span style={{
        fontSize: 12, fontWeight: 600,
        color: working ? '#f1f5f9' : '#94a3b8',
        letterSpacing: '0.01em',
        transition: 'color 0.3s',
      }}>
        {d.label}
      </span>
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
    const cx = 320, cy = 250, r = 200
    const orch: Node = {
      id: 'orchestrator', type: 'orchestrator',
      position: { x: cx - 48, y: cy - 48 },
      data: { label: 'Orchestrator' }, draggable: false,
    }
    const agents: Node[] = agentList.map((a, i) => {
      const angle = (2 * Math.PI * i / agentList.length) - Math.PI / 2
      return {
        id: a.id, type: 'agent',
        position: { x: cx + r * Math.cos(angle) - 55, y: cy + r * Math.sin(angle) - 20 },
        data: { label: a.label ?? a.id, status: a.status, active: !!a.currentTaskId },
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
          style: { stroke: s.color, strokeWidth: 1.5, filter: `drop-shadow(0 0 3px ${s.color})`, opacity: 0.8 },
        }
      })
    return { nodes: [orch, ...agents], edges }
  }, [agentList])

  const [nodes, setNodes, onNodesChange] = useNodesState(buildGraph.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(buildGraph.edges)

  useEffect(() => { setNodes(buildGraph.nodes); setEdges(buildGraph.edges) }, [buildGraph, setNodes, setEdges])

  return (
    <>
      <style>{KF}</style>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
        style={{ width: '100%', height: 420 }}
      >
        <ReactFlow
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView fitViewOptions={{ padding: 0.18 }}
          style={{ background: 'transparent' }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          preventScrolling={false}
        >
          <Background
            variant={BackgroundVariant.Dots}
            color="rgba(99,102,241,0.12)"
            gap={28} size={1}
          />
          <Controls showInteractive={false} />
        </ReactFlow>
      </motion.div>
    </>
  )
}
