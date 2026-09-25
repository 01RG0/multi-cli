/**
 * ChatWidget — Redesigned Ultron Agentic Chat Experience.
 *
 * Direct inspiration and patterns from Ant Design X (@ant-design/x) & Ekko Studio:
 * - Collapsible ThoughtChain / Orchestration Pipeline for reasoning and tool execution
 * - Ekko Studio Multi-Agent Task Progress Cards with 1-click "View Live Logs"
 * - Welcome & Quick Prompts banner on new/empty sessions
 * - Modern high-contrast message bubbles with full Action Toolbar (Copy, Thumbs Up/Down, Retry, Token & Latency metadata)
 * - Enhanced multi-modal sender bar with file attachment staging tray, voice notes, and stop generation
 * - Polished session sidebar with search filter, active glow, renaming, deletion, and background task telemetry
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  Sidebar,
  Menu,
  Plus,
  Zap,
  Terminal,
  Cpu,
  CheckCircle,
  XCircle,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { useSwarmStore } from '../../store/useSwarmStore';
import { useOrchestatorChat, ChatMessage, FileAttachment } from './useOrchestatorChat';
import { ChatSidebar } from './ChatSidebar';
import { UltronWelcome } from './UltronWelcome';
import { MessageBubble } from './MessageBubble';
import { ThoughtChainCard } from './ThoughtChainCard';
import { TaskProgressCard } from './TaskProgressCard';
import { ChatSender } from './ChatSender';
import { UltronIcon } from './UltronIcon';

// ─── WebSocket Status Indicator ────────────────────────────────────────────────

function WsStatusPill() {
  const wsStatus = useSwarmStore((s) => s.wsStatus);
  const color =
    wsStatus === 'connected'  ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' :
    wsStatus === 'simulated'  ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]' :
    wsStatus === 'connecting' ? 'bg-cyan-400 animate-pulse' :
    'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]';

  const label =
    wsStatus === 'connected'  ? 'WS Connected' :
    wsStatus === 'simulated'  ? 'WS Simulated' :
    wsStatus === 'connecting' ? 'Connecting...' : 'Offline';

  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-[10px] font-mono text-zinc-300 select-none">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color}`} />
      <span>{label}</span>
    </div>
  );
}

// ─── Grouped Render Item Definition ───────────────────────────────────────────

type RenderItem =
  | { type: 'message'; msg: ChatMessage }
  | { type: 'tool_group'; id: string; messages: ChatMessage[] }
  | { type: 'task'; msg: ChatMessage };

export function ChatWidget() {
  const {
    messages,
    sessions,
    activeSessionId,
    isLoading,
    sendMessage,
    startNewSession,
    selectSession,
    deleteSession,
    renameSession,
    stopGeneration,
    regenerate,
    recordFeedback,
  } = useOrchestatorChat();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [stagedPrompt, setStagedPrompt] = useState('');

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Group consecutive tool_call messages into unified ThoughtChain blocks
  const renderItems = useMemo<RenderItem[]>(() => {
    const items: RenderItem[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role === 'tool_call') {
        const group: ChatMessage[] = [m];
        while (i + 1 < messages.length && messages[i + 1].role === 'tool_call') {
          i++;
          group.push(messages[i]);
        }
        items.push({
          type: 'tool_group',
          id: group[0].id,
          messages: group,
        });
      } else if (m.role === 'task_card') {
        items.push({ type: 'task', msg: m });
      } else {
        items.push({ type: 'message', msg: m });
      }
    }
    return items;
  }, [messages]);

  const handleSendPrompt = async (text: string, attachments?: FileAttachment[]) => {
    setStagedPrompt('');
    await sendMessage(text, attachments);
  };

  const handleQuickPromptClick = (promptText: string) => {
    // Automatically send quick prompt
    void sendMessage(promptText);
  };

  return (
    <div className="flex flex-col h-full bg-black text-white overflow-hidden font-sans">
      {/* ── Top Header ── */}
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 bg-zinc-950 shrink-0 select-none">
        <div className="flex items-center gap-3">
          {/* Sidebar Toggle Button */}
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-900 border border-transparent hover:border-zinc-800 transition-colors"
            title={sidebarOpen ? 'Hide conversations sidebar' : 'Show conversations sidebar'}
          >
            <Menu className="w-4 h-4" />
          </button>

          {/* Ultron Branding */}
          <div className="flex items-center gap-2.5">
            <UltronIcon size="sm" pulse={isLoading} status={isLoading ? 'busy' : 'online'} />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white tracking-wider text-sm font-mono">
                  ULTRON
                </span>
                <span className="text-[10px] font-mono px-2 py-0.2 rounded-full bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 hidden sm:inline">
                  ORCHESTRATOR
                </span>
              </div>
              <span className="text-[10px] font-mono text-zinc-500 hidden sm:block">
                Claude 3.7 Sonnet · AWS Bedrock Proxy
              </span>
            </div>
          </div>
        </div>

        {/* Right Status Indicators */}
        <div className="flex items-center gap-2.5">
          <WsStatusPill />
          <button
            type="button"
            onClick={startNewSession}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-800 text-xs font-mono transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">New Chat</span>
          </button>
        </div>
      </header>

      {/* ── Main Workspace: Sidebar + Conversation Thread ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Collapsible Sidebar */}
        {sidebarOpen && (
          <ChatSidebar
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelectSession={selectSession}
            onNewChat={startNewSession}
            onDeleteSession={deleteSession}
            onRenameSession={renameSession}
          />
        )}

        {/* Conversation Thread & Multi-Modal Sender */}
        <main className="flex flex-col flex-1 min-w-0 overflow-hidden bg-black/60">
          {/* Messages Stream */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1.5 min-h-0">
            {messages.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <UltronWelcome onSelectPrompt={handleQuickPromptClick} />
              </div>
            ) : (
              renderItems.map((item) => {
                if (item.type === 'message') {
                  return (
                    <MessageBubble
                      key={item.msg.id}
                      msg={item.msg}
                      onRegenerate={regenerate}
                      onFeedback={recordFeedback}
                    />
                  );
                }

                if (item.type === 'tool_group') {
                  return (
                    <ThoughtChainCard
                      key={item.id}
                      messages={item.messages}
                    />
                  );
                }

                if (item.type === 'task') {
                  return (
                    <TaskProgressCard
                      key={item.msg.id}
                      taskId={item.msg.taskId || item.msg.id}
                      agentId={item.msg.agentId || 'agent'}
                      prompt={item.msg.content.replace(/^ULTRON (dispatched|completed|failed) → [^:]+: /, '')}
                      status={
                        item.msg.status === 'done'
                          ? 'completed'
                          : item.msg.status === 'error'
                            ? 'failed'
                            : 'running'
                      }
                    />
                  );
                }

                return null;
              })
            )}

            {/* Generating Pulse Indicator */}
            {isLoading && (
              <div className="flex items-center gap-3 my-2 px-1">
                <UltronIcon size="sm" pulse status="busy" />
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-400">
                  <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
                  <span>Ultron is orchestrating thoughts & tools...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* ── Multi-Modal Sender Bar ── */}
          <ChatSender
            isLoading={isLoading}
            onSend={handleSendPrompt}
            onStop={stopGeneration}
            initialValue={stagedPrompt}
          />
        </main>
      </div>
    </div>
  );
}

export default ChatWidget;
