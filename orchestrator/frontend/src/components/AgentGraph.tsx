import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
} from '@xyflow/react'
import type { Node, Edge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useStore } from '../store/useStore'

const statusColor: Record<string, string> = {
  idle: '#4ade80',
  working: '#facc15',
  error: '#f87171',
}

export default function AgentGraph() {
  const agents = useStore((s) => s.agents)

  const nodes: Node[] = agents.map((a, i) => ({
    id: a.id,
    data: { label: `${a.label}\n${a.status}` },
    position: { x: 120 + (i % 4) * 180, y: 80 + Math.floor(i / 4) * 120 },
    style: {
      background: statusColor[a.status] ?? '#94a3b8',
      border: '1px solid #334155',
      borderRadius: 8,
      padding: 8,
      fontSize: 12,
    },
  }))

  const edges: Edge[] = agents
    .filter((a) => a.currentTaskId)
    .map((a) => ({
      id: `e-${a.id}`,
      source: 'orchestrator',
      target: a.id,
      animated: a.status === 'working',
    }))

  const orchestratorNode: Node = {
    id: 'orchestrator',
    data: { label: 'Orchestrator' },
    position: { x: 320, y: 10 },
    style: {
      background: '#6366f1',
      color: '#fff',
      border: '1px solid #4338ca',
      borderRadius: 8,
      fontWeight: 600,
    },
  }

  return (
    <div style={{ height: 300 }}>
      <ReactFlow nodes={[orchestratorNode, ...nodes]} edges={edges} fitView>
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  )
}
