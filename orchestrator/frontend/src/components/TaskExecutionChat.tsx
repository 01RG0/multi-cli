import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useSwarmStore } from '../store/useSwarmStore';
import { Send, Terminal, ChevronDown, CheckCircle, XCircle, Loader2, Clock, AlertCircle } from 'lucide-react';

interface Dispatch {
  localId: string;
  taskId: string | null;
  prompt: string;
  agentId: string;
  timestamp: number;
  error?: string;
}

const STATUS_CONFIG = {
  pending:   { color: 'text-zinc-400',    border: 'border-zinc-800',    icon: <Clock size={10} />,                                   label: 'PENDING'   },
  running:   { color: 'text-emerald-400', border: 'border-emerald-900', icon: <Loader2 size={10} className="animate-spin" />,       label: 'RUNNING'   },
  completed: { color: 'text-blue-400',    border: 'border-blue-900',    icon: <CheckCircle size={10} />,                             label: 'COMPLETED' },
  failed:    { color: 'text-rose-400',    border: 'border-rose-900',    icon: <XCircle size={10} />,                                 label: 'FAILED'    },
} as const;

export const TaskExecutionChat: React.FC = () => {
  const { agents, tasks, cancelTask } = useSwarmStore();
  const logsByTask = (useSwarmStore as any)((s: any) => s.logsByTask) as
    Record<string, Array<{ agentId: string; stream: string; line: string; ts: number }>>;

  const [selectedAgentId, setSelectedAgentId] = useState(() => agents[0]?.id || 'opencode');
  const [priority, setPriority] = useState(5);
  const [input, setInput] = useState('');
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [sending, setSending] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Keep selectedAgentId valid when agents load
  useEffect(() => {
    if (agents.length > 0 && !agents.find(a => a.id === selectedAgentId)) {
      setSelectedAgentId(agents[0].id);
    }
  }, [agents]);

  // Auto-scroll when new log lines or dispatches arrive
  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [dispatches.length, autoScroll,
    // trigger when any tracked task gains new logs
    ...dispatches.map(d => d.taskId ? (logsByTask[d.taskId]?.length ?? 0) : 0),
  ]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  }, []);

  const handleSend = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || sending) return;
    setSending(true);
    const localId = `d-${Date.now()}`;
    const agentId = selectedAgentId;
    setInput('');
    setDispatches(prev => [...prev, { localId, taskId: null, prompt, agentId, timestamp: Date.now() }]);

    try {
      const res = await fetch('/api/tasks/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, prompt, priority, type: 'prompt' }),
      });
      if (res.ok) {
        const data = await res.json();
        const taskId: string = data.id;
        setDispatches(prev => prev.map(d => d.localId === localId ? { ...d, taskId } : d));
      } else {
        setDispatches(prev => prev.map(d =>
          d.localId === localId ? { ...d, error: `HTTP ${res.status}` } : d
        ));
      }
    } catch (e: any) {
      setDispatches(prev => prev.map(d =>
        d.localId === localId ? { ...d, error: 'network error' } : d
      ));
    } finally {
      setSending(false);
    }
  }, [input, selectedAgentId, priority, sending]);

  return (
    <div className="flex flex-col h-full bg-black border border-zinc-800 rounded-lg overflow-hidden font-mono text-xs">

      {/* Agent selector */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-950 overflow-x-auto no-scrollbar shrink-0">
        <span className="text-zinc-600 text-[10px] tracking-widest shrink-0">TARGET:</span>
        {agents.map(ag => (
          <button
            key={ag.id}
            onClick={() => setSelectedAgentId(ag.id)}
            className={`shrink-0 px-2 py-0.5 rounded text-[10px] tracking-wide border transition-all duration-150 ${
              selectedAgentId === ag.id
                ? 'bg-white text-black border-white font-bold'
                : 'bg-transparent text-zinc-500 border-zinc-800 hover:border-zinc-500 hover:text-zinc-200'
            }`}
          >
            {ag.name}
          </button>
        ))}
        <div className="ml-auto shrink-0 flex items-center gap-1.5">
          <span className="text-zinc-600 text-[10px] select-none">PRI</span>
          <input
            type="number" min={1} max={10} value={priority}
            onChange={e => setPriority(Math.max(1, Math.min(10, Number(e.target.value))))}
            className="w-8 bg-zinc-900 border border-zinc-800 text-zinc-300 text-center rounded text-[10px] py-0.5 focus:outline-none focus:border-zinc-500"
          />
        </div>
      </div>

      {/* Log stream */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5 bg-black scrollbar-thin scrollbar-thumb-zinc-800"
      >
        {dispatches.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-700 select-none">
            <Terminal size={28} />
            <span className="text-[11px]">Select an agent and dispatch a directive</span>
          </div>
        )}

        {dispatches.map(d => {
          const task = d.taskId ? tasks.find(t => t.id === d.taskId) : null;
          const status = task?.status ?? (d.error ? 'failed' : 'pending');
          const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.pending;
          const logs = d.taskId ? (logsByTask[d.taskId] ?? []) : [];

          return (
            <div key={d.localId} className="space-y-1.5">
              {/* User directive bubble */}
              <div className="flex justify-end">
                <div className="max-w-[82%] bg-zinc-900 border border-zinc-700 rounded-lg rounded-tr-none px-3 py-2">
                  <p className="text-white text-[11px] leading-relaxed whitespace-pre-wrap">{d.prompt}</p>
                  <div className="flex items-center gap-2 mt-1 text-[9px] text-zinc-600">
                    <span>{new Date(d.timestamp).toLocaleTimeString()}</span>
                    <span>→ {d.agentId}</span>
                    {task && <span>P{task.priority}</span>}
                  </div>
                </div>
              </div>

              {/* Task output block */}
              <div className={`max-w-[90%] bg-zinc-950 border rounded-lg rounded-tl-none overflow-hidden ${cfg.border}`}>
                {/* Status bar */}
                <div className={`flex items-center justify-between px-3 py-1.5 border-b ${cfg.border} ${cfg.color}`}>
                  <div className="flex items-center gap-1.5">
                    {cfg.icon}
                    <span className="text-[10px] font-bold tracking-wider">{cfg.label}</span>
                    {d.taskId && <span className="text-[9px] text-zinc-600 font-normal">#{d.taskId}</span>}
                    {d.error && <span className="text-[9px] text-rose-500">{d.error}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {task?.latencyMs != null && task.latencyMs > 0 && (
                      <span className="text-[9px] text-zinc-600">{task.latencyMs}ms</span>
                    )}
                    {status === 'running' && d.taskId && (
                      <button
                        onClick={() => cancelTask(d.taskId!)}
                        className="text-[9px] text-rose-500 hover:text-rose-300 border border-rose-900 hover:border-rose-600 px-1.5 py-0.5 rounded transition"
                      >
                        cancel
                      </button>
                    )}
                  </div>
                </div>

                {/* Log lines */}
                <div className="p-3 space-y-0.5 max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-800">
                  {!d.taskId && !d.error && (
                    <span className="text-zinc-700 text-[10px]">Connecting to backend…</span>
                  )}
                  {d.taskId && logs.length === 0 && status === 'pending' && (
                    <span className="text-zinc-700 text-[10px]">Waiting for agent to pick up task…</span>
                  )}
                  {d.taskId && logs.length === 0 && status === 'running' && (
                    <span className="text-zinc-600 text-[10px] animate-pulse">Agent starting…</span>
                  )}
                  {logs.map((ll, i) => (
                    <div key={i} className="flex gap-2 leading-5 min-w-0">
                      <span className="text-zinc-700 shrink-0 select-none tabular-nums">
                        {new Date(ll.ts).toISOString().slice(11, 19)}
                      </span>
                      <span className={`break-all ${ll.stream === 'stderr' ? 'text-rose-400' : 'text-zinc-300'}`}>
                        {ll.line}
                      </span>
                    </div>
                  ))}
                  {status === 'completed' && (
                    <div className="pt-1 flex items-center gap-1 text-blue-400 text-[10px]">
                      <CheckCircle size={9} /> task completed
                      {task?.latencyMs != null && task.latencyMs > 0 && ` in ${task.latencyMs}ms`}
                    </div>
                  )}
                  {status === 'failed' && (
                    <div className="pt-1 flex items-center gap-1 text-rose-400 text-[10px]">
                      <XCircle size={9} /> task failed{(task as any)?.error ? `: ${(task as any).error}` : ''}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        <div ref={bottomRef} />
      </div>

      {/* Scroll-to-bottom nudge */}
      {!autoScroll && (
        <button
          onClick={() => { setAutoScroll(true); bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }}
          className="shrink-0 py-1 text-[10px] text-zinc-500 hover:text-zinc-300 flex items-center justify-center gap-1 border-t border-zinc-900 bg-zinc-950 transition"
        >
          <ChevronDown size={10} /> scroll to bottom
        </button>
      )}

      {/* Input */}
      <div className="shrink-0 p-3 border-t border-zinc-800 bg-zinc-950">
        <div className="flex items-center gap-2 bg-black border border-zinc-800 focus-within:border-zinc-600 rounded-lg px-3 py-2 transition">
          <span className="text-zinc-500 font-bold select-none">›</span>
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder={`Dispatch directive to ${selectedAgentId}…`}
            className="flex-1 bg-transparent text-white placeholder-zinc-700 outline-none text-[11px]"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="p-1.5 bg-white hover:bg-zinc-200 text-black rounded transition disabled:opacity-30 disabled:cursor-not-allowed active:scale-95"
          >
            {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TaskExecutionChat;
