import React from 'react';
import { useSwarmStore } from '../store/useSwarmStore';
import { Zap, Activity, Clock, Plus, Terminal } from 'lucide-react';

interface CockpitHeaderProps {
  onOpenCommandPalette: () => void;
  onNewTask: () => void;
}

export const CockpitHeader: React.FC<CockpitHeaderProps> = ({
  onOpenCommandPalette,
  onNewTask,
}) => {
  const { systemStats, agents, isConnected } = useSwarmStore();

  const activeCount = Object.values(agents).filter((a) => a.status === 'running').length || 4;
  const totalAgents = Object.keys(agents).length || 9;

  return (
    <header className="flex items-center justify-between px-6 py-3 bg-black border-b border-zinc-800 text-white select-none z-30">
      {/* Brand Title */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold tracking-[0.25em] text-white">STARK</span>
          <span className="text-xl font-bold tracking-[0.1em] text-zinc-400">INDUSTRIES</span>
          <span className="px-1.5 py-0.5 text-[9px] font-mono tracking-wider bg-zinc-900 border border-zinc-700 text-zinc-400 rounded">
            ULTRON v2.0
          </span>
        </div>

        {/* Global Telemetry Metric Ribbon */}
        <div className="hidden lg:flex items-center gap-6 text-xs font-mono text-zinc-400">
          <div className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-zinc-400" />
            <span className="text-white font-bold tabular-nums">{totalAgents}</span>
            <span>AGENTS</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            <span className="text-white font-bold tabular-nums">{activeCount}</span>
            <span>RUNNING</span>
          </div>

          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-zinc-400" />
            <span className="text-white font-bold tabular-nums">{systemStats.tasksToday}</span>
            <span>TASKS TODAY</span>
          </div>

          <div className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-zinc-400" />
            <span className="text-white font-bold tabular-nums">~{systemStats.avgLatencyMs}ms</span>
            <span>AVG</span>
          </div>

          {/* Node heartbeat dots */}
          <div className="flex items-center gap-1.5 ml-2">
            {[1, 2, 3, 4, 5, 6, 7].map((dot, idx) => (
              <span
                key={dot}
                className={`w-1.5 h-1.5 rounded-full ${
                  idx < activeCount ? 'bg-white' : 'bg-zinc-700'
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-3">
        {/* Terminal Command Palette Trigger Button */}
        <button
          onClick={onOpenCommandPalette}
          className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 rounded text-xs font-mono transition"
          title="Open Command Palette (Ctrl+K)"
        >
          <Terminal className="w-3.5 h-3.5 text-zinc-400" />
          <span className="hidden sm:inline">Commands</span>
          <kbd className="px-1.5 py-0.2 text-[10px] bg-black text-zinc-400 border border-zinc-700 rounded">
            Ctrl+K
          </kbd>
        </button>

        {/* Backend Connectivity Status Dot */}
        <div className="flex items-center gap-1.5 text-xs font-mono text-zinc-400 px-2">
          <span
            className={`w-2 h-2 rounded-full ${
              isConnected ? 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]' : 'bg-zinc-600'
            }`}
          />
          <span className="hidden md:inline">{isConnected ? 'LIVE WS' : 'SIMULATION'}</span>
        </div>

        {/* Pure White CTA Button */}
        <button
          onClick={onNewTask}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-white hover:bg-zinc-200 text-black font-semibold rounded text-xs transition shadow-[0_0_15px_rgba(255,255,255,0.15)] active:scale-95"
        >
          <Plus className="w-3.5 h-3.5 stroke-[3]" />
          <span>NEW TASK</span>
        </button>
      </div>
    </header>
  );
};

export default CockpitHeader;
