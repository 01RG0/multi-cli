/**
 * ChatWidget — Ultron's full agentic chat interface.
 *
 * Layout:
 *   Header: ULTRON | model badge | WS status dot
 *   Left sidebar (w-72): sessions list + active tasks from store
 *   Right: message thread + inline tool call cards + task cards
 *   Bottom: agent selector + textarea + send button
 */

import React, { useEffect, useRef, useState } from 'react';
import { MessageSquare, Plus, Zap, Cpu, CheckCircle, XCircle, ChevronDown, ChevronRight, Send, Loader2 } from 'lucide-react';
import { useSwarmStore } from '../../store/useSwarmStore';
import { useOrchestatorChat, ChatMessage } from './useOrchestatorChat';
import { AgentBadge } from './AgentBadge';

// ─── WS Status Dot ────────────────────────────────────────────────────────────

function WsDot() {
  const wsStatus = useSwarmStore((s) => s.wsStatus);
  const color =
    wsStatus === 'connected'  ? 'bg-emerald-400 shadow-emerald-400/60' :
    wsStatus === 'simulated'  ? 'bg-amber-400 shadow-amber-400/60' :
    wsStatus === 'connecting' ? 'bg-blue-400 shadow-blue-400/60 animate-pulse' :
    'bg-red-500 shadow-red-500/60';
  const label =
    wsStatus === 'connected'  ? 'Live' :
    wsStatus === 'simulated'  ? 'Sim' :
    wsStatus === 'connecting' ? 'Connecting' : 'Offline';
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-zinc-400">
      <span className={`w-2 h-2 rounded-full shadow-sm flex-shrink-0 ${color}`} />
      {label}
    </span>
  );
}

// ─── Agent Selector ───────────────────────────────────────────────────────────

const AGENTS = [
  'opencode', 'codex', 'vibe', 'agy', 'grok',
  'cline', 'kilo', 'cursor', 'researcher', 'debugger', 'jules',
];

function AgentSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 hover:border-zinc-600 transition-colors"
      >
        <AgentBadge agentId={value} size="sm" showLabel />
        <ChevronDown className="w-3 h-3 text-zinc-500" />
      </button>
      {open && (
        <div className="absolute bottom-full mb-1 left-0 z-50 w-40 rounded border border-zinc-700 bg-zinc-900 shadow-xl overflow-hidden">
          {AGENTS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => { onChange(a); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left transition-colors ${
                a === value
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
              }`}
            >
              <AgentBadge agentId={a} size="sm" showLabel />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tool Call Card ───────────────────────────────────────────────────────────

function ToolCallCard({ msg }: { msg: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  if (!msg.toolUse) return null;

  const { name, input } = msg.toolUse;
  const isDone   = msg.status === 'done';
  const isError  = msg.toolResult?.includes('"error"') ?? false;

  return (
    <div className="my-1 rounded border border-zinc-800 bg-zinc-900/60 text-xs font-mono overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-zinc-800/50 transition-colors"
      >
        <Zap className="w-3 h-3 text-amber-400 flex-shrink-0" />
        <span className="text-amber-300 font-semibold">{name}</span>
        <span className="text-zinc-600 truncate flex-1">
          {JSON.stringify(input).slice(0, 60)}
          {JSON.stringify(input).length > 60 ? '…' : ''}
        </span>
        {isDone && (
          <span className="text-zinc-500 ml-auto flex-shrink-0">
            {msg.toolDurationMs != null ? `${msg.toolDurationMs}ms` : ''}
          </span>
        )}
        {isDone && !isError  && <CheckCircle className="w-3 h-3 text-emerald-400 flex-shrink-0" />}
        {isDone && isError   && <XCircle     className="w-3 h-3 text-red-400 flex-shrink-0" />}
        {!isDone             && <Loader2     className="w-3 h-3 text-blue-400 flex-shrink-0 animate-spin" />}
        {expanded ? <ChevronDown className="w-3 h-3 text-zinc-500" /> : <ChevronRight className="w-3 h-3 text-zinc-500" />}
      </button>
      {expanded && (
        <div className="border-t border-zinc-800 px-3 py-2 space-y-2">
          <div>
            <span className="text-zinc-600 text-[10px] uppercase tracking-wider">Input</span>
            <pre className="mt-0.5 text-zinc-400 text-[10px] whitespace-pre-wrap break-all">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>
          {msg.toolResult && (
            <div>
              <span className="text-zinc-600 text-[10px] uppercase tracking-wider">Result</span>
              <pre className="mt-0.5 text-zinc-400 text-[10px] whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                {(() => {
                  try { return JSON.stringify(JSON.parse(msg.toolResult), null, 2); }
                  catch { return msg.toolResult; }
                })()}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Task Card (inline) ───────────────────────────────────────────────────────

function TaskCard({ msg }: { msg: ChatMessage }) {
  const isDone  = msg.status === 'done';
  const isError = msg.status === 'error';

  return (
    <div
      className={`my-1 flex items-start gap-2 rounded border px-3 py-2 text-xs ${
        isError
          ? 'border-red-900 bg-red-950/30 text-red-300'
          : isDone
            ? 'border-emerald-900 bg-emerald-950/30 text-emerald-300'
            : 'border-blue-900 bg-blue-950/20 text-blue-300 animate-pulse'
      }`}
    >
      <Cpu className="w-3 h-3 mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          {msg.agentId && <AgentBadge agentId={msg.agentId} size="sm" />}
          {isError && <span className="text-red-400 font-medium">Failed</span>}
          {isDone  && <span className="text-emerald-400 font-medium">Completed</span>}
          {!isDone && !isError && <span className="text-blue-400 font-medium">Running</span>}
        </div>
        <span className="text-zinc-400 font-mono break-words">{msg.content}</span>
      </div>
    </div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'tool_call') return <ToolCallCard msg={msg} />;
  if (msg.role === 'task_card') return <TaskCard msg={msg} />;

  const isUser = msg.role === 'user';

  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'} my-2`}>
      {/* Avatar */}
      {!isUser && (
        <div className="w-6 h-6 rounded-full border border-zinc-700 bg-zinc-800 flex items-center justify-center flex-shrink-0 mt-0.5">
          <MessageSquare className="w-3 h-3 text-zinc-300" />
        </div>
      )}

      {/* Bubble */}
      <div
        className={`max-w-[80%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-white text-black rounded-tr-sm'
            : msg.status === 'error'
              ? 'bg-red-950 border border-red-900 text-red-300 rounded-tl-sm'
              : 'bg-zinc-900 border border-zinc-800 text-zinc-100 rounded-tl-sm'
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
        <p className={`text-[10px] mt-1 ${isUser ? 'text-zinc-400' : 'text-zinc-600'}`}>
          {new Date(msg.timestamp).toLocaleTimeString()}
        </p>
      </div>
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function ChatSidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
}: {
  sessions: ReturnType<typeof useOrchestatorChat>['sessions'];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
}) {
  const tasks   = useSwarmStore((s) => s.tasks);
  const running = tasks.filter((t) => t.status === 'running').slice(0, 6);

  return (
    <aside className="w-72 flex-shrink-0 border-r border-zinc-800 bg-zinc-950 flex flex-col min-h-0 overflow-hidden">
      {/* Sessions header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-900">
        <span className="text-[10px] font-mono font-semibold text-zinc-500 uppercase tracking-wider">Sessions</span>
        <button
          type="button"
          onClick={onNewSession}
          className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-white transition-colors rounded px-1.5 py-0.5 hover:bg-zinc-800"
        >
          <Plus className="w-3 h-3" />
          New
        </button>
      </div>

      {/* Sessions list */}
      <div className="flex-shrink-0 overflow-y-auto" style={{ maxHeight: '160px' }}>
        {sessions.length === 0 && (
          <p className="px-3 py-2 text-[10px] text-zinc-600 font-mono">No sessions yet</p>
        )}
        {sessions.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelectSession(s.id)}
            className={`w-full text-left px-3 py-2 transition-colors border-b border-zinc-900/50 ${
              s.id === activeSessionId
                ? 'bg-zinc-800 text-white'
                : 'text-zinc-400 hover:bg-zinc-900 hover:text-white'
            }`}
          >
            <p className="text-xs font-mono truncate">{s.title}</p>
            {s.lastMessage && (
              <p className="text-[10px] text-zinc-600 truncate mt-0.5">{s.lastMessage}</p>
            )}
          </button>
        ))}
      </div>

      {/* Active tasks */}
      <div className="flex items-center px-3 py-2 border-b border-zinc-900 border-t border-t-zinc-800 mt-auto">
        <span className="text-[10px] font-mono font-semibold text-zinc-500 uppercase tracking-wider">Active Tasks</span>
        <span className="ml-auto text-[10px] font-mono text-zinc-600">{running.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {running.length === 0 && (
          <p className="px-3 py-2 text-[10px] text-zinc-600 font-mono">No running tasks</p>
        )}
        {running.map((t) => (
          <div
            key={t.id}
            className="flex items-start gap-2 px-3 py-2 border-b border-zinc-900/50 text-[10px] font-mono"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0 mt-1 animate-pulse" />
            <div className="min-w-0">
              <AgentBadge agentId={t.agentId} size="sm" />
              <p className="text-zinc-500 truncate mt-0.5">#{t.id.slice(0, 8)} {t.prompt.slice(0, 35)}{t.prompt.length > 35 ? '…' : ''}</p>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

// ─── Main ChatWidget ──────────────────────────────────────────────────────────

export function ChatWidget() {
  const {
    messages,
    sessions,
    activeSessionId,
    isLoading,
    selectedAgentId,
    setSelectedAgentId,
    sendMessage,
    startNewSession,
    selectSession,
  } = useOrchestatorChat();

  const [input, setInput]       = useState('');
  const messagesEndRef           = useRef<HTMLDivElement>(null);
  const textareaRef              = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    await sendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  };

  return (
    <div className="flex flex-col h-full bg-black text-white overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-800 bg-zinc-950 shrink-0">
        <span className="font-bold text-white tracking-wider text-sm">ULTRON</span>
        <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] font-mono text-zinc-500">
          claude-sonnet-4-6
        </span>
        <span className="ml-auto">
          <WsDot />
        </span>
      </div>

      {/* ── Body: sidebar + thread ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Sidebar */}
        <ChatSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={selectSession}
          onNewSession={startNewSession}
        />

        {/* Message thread + input */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

          {/* Thread */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-600">
                <MessageSquare className="w-8 h-8" />
                <p className="text-sm font-mono">Ultron is ready. Send a message to begin.</p>
                <p className="text-xs">Try: "search memory for auth" or "dispatch a research task"</p>
              </div>
            )}
            {messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}
            {isLoading && (
              <div className="flex gap-2.5 my-2">
                <div className="w-6 h-6 rounded-full border border-zinc-700 bg-zinc-800 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <MessageSquare className="w-3 h-3 text-zinc-300" />
                </div>
                <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-xl rounded-tl-sm px-3.5 py-2.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* ── Sender bar ── */}
          <div className="border-t border-zinc-800 bg-zinc-950 px-3 py-2.5 shrink-0">
            <div className="flex items-end gap-2">
              <AgentSelector value={selectedAgentId} onChange={setSelectedAgentId} />
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
                placeholder="Message Ultron… (Enter to send, Shift+Enter for newline)"
                className="flex-1 min-w-0 resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-zinc-500 transition-colors disabled:opacity-50 leading-relaxed"
                style={{ minHeight: '36px', maxHeight: '120px' }}
              />
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={!input.trim() || isLoading}
                className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-lg bg-white text-black hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                aria-label="Send message"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

export default ChatWidget;
