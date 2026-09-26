import React, { useEffect } from 'react';
import { Command } from 'cmdk';
import { Terminal, Play, Square, Activity, Cpu, Sliders, XCircle, ArrowRight } from 'lucide-react';
import { useSwarmStore } from '../store/useSwarmStore';

interface TerminalCommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigateTab?: (tabId: string) => void;
  onNewTask?: () => void;
}

export const TerminalCommandPalette: React.FC<TerminalCommandPaletteProps> = ({
  open,
  onOpenChange,
  onNavigateTab,
  onNewTask,
}) => {
  const store = useSwarmStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onOpenChange]);

  const execute = (cmd: string) => {
    if (cmd.startsWith('/task new') || cmd === '/task') {
      if (onNewTask) {
        onNewTask();
      } else {
        const prompt = window.prompt('Enter task prompt:');
        if (prompt) {
          store.addTask({
            agentId: store.selectedAgentId || 'opencode',
            prompt,
            status: 'pending',
            priority: 8,
          });
        }
      }
    } else if (cmd.startsWith('/cancel')) {
      const activeTasks = store.tasks.filter((t) => t.status === 'running' || t.status === 'pending');
      activeTasks.forEach((t) => store.cancelTask(t.id));
      store.addLog({
        level: 'WARN',
        agent: 'orchestrator',
        message: `Dispatched broadcast CANCEL signal to ${activeTasks.length} active swarm task(s)`,
      });
    } else if (cmd.startsWith('/priority')) {
      store.tasks.forEach((t, i) => {
        store.updateTask(t.id, { priority: Math.min(10, Math.max(1, ((i % 5) + 1) * 2)) });
      });
      store.addLog({
        level: 'INFO',
        agent: 'router',
        message: 'Rebalanced task priority queue heuristics',
      });
    } else if (cmd.startsWith('/agent')) {
      store.setSelectedAgentId('opencode');
      if (onNavigateTab) onNavigateTab('agent');
    } else if (cmd.startsWith('/tab ') || cmd.startsWith('/nav ')) {
      const target = cmd.split(' ')[1];
      if (target && onNavigateTab) onNavigateTab(target);
    } else if (cmd.startsWith('/status')) {
      store.fetchAgents();
      if (onNavigateTab) onNavigateTab('swarm');
    }
    onOpenChange(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
      <div className="relative w-full max-w-xl bg-black border border-zinc-700 rounded-xl shadow-[0_0_50px_rgba(0,0,0,0.9),0_0_20px_rgba(255,255,255,0.08)] overflow-hidden font-mono text-xs">
        <Command label="Ultron Command Palette">
          {/* Header Input */}
          <div className="flex items-center px-4 border-b border-zinc-800 bg-zinc-950">
            <Terminal className="w-4 h-4 text-zinc-400 mr-2 shrink-0" />
            <Command.Input
              autoFocus
              placeholder="Type command (/task, /agent, /priority, /cancel, /status, /logs)..."
              className="w-full bg-transparent py-3 text-white placeholder-zinc-500 outline-none text-xs"
            />
            <button
              onClick={() => onOpenChange(false)}
              className="text-zinc-500 hover:text-white text-xs px-1.5 py-0.5 border border-zinc-800 rounded bg-zinc-900"
            >
              ESC
            </button>
          </div>

          {/* List Results */}
          <Command.List className="max-h-72 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-zinc-800">
            <Command.Empty className="p-4 text-center text-zinc-500">
              No matching command found.
            </Command.Empty>

            <Command.Group heading="Swarm Directives" className="text-[10px] uppercase tracking-wider text-zinc-500 px-2 py-1">
              <Command.Item
                onSelect={() => execute('/task new')}
                className="flex items-center gap-2.5 px-3 py-2 rounded text-zinc-200 cursor-pointer data-[selected=true]:bg-white data-[selected=true]:text-black transition"
              >
                <Play className="w-3.5 h-3.5" />
                <span className="font-bold">/task new</span>
                <span className="ml-auto text-[10px] opacity-60">Spawn new agent task</span>
              </Command.Item>

              <Command.Item
                onSelect={() => execute('/cancel all')}
                className="flex items-center gap-2.5 px-3 py-2 rounded text-zinc-200 cursor-pointer data-[selected=true]:bg-white data-[selected=true]:text-black transition"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span className="font-bold">/cancel</span>
                <span className="ml-auto text-[10px] opacity-60">Abort active execution</span>
              </Command.Item>

              <Command.Item
                onSelect={() => execute('/priority rebalance')}
                className="flex items-center gap-2.5 px-3 py-2 rounded text-zinc-200 cursor-pointer data-[selected=true]:bg-white data-[selected=true]:text-black transition"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span className="font-bold">/priority</span>
                <span className="ml-auto text-[10px] opacity-60">Rebalance queue priority</span>
              </Command.Item>
            </Command.Group>

            <Command.Group heading="Navigation & Diagnostics" className="text-[10px] uppercase tracking-wider text-zinc-500 px-2 py-1 mt-2">
              <Command.Item
                onSelect={() => execute('/agent inspect')}
                className="flex items-center gap-2.5 px-3 py-2 rounded text-zinc-200 cursor-pointer data-[selected=true]:bg-white data-[selected=true]:text-black transition"
              >
                <Cpu className="w-3.5 h-3.5" />
                <span className="font-bold">/agent</span>
                <span className="ml-auto text-[10px] opacity-60">Inspect agent telemetry</span>
              </Command.Item>

              <Command.Item
                onSelect={() => execute('/status')}
                className="flex items-center gap-2.5 px-3 py-2 rounded text-zinc-200 cursor-pointer data-[selected=true]:bg-white data-[selected=true]:text-black transition"
              >
                <Activity className="w-3.5 h-3.5" />
                <span className="font-bold">/status</span>
                <span className="ml-auto text-[10px] opacity-60">View swarm health</span>
              </Command.Item>
            </Command.Group>
          </Command.List>

          {/* Footer Guide */}
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-zinc-800 bg-zinc-950 text-[10px] text-zinc-500">
            <span>Use ↑↓ to navigate</span>
            <span>↵ to execute</span>
          </div>
        </Command>
      </div>
    </div>
  );
};

export default TerminalCommandPalette;
