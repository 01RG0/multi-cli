/**
 * TaskProgressCard — Ekko Studio style interactive multi-agent task progress card.
 *
 * Displays dispatched agent badges (@hermes, @opencode, @codex, @grok, etc.),
 * task status pills with pulsing animations, live elapsed execution timer,
 * progress bar indicator, and a direct 1-click "View Live Logs" action that
 * sets `selectedLogTaskId` in `useSwarmStore` and switches to the 'logs' tab.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Terminal,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  Sparkles,
} from 'lucide-react';
import ThoughtChain from '@ant-design/x/es/thought-chain';
import type { ThoughtChainItemType } from '@ant-design/x/es/thought-chain';
import { AgentBadge } from './AgentBadge';
import { useSwarmStore } from '../../store/useSwarmStore';

export interface TaskStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
  content?: string;
  durationMs?: number;
}

export interface TaskProgressCardProps {
  taskId: string;
  agentId: string;
  prompt: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  steps?: TaskStep[];
  defaultExpanded?: boolean;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function toChainStatus(s: TaskStep['status']): ThoughtChainItemType['status'] {
  switch (s) {
    case 'running': return 'loading';
    case 'done':    return 'success';
    case 'error':   return 'error';
    default:        return undefined;
  }
}

export function TaskProgressCard({
  taskId,
  agentId,
  prompt,
  status,
  steps,
  defaultExpanded = false,
}: TaskProgressCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [elapsed, setElapsed]   = useState(0);
  const startRef                = useRef<number>(Date.now());

  // Elapsed timer while task is actively running
  useEffect(() => {
    if (status !== 'running') return;
    startRef.current = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - startRef.current), 500);
    return () => clearInterval(id);
  }, [status]);

  const isRunning   = status === 'running';
  const isCompleted = status === 'completed';
  const isFailed    = status === 'failed';
  const isQueued    = status === 'queued';

  // Handle "View Live Logs" click: sets selectedLogTaskId in store and switches to 'logs' tab
  const handleViewLiveLogs = (e: React.MouseEvent) => {
    e.stopPropagation();
    // 1. Set the selected log task in Zustand
    useSwarmStore.getState().setSelectedLogTaskId(taskId);
    // 2. Dispatch event to switch active tab to 'logs'
    window.dispatchEvent(new CustomEvent('ultron:switch-tab', { detail: 'logs' }));
  };

  // Build steps if available or default fallback steps
  const resolvedSteps: TaskStep[] =
    steps && steps.length > 0
      ? steps
      : [
          { id: 's-dispatch', label: `Dispatched to @${agentId}`, status: 'done', durationMs: 45 },
          {
            id: 's-exec',
            label: isRunning ? 'Agent executing in CLI workspace...' : isCompleted ? 'Execution finished' : isFailed ? 'Execution failed' : 'Queued for worker',
            status: isRunning ? 'running' : isCompleted ? 'done' : isFailed ? 'error' : 'pending',
          },
        ];

  const chainItems: ThoughtChainItemType[] = resolvedSteps.map((step) => ({
    key: step.id,
    title: step.label,
    status: toChainStatus(step.status),
    description: step.durationMs != null ? `${step.durationMs}ms` : undefined,
    content: step.content ? <span className="text-zinc-400 text-xs font-mono">{step.content}</span> : undefined,
    blink: step.status === 'running',
  }));

  // Border and glow styles based on state
  const borderClass = isRunning
    ? 'border-cyan-800/80 bg-zinc-950/90 shadow-[0_0_15px_rgba(6,182,212,0.15)] ring-1 ring-cyan-500/20'
    : isCompleted
      ? 'border-emerald-900/60 bg-zinc-950/80 hover:border-emerald-800/80'
      : isFailed
        ? 'border-rose-900/60 bg-zinc-950/80 hover:border-rose-800/80'
        : 'border-zinc-800/80 bg-zinc-950/80 hover:border-zinc-700/80';

  return (
    <div
      className={`my-2 rounded-xl border p-3.5 transition-all duration-200 select-none ${borderClass}`}
    >
      {/* Top Bar: Agent Badge + Task ID + Status Pill + Live Logs CTA */}
      <div className="flex items-center gap-2.5 flex-wrap">
        {/* Agent Badge with Icon */}
        <AgentBadge agentId={agentId} size="md" />

        {/* Task ID chip */}
        <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400">
          #{taskId.slice(0, 8)}
        </span>

        {/* Status Pill */}
        <div className="inline-flex items-center gap-1.5">
          {isRunning && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-cyan-950/80 text-cyan-300 border border-cyan-800/60">
              <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />
              RUNNING
            </span>
          )}
          {isCompleted && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-800/60">
              <CheckCircle className="w-3 h-3 text-emerald-400" />
              COMPLETED
            </span>
          )}
          {isFailed && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-rose-950/80 text-rose-300 border border-rose-800/60">
              <XCircle className="w-3 h-3 text-rose-400" />
              FAILED
            </span>
          )}
          {isQueued && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-zinc-900 text-zinc-400 border border-zinc-800">
              <Clock className="w-3 h-3 text-zinc-500" />
              PENDING
            </span>
          )}

          {/* Running Timer */}
          {isRunning && elapsed > 0 && (
            <span className="text-[11px] font-mono text-zinc-500 tabular-nums">
              {formatElapsed(elapsed)}
            </span>
          )}
        </div>

        {/* Action Button: View Live Logs */}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={handleViewLiveLogs}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-200 hover:text-white border border-zinc-700/80 hover:border-cyan-500/50 shadow-sm transition-all duration-150 group"
            title="Open Live Telemetry logs for this task"
          >
            <Terminal className="w-3 h-3 text-cyan-400 group-hover:text-cyan-300 transition-colors" />
            <span>View Live Logs</span>
            <ExternalLink className="w-2.5 h-2.5 text-zinc-500 group-hover:text-zinc-300 transition-colors" />
          </button>

          {/* Collapse/Expand Toggle */}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="p-1 rounded text-zinc-500 hover:text-zinc-300 transition-colors"
            title={expanded ? 'Collapse task details' : 'Expand task details'}
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Task Prompt Preview */}
      <p className="mt-2 text-xs font-mono text-zinc-300 leading-relaxed break-words">
        {prompt}
      </p>

      {/* Dynamic Progress Bar when Running */}
      {isRunning && (
        <div className="mt-3 w-full bg-zinc-900 rounded-full h-1 overflow-hidden relative border border-zinc-800">
          <div
            className="bg-gradient-to-r from-cyan-500 to-blue-500 h-full rounded-full animate-pulse"
            style={{ width: '70%' }}
          />
        </div>
      )}

      {/* Expanded ThoughtChain step breakdown */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-zinc-800/80">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-2 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-cyan-400" />
            <span>Execution Chain</span>
          </div>
          <ThoughtChain
            items={chainItems}
            className="thought-chain-dark"
            styles={{
              root: { background: 'transparent' },
              item: { color: '#a1a1aa' },
              itemHeader: { color: '#d4d4d8' },
              itemContent: { color: '#71717a' },
            }}
          />
        </div>
      )}

      {/* Dark theme overrides for ThoughtChain */}
      <style>{`
        .thought-chain-dark .ant-thought-chain-item-title { color: #d4d4d8 !important; font-family: monospace !important; font-size: 11px !important; }
        .thought-chain-dark .ant-thought-chain-item-description { color: #71717a !important; font-size: 10px !important; }
        .thought-chain-dark .ant-thought-chain-item { border-color: #27272a !important; }
      `}</style>
    </div>
  );
}

export default TaskProgressCard;
