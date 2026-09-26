import React, { useState, useEffect } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Zap,
  CheckCircle,
  XCircle,
  Loader2,
  Database,
  Terminal,
  Cpu,
  Puzzle,
  Clock,
  Sparkles,
  Search,
  Check,
  Copy,
} from 'lucide-react';
import type { ChatMessage } from './useOrchestatorChat';

export interface ThoughtChainCardProps {
  /** Single tool call message or multiple tool calls in this reasoning chain */
  messages: ChatMessage[];
  defaultExpanded?: boolean;
}

function getToolIcon(name: string) {
  if (name.includes('memory')) return <Database className="w-3.5 h-3.5 text-cyan-400" />;
  if (name.includes('task') || name.includes('pipeline')) return <Terminal className="w-3.5 h-3.5 text-purple-400" />;
  if (name.includes('mcp')) return <Puzzle className="w-3.5 h-3.5 text-emerald-400" />;
  if (name.includes('skill')) return <Sparkles className="w-3.5 h-3.5 text-amber-400" />;
  if (name.includes('search')) return <Search className="w-3.5 h-3.5 text-blue-400" />;
  return <Zap className="w-3.5 h-3.5 text-amber-400" />;
}

function formatDuration(ms?: number): string {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

interface StepItemProps {
  msg: ChatMessage;
}

function StepItem({ msg }: StepItemProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!msg.toolUse) return null;

  const { name, input } = msg.toolUse;
  const isDone = msg.status === 'done';
  const isError = msg.status === 'error' || (msg.toolResult?.includes('"error"') ?? false);

  const handleCopy = (e: React.MouseEvent, content: string) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="border-b border-zinc-800/60 last:border-b-0">
      <button
        type="button"
        onClick={() => setDetailOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-zinc-900/60 transition-colors text-xs font-mono"
      >
        <span className="flex-shrink-0">{getToolIcon(name)}</span>
        <span className="text-zinc-200 font-semibold truncate">
          {name}
        </span>
        <span className="text-zinc-500 truncate flex-1 text-[11px] hidden sm:inline">
          {JSON.stringify(input).slice(0, 50)}
          {JSON.stringify(input).length > 50 ? '…' : ''}
        </span>

        {isDone && (
          <span className="text-[10px] text-zinc-500 ml-auto flex-shrink-0 tabular-nums">
            {formatDuration(msg.toolDurationMs)}
          </span>
        )}

        {isDone && !isError && (
          <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
        )}
        {isDone && isError && (
          <XCircle className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
        )}
        {!isDone && (
          <Loader2 className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0 animate-spin" />
        )}

        <span className="text-zinc-500">
          {detailOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
      </button>

      {detailOpen && (
        <div className="px-3 pb-3 pt-1 space-y-2.5 bg-black/40 text-[11px] font-mono border-t border-zinc-900">
          {/* Input block */}
          <div>
            <div className="flex items-center justify-between text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
              <span>Input Parameters</span>
              <button
                type="button"
                onClick={(e) => handleCopy(e, JSON.stringify(input, null, 2))}
                className="hover:text-zinc-300 transition-colors flex items-center gap-1"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <pre className="p-2 rounded bg-zinc-900/80 border border-zinc-800 text-zinc-300 overflow-x-auto max-h-36 whitespace-pre-wrap break-all leading-relaxed">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>

          {/* Result block */}
          {msg.toolResult && (
            <div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
                Execution Output
              </div>
              <pre className="p-2 rounded bg-zinc-900/80 border border-zinc-800 text-zinc-400 overflow-x-auto max-h-48 whitespace-pre-wrap break-all leading-relaxed">
                {(() => {
                  try {
                    return JSON.stringify(JSON.parse(msg.toolResult), null, 2);
                  } catch {
                    return msg.toolResult;
                  }
                })()}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ThoughtChainCard({ messages, defaultExpanded }: ThoughtChainCardProps) {
  const isAnyRunning = messages.some((m) => m.status === 'streaming' || m.status === 'loading');
  const [expanded, setExpanded] = useState<boolean>(defaultExpanded ?? isAnyRunning);

  // Auto-expand when a tool is running
  useEffect(() => {
    if (isAnyRunning) {
      setExpanded(true);
    }
  }, [isAnyRunning]);

  const totalDuration = messages.reduce((acc, m) => acc + (m.toolDurationMs || 0), 0);
  const toolCount = messages.length;

  return (
    <div className="my-2 rounded-xl border border-zinc-800/80 bg-zinc-950/70 overflow-hidden shadow-sm transition-all duration-200 hover:border-zinc-700/80">
      {/* Accordion Header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3.5 py-2.5 bg-zinc-900/40 hover:bg-zinc-900/70 transition-colors text-left select-none"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded-md bg-cyan-950/50 border border-cyan-800/40 flex items-center justify-center flex-shrink-0">
            {isAnyRunning ? (
              <Loader2 className="w-3 h-3 text-cyan-400 animate-spin" />
            ) : (
              <Cpu className="w-3 h-3 text-cyan-400" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-zinc-200 tracking-wide font-mono">
                {isAnyRunning ? 'Orchestration Pipeline Running' : 'Orchestration Pipeline'}
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700/50 font-mono">
                {toolCount} {toolCount === 1 ? 'step' : 'steps'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-shrink-0 text-xs font-mono">
          {totalDuration > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-zinc-500 tabular-nums">
              <Clock className="w-3 h-3 text-zinc-600" />
              {formatDuration(totalDuration)}
            </span>
          )}
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
              isAnyRunning
                ? 'bg-cyan-950 text-cyan-400 border border-cyan-800/50 animate-pulse'
                : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
            }`}
          >
            {isAnyRunning ? 'Thinking...' : 'Completed'}
          </span>
          <span className="text-zinc-500 transition-transform duration-200">
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </span>
        </div>
      </button>

      {/* Accordion Body */}
      {expanded && (
        <div className="border-t border-zinc-800/60 divide-y divide-zinc-800/40">
          {messages.map((m) => (
            <StepItem key={m.id} msg={m} />
          ))}
        </div>
      )}
    </div>
  );
}

export default ThoughtChainCard;
