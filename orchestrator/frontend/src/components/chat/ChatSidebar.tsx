import React from 'react';
import { Plus } from 'lucide-react';
import { useSwarmStore } from '../../store/useSwarmStore';
import type { ChatSession } from './useOrchestatorChat';
import { relativeTime } from './useOrchestatorChat';
import { AgentBadge } from './AgentBadge';

interface ChatSidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
}

export function ChatSidebar({ sessions, activeSessionId, onSelectSession, onNewChat }: ChatSidebarProps) {
  const tasks   = useSwarmStore((s) => s.tasks);
  const running = tasks.filter((t) => t.status === 'running').slice(0, 8);

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: '#0a0a0b', borderRight: '1px solid #27272a' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-zinc-800 shrink-0">
        <span className="text-xs font-mono font-semibold text-zinc-400 uppercase tracking-widest">
          Conversations
        </span>
        <button
          onClick={onNewChat}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors duration-150 font-mono"
        >
          <Plus className="w-3 h-3" />
          New conversation
        </button>
      </div>

      {/* Sessions list */}
      <div className="shrink-0 overflow-y-auto" style={{ maxHeight: '220px' }}>
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 gap-2 text-zinc-600 text-xs font-mono">
            <span>No conversations yet</span>
            <button
              onClick={onNewChat}
              className="text-cyan-500 hover:text-cyan-400 transition-colors"
            >
              Start a chat →
            </button>
          </div>
        ) : (
          sessions.map((s) => {
            const isActive = s.id === activeSessionId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelectSession(s.id)}
                className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-b transition-colors ${
                  isActive
                    ? 'bg-zinc-800/80 border-b-zinc-700 border-l-2 border-l-zinc-400'
                    : 'border-b-zinc-900 hover:bg-zinc-900'
                }`}
              >
                {/* Ω avatar */}
                <div className="w-6 h-6 rounded-full bg-black border border-zinc-600 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-white">
                  Ω
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-xs font-mono truncate ${isActive ? 'text-white' : 'text-zinc-300'}`}>
                    {s.title}
                  </p>
                  <p className="text-[10px] text-zinc-600 truncate mt-0.5">
                    {s.lastMessage || (isActive ? 'active' : 'idle')} · {relativeTime(s.updatedAt)}
                  </p>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Active tasks divider */}
      <div className="flex items-center px-3 py-2 border-b border-zinc-800 border-t border-t-zinc-800/60 bg-zinc-950/60">
        <span className="text-[10px] font-mono font-semibold text-zinc-500 uppercase tracking-widest">
          Active Tasks
        </span>
        <span className="ml-auto text-[10px] font-mono text-zinc-600">{running.length}</span>
      </div>

      {/* Active tasks list */}
      <div className="flex-1 overflow-y-auto">
        {running.length === 0 ? (
          <p className="px-3 py-3 text-[10px] text-zinc-700 font-mono">No running tasks</p>
        ) : (
          running.map((t) => (
            <div
              key={t.id}
              className="flex items-start gap-2 px-3 py-2 border-b border-zinc-900/50 text-[10px] font-mono"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0 mt-1 animate-pulse" />
              <div className="min-w-0">
                <AgentBadge agentId={t.agentId} size="sm" />
                <p className="text-zinc-500 truncate mt-0.5">
                  #{t.id.slice(0, 8)} {t.prompt.slice(0, 35)}{t.prompt.length > 35 ? '…' : ''}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
