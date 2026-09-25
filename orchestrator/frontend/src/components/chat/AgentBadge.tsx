/**
 * AgentBadge — visual pill badge for a CLI agent identifier.
 *
 * Known agent IDs verified from internal/agent/cli_agent.go switch statement:
 *   vibe, codex, agy, grok, cline, agent (generic fallback used as name=binary)
 * Additional IDs listed in task spec (opencode, cursor, kilo, jules, researcher, debugger)
 * are NOT present in cli_agent.go — they are included as ASSUMED future agents below.
 */

interface AgentConfig {
  label: string;
  abbr: string;
  dotClass: string;
}

// Source: cli_agent.go confirms vibe, codex, agy, grok, cline.
// "agent" is the generic name: agent.New(t.AgentID, t.AgentID, ...) in main.go
// ASSUMED: opencode, cursor, kilo, jules, researcher, debugger — not in current backend.
const AGENT_MAP: Record<string, AgentConfig> = {
  // CONFIRMED (cli_agent.go switch + main.go usage)
  vibe:       { label: 'Vibe',      abbr: 'VI', dotClass: 'bg-purple-400'  },
  codex:      { label: 'Codex',     abbr: 'CX', dotClass: 'bg-blue-400'    },
  agy:        { label: 'Agy',       abbr: 'AG', dotClass: 'bg-teal-400'    },
  grok:       { label: 'Grok',      abbr: 'GR', dotClass: 'bg-orange-400'  },
  cline:      { label: 'Cline',     abbr: 'CL', dotClass: 'bg-rose-400'    },
  agent:      { label: 'Agent',     abbr: 'AG', dotClass: 'bg-zinc-400'    },
  // ASSUMED (task spec — not yet in cli_agent.go)
  opencode:   { label: 'OpenCode',  abbr: 'OC', dotClass: 'bg-emerald-400' },
  cursor:     { label: 'Cursor',    abbr: 'CU', dotClass: 'bg-sky-400'     },
  kilo:       { label: 'Kilo',      abbr: 'KI', dotClass: 'bg-amber-400'   },
  jules:      { label: 'Jules',     abbr: 'JU', dotClass: 'bg-fuchsia-400' },
  researcher: { label: 'Research',  abbr: 'RE', dotClass: 'bg-lime-400'    },
  debugger:   { label: 'Debugger',  abbr: 'DB', dotClass: 'bg-red-400'     },
};

const SIZE_CLASSES = {
  sm: { pill: 'px-1.5 py-0.5 gap-1 text-xs',   dot: 'w-1.5 h-1.5' },
  md: { pill: 'px-2   py-0.5 gap-1.5 text-xs',  dot: 'w-2 h-2'     },
  lg: { pill: 'px-2.5 py-1   gap-2 text-sm',    dot: 'w-2.5 h-2.5' },
};

export interface AgentBadgeProps {
  agentId: string;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function AgentBadge({ agentId, showLabel = true, size = 'md' }: AgentBadgeProps) {
  const cfg = AGENT_MAP[agentId] ?? {
    label: agentId,
    abbr: agentId.slice(0, 2).toUpperCase(),
    dotClass: 'bg-zinc-500',
  };
  const sz = SIZE_CLASSES[size];

  return (
    <span
      className={`inline-flex items-center rounded-full bg-zinc-800 border border-zinc-700 font-mono text-zinc-300 select-none ${sz.pill}`}
      title={cfg.label}
    >
      <span className={`rounded-full flex-shrink-0 ${sz.dot} ${cfg.dotClass}`} />
      {showLabel ? (
        <span>{cfg.label}</span>
      ) : (
        <span className="sr-only">{cfg.label}</span>
      )}
    </span>
  );
}
