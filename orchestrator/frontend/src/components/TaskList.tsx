import {
  DndContext,
  closestCenter,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useStore } from '../store/useStore'
import type { Task } from '../store/useStore'

const statusBadge: Record<string, string> = {
  pending: '#94a3b8',
  running: '#facc15',
  suspended: '#fb923c',
  completed: '#4ade80',
  failed: '#f87171',
}

function TaskRow({ task }: { task: Task }) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 8px',
    borderBottom: '1px solid #1e293b',
    cursor: 'grab',
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <span
        style={{
          background: statusBadge[task.status],
          borderRadius: 4,
          padding: '1px 6px',
          fontSize: 11,
          color: '#0f172a',
          minWidth: 72,
          textAlign: 'center',
        }}
      >
        {task.status}
      </span>
      <span style={{ fontSize: 12, color: '#cbd5e1', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {task.prompt}
      </span>
      <span style={{ fontSize: 11, color: '#64748b' }}>{task.agentId || '—'}</span>
      <span style={{ fontSize: 11, color: '#475569' }}>p{task.priority}</span>
    </div>
  )
}

export default function TaskList() {
  const tasks = useStore((s) => s.tasks)

  function handleDragEnd(e: DragEndEvent) {
    // Priority re-ordering is a future enhancement — drag is visual only for now
    void e
  }

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div style={{ maxHeight: 320, overflowY: 'auto', background: '#0f172a', borderRadius: 8 }}>
          {tasks.length === 0 && (
            <div style={{ padding: 16, color: '#475569', textAlign: 'center' }}>No tasks</div>
          )}
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
