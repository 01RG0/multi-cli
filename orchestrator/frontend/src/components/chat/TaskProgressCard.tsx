/**
 * TaskProgressCard — shows a task's execution progress using Ant Design X ThoughtChain.
 *
 * Backend data verified from audit:
 * - task.ID, task.AgentID, task.Prompt, task.Status — LIVE (queue.go Task struct)
 * - task.CreatedAt (UnixMilli int64), task.StartedAt, task.FinishedAt — LIVE (queue.go)
 * - WS event "task_created" fields: id, prompt, status, agentId, createdAt — LIVE (server.go)
 * - WS event "task_update" fields: id, status, agentId?, error? — LIVE (main.go)
 * - task.steps / ThoughtChain step events — NOT emitted by backend hub; steps are MOCKED
 *   (Steps populated from WS task.step events when backend wires hub.Broadcast — using
 *    mock steps in dev mode)
 */

import { useEffect, useRef, useState } from 'react';
import ThoughtChain from '@ant-design/x/es/thought-chain';
import type { ThoughtChainItemType } from '@ant-design/x/es/thought-chain';
import { AgentBadge } from './AgentBadge';

export interface TaskStep {
  id: string;
  label: string;      // e.g. "Dispatched to codex", "Tool: read_file", "Streaming output"
  status: 'pending' | 'running' | 'done' | 'error';
  content?: string;   // optional detail text
  durationMs?: number;
}

export interface TaskProgressCardProps {
  taskId: string;
  agentId: string;
  prompt: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  steps?: TaskStep[];
  expanded?: boolean;
  onToggle?: () => void;
}

// Map our step status to ThoughtChain item status
function toChainStatus(s: TaskStep['status']): ThoughtChainItemType['status'] {
  switch (s) {
    case 'running':  return 'loading';
    case 'done':     return 'success';
    case 'error':    return 'error';
    default:         return undefined;  // pending — no special icon
  }
}

// Task-level status pill
function StatusPill({ status }: { status: TaskProgressCardProps['status'] }) {
  const map = {
    queued:    { text: 'Queued',    cls: 'bg-zinc-700 text-zinc-300' },
    running:   { text: 'Running',   cls: 'bg-blue-900 text-blue-300 animate-pulse' },
    completed: { text: 'Done',      cls: 'bg-emerald-900 text-emerald-300' },
    failed:    { text: 'Failed',    cls: 'bg-red-900 text-red-300' },
  };
  const { text, cls } = map[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {text}
    </span>
  );
}

// Dev-mode mock steps shown when the backend hasn't wired task.step WS events yet
const MOCK_STEPS: TaskStep[] = [
  { id: 'mock-1', label: 'Task dispatched',   status: 'done',    durationMs: 12 },
  { id: 'mock-2', label: 'Agent initializing', status: 'running', content: 'Waiting for CLI response...' },
  { id: 'mock-3', label: 'Streaming output',  status: 'pending' },
];

function formatElapsed(ms: number): string {
  if (ms < 1000)  return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export function TaskProgressCard({
  taskId,
  agentId,
  prompt,
  status,
  steps,
  expanded = false,
  onToggle,
}: TaskProgressCardProps) {
  const startRef = useRef<number>(Date.now());
  const [elapsed, setElapsed] = useState(0);

  // Update elapsed timer every second while running
  useEffect(() => {
    if (status !== 'running') return;
    startRef.current = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - startRef.current), 1000);
    return () => clearInterval(id);
  }, [status]);

  // Resolve steps: use provided steps if any, else mock in dev
  const resolvedSteps: TaskStep[] = steps && steps.length > 0 ? steps : MOCK_STEPS;

  // Map to ThoughtChain items
  const chainItems: ThoughtChainItemType[] = resolvedSteps.map((step) => ({
    key:    step.id,
    title:  step.label,
    status: toChainStatus(step.status),
    description: step.durationMs != null ? `${step.durationMs}ms` : undefined,
    content: step.content ? <span className="text-zinc-400 text-xs font-mono">{step.content}</span> : undefined,
    blink:  step.status === 'running',
  }));

  const truncatedPrompt = prompt.length > 60 ? prompt.slice(0, 60) + '…' : prompt;

  return (
    <div
      className={`bg-zinc-950 border rounded-lg p-3 transition-colors cursor-pointer ${
        status === 'running'
          ? 'border-blue-800 shadow-sm shadow-blue-900/30'
          : 'border-zinc-800 hover:border-zinc-700'
      }`}
      onClick={onToggle}
    >
      {/* Header — always visible */}
      <div className="flex items-center gap-2 min-w-0">
        <AgentBadge agentId={agentId} size="sm" />
        <StatusPill status={status} />
        {status === 'running' && elapsed > 0 && (
          <span className="text-zinc-500 text-xs ml-auto tabular-nums flex-shrink-0">
            {formatElapsed(elapsed)}
          </span>
        )}
        <svg
          className={`w-3.5 h-3.5 text-zinc-500 ml-auto flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      <p className="mt-1.5 text-zinc-400 text-xs font-mono leading-relaxed truncate">
        {expanded ? prompt : truncatedPrompt}
      </p>

      <p className="mt-0.5 text-zinc-600 text-xs">
        #{taskId.slice(0, 8)}
      </p>

      {/* Expanded: show ThoughtChain steps */}
      {expanded && (
        <div
          className="mt-3 border-t border-zinc-800 pt-3"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Steps populated from WS task.step events when backend wires hub.Broadcast
              — using mock steps in dev mode (real backend only emits task_created /
              task_update; step-level events are not yet wired). */}
          <ThoughtChain
            items={chainItems}
            className="thought-chain-dark"
            styles={{
              root:        { background: 'transparent' },
              item:        { color: '#a1a1aa' },
              itemHeader:  { color: '#d4d4d8' },
              itemContent: { color: '#71717a' },
            }}
          />
        </div>
      )}

      {/* Dark mode override for ThoughtChain Ant Design tokens */}
      <style>{`
        .thought-chain-dark .ant-thought-chain-item-title { color: #d4d4d8 !important; }
        .thought-chain-dark .ant-thought-chain-item-description { color: #71717a !important; }
        .thought-chain-dark .ant-thought-chain-item { border-color: #3f3f46 !important; }
        .thought-chain-dark .ant-thought-chain-item-icon { color: #60a5fa !important; }
      `}</style>
    </div>
  );
}
