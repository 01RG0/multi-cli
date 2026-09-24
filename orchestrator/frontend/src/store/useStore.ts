import { create } from 'zustand'

export type TaskStatus = 'pending' | 'running' | 'suspended' | 'completed' | 'failed'

export interface Task {
  id: string
  type: string
  status: TaskStatus
  priority: number
  agentId: string
  prompt: string
  result: string
  error: string
  createdAt: number
  startedAt: number
  finishedAt: number
}

export interface AgentNode {
  id: string
  label: string
  status: 'idle' | 'working' | 'error'
  currentTaskId: string | null
}

export interface Stats {
  pending: number
  running: number
  suspended: number
  completed: number
  failed: number
}

interface Store {
  tasks: Task[]
  agents: AgentNode[]
  stats: Stats
  wsConnected: boolean
  setWsConnected: (v: boolean) => void
  applyEvent: (event: WsEvent) => void
}

export type WsEvent =
  | { type: 'task_created'; task: Task }
  | { type: 'task_started'; task: Task }
  | { type: 'task_completed'; task: Task }
  | { type: 'task_failed'; task: Task }
  | { type: 'task_suspended'; task: Task }
  | { type: 'stats'; stats: Stats }
  | { type: 'snapshot'; tasks: Task[]; agents: AgentNode[]; stats: Stats }

export const useStore = create<Store>((set) => ({
  tasks: [],
  agents: [],
  stats: { pending: 0, running: 0, suspended: 0, completed: 0, failed: 0 },
  wsConnected: false,
  setWsConnected: (v) => set({ wsConnected: v }),
  applyEvent: (event) =>
    set((state) => {
      switch (event.type) {
        case 'snapshot':
          return { tasks: event.tasks, agents: event.agents, stats: event.stats }
        case 'stats':
          return { stats: event.stats }
        case 'task_created':
          return { tasks: [event.task, ...state.tasks] }
        case 'task_started':
        case 'task_completed':
        case 'task_failed':
        case 'task_suspended': {
          const updated = state.tasks.map((t) =>
            t.id === event.task.id ? event.task : t
          )
          return { tasks: updated }
        }
        default:
          return state
      }
    }),
}))
