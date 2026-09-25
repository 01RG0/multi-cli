/**
 * UltronWelcome — Welcome hero banner and actionable Quick Prompts component.
 *
 * Implements Ant Design X / Ekko Studio aesthetic:
 * - Glowing Ultron emblem with pulsing status
 * - Live agent swarm counters and provider telemetry
 * - 4 interactive Quick Prompt cards with 1-click execution
 */

import React, { useEffect, useState } from 'react';
import {
  Sparkles,
  Zap,
  Terminal,
  Brain,
  Puzzle,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Cpu,
} from 'lucide-react';
import { useSwarmStore } from '../../store/useSwarmStore';
import { UltronIcon } from './UltronIcon';

export interface QuickPrompt {
  id: string;
  icon: React.ReactNode;
  tag: string;
  title: string;
  prompt: string;
  agentBadge: string;
  colorClass: string;
  borderColorClass: string;
}

interface UltronWelcomeProps {
  onSelectPrompt: (promptText: string) => void;
}

export function UltronWelcome({ onSelectPrompt }: UltronWelcomeProps) {
  const wsStatus    = useSwarmStore((s) => s.wsStatus);
  const tasks       = useSwarmStore((s) => s.tasks);
  const activeTasks = tasks.filter((t) => t.status === 'running').length;

  const [agentCount, setAgentCount] = useState<number>(16);
  const [mcpCount, setMcpCount]     = useState<number | null>(null);

  useEffect(() => {
    fetch('http://localhost:8080/api/agents/status')
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) setAgentCount(data.length);
        else if (data && typeof data === 'object') {
          const d = data as Record<string, unknown>;
          if (Array.isArray(d['agents'])) setAgentCount((d['agents'] as unknown[]).length);
        }
      })
      .catch(() => setAgentCount(16));

    fetch('http://localhost:8080/api/mcp/servers')
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) setMcpCount(data.length);
        else if (data && typeof data === 'object') {
          const d = data as Record<string, unknown>;
          if (Array.isArray(d['servers'])) setMcpCount((d['servers'] as unknown[]).length);
        }
      })
      .catch(() => setMcpCount(null));
  }, []);

  const quickPrompts: QuickPrompt[] = [
    {
      id: 'deep-research',
      icon: <Terminal className="w-4 h-4 text-amber-400" />,
      tag: 'Hermes Research',
      title: '🔬 Deep Tool Research',
      prompt: 'Dispatch a deep research pipeline to @hermes to investigate optimal streaming architectures and synthesize findings into memory.',
      agentBadge: '@hermes',
      colorClass: 'hover:bg-amber-950/20 hover:border-amber-700/60',
      borderColorClass: 'border-zinc-800/80',
    },
    {
      id: 'fullstack-feature',
      icon: <Zap className="w-4 h-4 text-emerald-400" />,
      tag: 'OpenCode Agent',
      title: '⚡ Full-Stack Feature',
      prompt: 'Instruct @opencode to implement high-speed WebSocket reconnection fallback and update telemetry state batching.',
      agentBadge: '@opencode',
      colorClass: 'hover:bg-emerald-950/20 hover:border-emerald-700/60',
      borderColorClass: 'border-zinc-800/80',
    },
    {
      id: 'memory-recall',
      icon: <Brain className="w-4 h-4 text-cyan-400" />,
      tag: 'Neural Graph',
      title: '🧠 Memory Cortex Recall',
      prompt: 'Search the memory cortex for recent architectural decisions regarding multi-agent coordination and provider routing.',
      agentBadge: 'cortex',
      colorClass: 'hover:bg-cyan-950/20 hover:border-cyan-700/60',
      borderColorClass: 'border-zinc-800/80',
    },
    {
      id: 'mcp-skills',
      icon: <Puzzle className="w-4 h-4 text-purple-400" />,
      tag: 'Ecosystem',
      title: '🛠️ Dynamic Skills & MCP',
      prompt: 'List all available system skills and active MCP servers with their available tool schemas and execution status.',
      agentBadge: 'skills',
      colorClass: 'hover:bg-purple-950/20 hover:border-purple-700/60',
      borderColorClass: 'border-zinc-800/80',
    },
  ];

  return (
    <div className="max-w-2xl w-full mx-auto px-4 py-8 flex flex-col items-center select-none animate-in fade-in zoom-in-95 duration-300">
      {/* Glowing Ω Avatar */}
      <div className="relative mb-5">
        <div className="absolute -inset-2 rounded-full bg-gradient-to-r from-cyan-500/30 to-purple-500/30 blur-xl opacity-75 animate-pulse" />
        <UltronIcon size="hero" status="online" className="relative" />
      </div>

      {/* Main Title & Subtitle */}
      <h1 className="text-xl sm:text-2xl font-bold tracking-wider text-white text-center font-mono">
        ULTRON AUTONOMOUS ORCHESTRATOR
      </h1>
      <p className="mt-1.5 text-xs sm:text-sm text-zinc-400 text-center max-w-md font-mono leading-relaxed">
        Autonomous Multi-CLI Swarm Intelligence & Execution Engine
      </p>

      {/* System Status Pill Badge */}
      <div className="mt-3 flex items-center gap-2 flex-wrap justify-center text-[11px] font-mono">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-300">
          <span
            className={`w-2 h-2 rounded-full ${
              wsStatus === 'connected'
                ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                : wsStatus === 'simulated'
                  ? 'bg-amber-400'
                  : 'bg-red-400'
            }`}
          />
          <span className="capitalize">{wsStatus} WS</span>
        </span>

        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-300">
          <Cpu className="w-3 h-3 text-cyan-400" />
          <span>{agentCount} CLI Agents</span>
        </span>

        {mcpCount != null && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-300">
            <Puzzle className="w-3 h-3 text-purple-400" />
            <span>{mcpCount} MCP Servers</span>
          </span>
        )}

        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-300">
          <ShieldCheck className="w-3 h-3 text-emerald-400" />
          <span>Sonnet 4.6</span>
        </span>
      </div>

      {/* Actionable Quick Prompts Grid */}
      <div className="mt-7 w-full grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {quickPrompts.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectPrompt(item.prompt)}
            className={`group text-left p-3.5 rounded-xl border bg-zinc-950/70 ${item.borderColorClass} ${item.colorClass} transition-all duration-200 flex flex-col justify-between hover:shadow-lg`}
          >
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-200 group-hover:text-white font-mono">
                  {item.icon}
                  <span>{item.title}</span>
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 group-hover:border-zinc-700">
                  {item.agentBadge}
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed">
                {item.prompt}
              </p>
            </div>

            <div className="mt-3 flex items-center justify-between text-[10px] font-mono text-zinc-500 group-hover:text-zinc-300 transition-colors">
              <span>Click to run</span>
              <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export default UltronWelcome;
