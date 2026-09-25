import React from 'react';
import { ChatList } from 'react-chat-elements';
import 'react-chat-elements/dist/main.css';
import type { ChatSession } from './useOrchestatorChat';
import { relativeTime } from './useOrchestatorChat';

// Agent initials map
const AGENT_INITIALS: Record<string, string> = {
  opencode:   'O',
  codex:      'C',
  vibe:       'V',
  agy:        'A',
  cline:      'CL',
  grok:       'G',
  kilo:       'K',
  cursor:     'CR',
  researcher: 'R',
  debugger:   'D',
  jules:      'J',
};

// Status → color mapping
const STATUS_COLOR: Record<ChatSession['status'], string> = {
  running:   '#22d3ee',  // cyan-400
  completed: '#4ade80',  // green-400
  failed:    '#f87171',  // red-400
  queued:    '#71717a',  // zinc-500
  idle:      '#52525b',  // zinc-600
};

interface ChatSidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
}

export function ChatSidebar({ sessions, activeSessionId, onSelectSession, onNewChat }: ChatSidebarProps) {
  // Build ChatList dataSource
  const dataSource = sessions.map((s) => {
    const initials = AGENT_INITIALS[s.agentId] ?? s.agentId.slice(0, 2).toUpperCase();
    const isRunning = s.status === 'running';

    return {
      id: s.id,
      // react-chat-elements expects a string avatar URL; we'll override via letterItem
      avatar: '',
      letterItem: {
        id: s.id,
        letter: initials,
      },
      title: s.title,
      subtitle: s.lastMessage || 'No messages yet',
      date: new Date(s.updatedAt),
      dateString: relativeTime(s.updatedAt),
      statusColor: STATUS_COLOR[s.status],
      // className carries the pulse animation for running sessions
      className: isRunning ? 'rce-running' : '',
      unread: 0,
      onClick: () => onSelectSession(s.id),
    };
  });

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: '#0a0a0b', borderRight: '1px solid #27272a' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-zinc-800 shrink-0">
        <span className="text-xs font-mono font-semibold text-zinc-400 uppercase tracking-widest">
          Sessions
        </span>
        <button
          onClick={onNewChat}
          className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors duration-150 font-mono"
        >
          + New
        </button>
      </div>

      {/* ChatList */}
      <div className="flex-1 overflow-y-auto rce-dark-override">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-zinc-600 text-xs font-mono">
            <span>No sessions yet</span>
            <button
              onClick={onNewChat}
              className="text-cyan-500 hover:text-cyan-400 transition-colors"
            >
              Start a chat →
            </button>
          </div>
        ) : (
          <ChatList
            className="chat-list-dark"
            dataSource={dataSource}
            id="orchestrator-chat-list"
            // @ts-expect-error — react-chat-elements' selectedId prop varies by version
            selectedId={activeSessionId ?? undefined}
          />
        )}
      </div>

      {/* Pulse animation + dark theme override (injected as a style tag) */}
      <style>{`
        .rce-dark-override .rce-citem {
          background: #0a0a0b !important;
          border-bottom: 1px solid #27272a !important;
          cursor: pointer;
          transition: background 150ms;
        }
        .rce-dark-override .rce-citem:hover {
          background: #18181b !important;
        }
        .rce-dark-override .rce-citem.rce-citem-active,
        .rce-dark-override .rce-citem[data-selected="true"] {
          background: #1f1f22 !important;
          border-left: 2px solid #22d3ee !important;
        }
        .rce-dark-override .rce-citem-body--top-title {
          color: #f4f4f5 !important;
          font-size: 12px !important;
        }
        .rce-dark-override .rce-citem-body--bottom-title {
          color: #71717a !important;
          font-size: 11px !important;
        }
        .rce-dark-override .rce-citem-body--top-time {
          color: #52525b !important;
          font-size: 10px !important;
        }
        .rce-dark-override .rce-avatar-container {
          background: #27272a !important;
        }
        .rce-dark-override .rce-letter-avatar {
          background: #3f3f46 !important;
          color: #d4d4d8 !important;
          font-size: 11px !important;
          font-weight: 600 !important;
        }
        .rce-dark-override .rce-running .rce-avatar-container {
          animation: pulse 1.5s cubic-bezier(0.4,0,0.6,1) infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
