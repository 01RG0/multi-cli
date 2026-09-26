/**
 * ChatSidebar — Sessions Sidebar with Search Filter, Renaming, Deletion, and Task Tracking.
 *
 * Implements:
 * - Search filter input to quickly locate conversations
 * - Active session highlighting with glowing accent indicator
 * - Inline session renaming & delete action buttons
 * - Active background tasks counter and telemetry list
 * - New conversation button
 */

import React, { useState } from 'react';
import {
  Plus,
  Search,
  Trash2,
  Edit2,
  Check,
  X,
  MessageSquare,
  Cpu,
  Clock,
  ExternalLink,
} from 'lucide-react';
import { useSwarmStore } from '../../store/useSwarmStore';
import type { ChatSession } from './useOrchestatorChat';
import { relativeTime } from './useOrchestatorChat';
import { AgentBadge } from './AgentBadge';

interface ChatSidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, newTitle: string) => void;
}

export function ChatSidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  onRenameSession,
}: ChatSidebarProps) {
  const tasks   = useSwarmStore((s) => s.tasks);
  const running = tasks.filter((t) => t.status === 'running');

  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [editTitle, setEditTitle]     = useState('');

  // Filter sessions by search term
  const filteredSessions = sessions.filter((s) =>
    s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (s.lastMessage && s.lastMessage.toLowerCase().includes(searchQuery.toLowerCase())),
  );

  const startEditing = (s: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(s.id);
    setEditTitle(s.title);
  };

  const saveEditing = (id: string, e?: React.MouseEvent | React.FormEvent) => {
    e?.stopPropagation();
    if (editTitle.trim()) {
      onRenameSession(id, editTitle.trim());
    }
    setEditingId(null);
  };

  const cancelEditing = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onDeleteSession(id);
  };

  const handleTaskClick = (taskId: string) => {
    useSwarmStore.getState().setSelectedLogTaskId(taskId);
    window.dispatchEvent(new CustomEvent('ultron:switch-tab', { detail: 'logs' }));
  };

  return (
    <aside className="w-72 flex-shrink-0 border-r border-zinc-800/80 bg-zinc-950 flex flex-col min-h-0 select-none">
      {/* Top Header: Sessions + New Button */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-zinc-900 shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-3.5 h-3.5 text-zinc-400" />
          <span className="text-[11px] font-mono font-semibold text-zinc-300 uppercase tracking-wider">
            Conversations
          </span>
        </div>
        <button
          type="button"
          onClick={onNewChat}
          className="flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors shadow-sm"
          title="Start new conversation"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New</span>
        </button>
      </div>

      {/* Search Filter Input */}
      <div className="px-3 py-2 border-b border-zinc-900/60 shrink-0">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 absolute left-2.5 text-zinc-500 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter sessions..."
            className="w-full bg-zinc-900/80 border border-zinc-800/80 rounded-lg pl-8 pr-7 py-1 text-xs text-white placeholder-zinc-500 outline-none focus:border-zinc-700 transition-colors font-mono"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 text-zinc-500 hover:text-zinc-300"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-zinc-900/60">
        {filteredSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center px-4">
            <p className="text-xs font-mono text-zinc-500">
              {searchQuery ? 'No matching conversations' : 'No conversations yet'}
            </p>
            {!searchQuery && (
              <button
                type="button"
                onClick={onNewChat}
                className="mt-2 text-xs font-mono text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                Start a conversation →
              </button>
            )}
          </div>
        ) : (
          filteredSessions.map((s) => {
            const isActive = s.id === activeSessionId;
            const isEditing = s.id === editingId;

            return (
              <div
                key={s.id}
                onClick={() => onSelectSession(s.id)}
                className={`group relative w-full text-left px-3 py-2.5 flex items-start gap-2.5 cursor-pointer transition-all duration-150 ${
                  isActive
                    ? 'bg-zinc-900/90 text-white'
                    : 'text-zinc-400 hover:bg-zinc-900/40 hover:text-zinc-200'
                }`}
              >
                {/* Active Indicator Bar */}
                {isActive && (
                  <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
                )}

                {/* Avatar Icon */}
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold mt-0.5 ${
                    isActive
                      ? 'bg-cyan-950 border border-cyan-700/60 text-cyan-300'
                      : 'bg-black border border-zinc-800 text-zinc-400'
                  }`}
                >
                  Ω
                </div>

                {/* Info & Inline Edit */}
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <form
                      onSubmit={(e) => saveEditing(s.id, e)}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1"
                    >
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        autoFocus
                        className="w-full bg-zinc-950 border border-cyan-600 rounded px-1.5 py-0.5 text-xs text-white outline-none font-mono"
                      />
                      <button
                        type="submit"
                        className="p-1 text-emerald-400 hover:text-emerald-300"
                        title="Save"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditing}
                        className="p-1 text-zinc-500 hover:text-zinc-300"
                        title="Cancel"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </form>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <p className={`text-xs font-mono truncate font-medium ${isActive ? 'text-white' : 'text-zinc-300'}`}>
                          {s.title}
                        </p>
                      </div>
                      <p className="text-[10px] text-zinc-500 truncate mt-0.5">
                        {s.lastMessage || (isActive ? 'active session' : 'empty')} · {relativeTime(s.updatedAt)}
                      </p>
                    </>
                  )}
                </div>

                {/* Action Buttons on Hover */}
                {!isEditing && (
                  <div className="hidden group-hover:flex items-center gap-1 shrink-0 ml-1">
                    <button
                      type="button"
                      onClick={(e) => startEditing(s, e)}
                      className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
                      title="Rename conversation"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleDelete(s.id, e)}
                      className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-rose-400 transition-colors"
                      title="Delete conversation"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Active Tasks Panel at Bottom */}
      <div className="border-t border-zinc-900 bg-zinc-950 shrink-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-900/60 bg-zinc-900/30">
          <div className="flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-[10px] font-mono font-semibold text-zinc-400 uppercase tracking-wider">
              Background Tasks
            </span>
          </div>
          <span
            className={`text-[10px] font-mono font-medium px-1.5 py-0.2 rounded-full ${
              running.length > 0
                ? 'bg-cyan-950 text-cyan-400 border border-cyan-800/40'
                : 'bg-zinc-900 text-zinc-500 border border-zinc-800'
            }`}
          >
            {running.length} {running.length === 1 ? 'active' : 'active'}
          </span>
        </div>

        <div className="overflow-y-auto max-h-40 divide-y divide-zinc-900/40">
          {running.length === 0 ? (
            <p className="px-3 py-2.5 text-[10px] text-zinc-600 font-mono">No background tasks running</p>
          ) : (
            running.slice(0, 6).map((t) => (
              <div
                key={t.id}
                onClick={() => handleTaskClick(t.id)}
                className="group flex items-start gap-2 px-3 py-2 hover:bg-zinc-900/50 cursor-pointer transition-colors text-[10px] font-mono"
                title="Click to view live logs"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1 flex-shrink-0 animate-pulse" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <AgentBadge agentId={t.agentId} size="sm" />
                    <span className="text-zinc-500">#{t.id.slice(0, 6)}</span>
                  </div>
                  <p className="text-zinc-400 truncate mt-0.5">{t.prompt}</p>
                </div>
                <ExternalLink className="w-3 h-3 text-zinc-600 group-hover:text-cyan-400 transition-colors shrink-0 mt-1" />
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}

export default ChatSidebar;
