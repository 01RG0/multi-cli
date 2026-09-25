import React, { useState } from 'react';
import { useSwarmStore } from '../store/useSwarmStore';
import { Send, Copy, Check, Terminal, Cpu, Bot, User, Clock, Shield } from 'lucide-react';

export const TaskExecutionChat: React.FC = () => {
  const store = useSwarmStore();
  const selectedAgentId = store.selectedAgentId || 'opencode';
  const agent = store.agents.find((a) => a.id === selectedAgentId) || store.agents[0] || {
    name: 'opencode',
    tokensUsed: 220000,
    status: 'running',
  };

  const [inputMessage, setInputMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'agent'; text: string; code?: string }>>([
    {
      role: 'user',
      text: 'Dispatching task #47: Inspect SQLite temporal graph and synthesize active agent memory schema.',
    },
    {
      role: 'agent',
      text: 'Orchestrating agent sub-routine across temporal knowledge graph...',
      code: `func QueryTemporalContext(ctx context.Context, db *sql.DB, taskId string) ([]Node, error) {
    query := \`SELECT id, label, valid_at FROM graph_nodes WHERE valid_at <= ? AND (invalid_at IS NULL OR invalid_at > ?)\`
    return db.QueryContext(ctx, query, time.Now(), time.Now())
}`,
    },
    {
      role: 'agent',
      text: 'Completed graph traversal. Sub-agents opencode and codex reporting nominal execution status.',
    },
  ]);

  const handleSend = () => {
    if (!inputMessage.trim()) return;
    setMessages((prev) => [...prev, { role: 'user', text: inputMessage }]);
    setInputMessage('');
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          role: 'agent',
          text: `Acknowledged directive. Agent @${selectedAgentId} executing sub-routine with high priority.`,
        },
      ]);
    }, 800);
  };

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full bg-black border border-zinc-800 rounded-lg overflow-hidden font-mono text-xs">
      {/* Top Metadata Header (Image 1 Top Right) */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 bg-zinc-950 select-none">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
          <span className="font-bold text-white text-[11px] tracking-wider uppercase">
            TASK #40505600
          </span>
          <span className="text-[10px] text-zinc-500">11:12:35 PM</span>
        </div>

        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-zinc-400">AGENT: <span className="text-white font-bold">{selectedAgentId}</span></span>
          <span className="text-zinc-400">TOKENS: <span className="text-white font-bold">{agent.tokensUsed.toLocaleString()}</span></span>
          <button className="px-2 py-0.5 border border-zinc-700 hover:border-zinc-500 rounded text-zinc-300 hover:text-white transition">
            Cancel
          </button>
        </div>
      </div>

      {/* Chat Messages Stream */}
      <div className="relative flex-1 min-h-0">
      <div className="absolute inset-0 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-zinc-800 bg-black">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex flex-col ${
              msg.role === 'user' ? 'items-end' : 'items-start'
            }`}
          >
            {/* Sender Label */}
            <div className="flex items-center gap-1.5 mb-1 text-[10px] text-zinc-500 select-none">
              {msg.role === 'user' ? (
                <>
                  <span>OPERATOR</span>
                  <User className="w-3 h-3 text-zinc-400" />
                </>
              ) : (
                <>
                  <Bot className="w-3 h-3 text-white" />
                  <span className="text-white font-bold">{selectedAgentId}</span>
                  <span className="text-[9px] px-1 bg-zinc-900 border border-zinc-800 text-zinc-400 rounded">tps #111</span>
                </>
              )}
            </div>

            {/* Bubble */}
            <div
              className={`max-w-[85%] p-3 rounded-lg leading-relaxed select-text ${
                msg.role === 'user'
                  ? 'bg-zinc-900 border border-zinc-700 text-white rounded-tr-none'
                  : 'bg-zinc-950 border border-zinc-800 text-zinc-200 rounded-tl-none'
              }`}
            >
              <p className="text-xs">{msg.text}</p>

              {/* Code Snippet Box with Copy Button */}
              {msg.code && (
                <div className="mt-3 relative bg-black border border-zinc-800 rounded p-2.5 font-mono text-[11px] text-zinc-300 overflow-x-auto">
                  <div className="flex justify-between items-center pb-1 mb-2 border-b border-zinc-900 select-none">
                    <span className="text-[10px] text-zinc-500">Go • temporal_memory.go</span>
                    <button
                      onClick={() => handleCopy(msg.code!)}
                      className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-white transition"
                    >
                      {copied ? <Check className="w-3 h-3 text-white" /> : <Copy className="w-3 h-3" />}
                      <span>{copied ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                  <pre className="selection:bg-white selection:text-black">
                    <code>{msg.code}</code>
                  </pre>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      </div>

      {/* Input Prompt Box (Image 1 Bottom) */}
      <div className="p-3 border-t border-zinc-800 bg-zinc-950">
        <div className="flex items-center gap-2 bg-black border border-zinc-800 focus-within:border-zinc-600 rounded-lg px-3 py-1.5 transition">
          <span className="text-zinc-500 font-bold select-none">&gt;</span>
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Continue task or send instruction..."
            className="flex-1 bg-transparent text-white placeholder-zinc-600 outline-none text-xs"
          />
          <button
            onClick={handleSend}
            className="p-1.5 bg-white hover:bg-zinc-200 text-black rounded transition cursor-pointer active:scale-95"
            title="Send"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default TaskExecutionChat;
