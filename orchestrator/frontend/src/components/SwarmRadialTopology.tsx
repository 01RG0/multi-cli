import React, { useState, useMemo, useEffect, useRef } from 'react';
import useSwarmStore from '../store/useSwarmStore';
import { Terminal, Command, Clock, Zap, Search, Menu } from 'lucide-react';

// Each agent has its own identity color — used for beam, glow, particles, node ring, name pill
const AGENT_COLOR: Record<string, string> = {
  opencode:   '#22d3ee',  // cyan
  codex:      '#10A37F',  // OpenAI green
  vibe:       '#f97316',  // Mistral orange
  agy:        '#4285F4',  // Google blue
  grok:       '#e4e4e7',  // near-white / xAI
  kilo:       '#f59e0b',  // amber
  cline:      '#6366f1',  // indigo
  researcher: '#2dd4bf',  // teal
  debugger:   '#f43f5e',  // red
  cursor:     '#d4d4d8',  // zinc-300 / cursor grey-white
  jules:      '#a855f7',  // purple
};
const DEFAULT_AGENT_COLOR = '#22d3ee';

// Status overrides opacity/brightness but NOT hue — error is always red
const STATUS_OVERRIDE: Record<string, string> = {
  error:   '#f43f5e',
  waiting: '#fbbf24',
};

function agentColor(agentName: string, status: string): string {
  if (STATUS_OVERRIDE[status]) return STATUS_OVERRIDE[status];
  return AGENT_COLOR[agentName?.toLowerCase()] ?? DEFAULT_AGENT_COLOR;
}

// Inline Lucide-style SVG paths per CLI tool (viewBox 0 0 24 24)
// Brand icons: circle SVGs from /icons/ (public dir), fallback to inline for unknown agents
const BRAND_ICONS: Record<string, string> = {
  codex:      '/icons/codex.svg',
  agy:        '/icons/agy.svg',
  kilo:       '/icons/kilo.svg',
  cline:      '/icons/cline.svg',
  grok:       '/icons/grok.svg',
  vibe:       '/icons/vibe.svg',
  cursor:     '/icons/cursor.svg',
  jules:      '/icons/jules.svg',
};

// Fallback inline icons for agents without a brand SVG
const AGENT_ICONS: Record<string, React.ReactNode> = {
  opencode: (
    <g fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </g>
  ),
  researcher: (
    <g fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </g>
  ),
  debugger: (
    <g fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 7.13v-1a3 3 0 0 1 6 0v1" />
      <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z" />
      <path d="M12 20v-9M6 13H2M22 13h-4" />
    </g>
  ),
  default: (
    <g fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M9 9h6M9 12h6M9 15h4" />
    </g>
  ),
};

// Ultron icon — from Noun Project (Vectors Point), watermark removed, viewBox 0 0 66 66
const ULTRON_HEAD_ICON = (
  <g fill="currentColor" stroke="none">
    <path fillRule="evenodd" clipRule="evenodd" d="M41.9,2.8c-0.1,0-0.1-0.1-0.2-0.1c-1.9-0.9-3.8-1.4-5.7-1.6c-4.3-0.4-8.4-0.2-11.9,1.7C10.6,6.7,1.3,19.2,1.3,33.3   c0,11,5.7,21.4,15.5,27.3c21,12.5,48-2.6,48-27.3C64.8,19.2,55.3,6.7,41.9,2.8z M51.7,27.8l0.7-0.1c0.3,2.8,0.1,5.6-0.6,8.3   l-1.6-1.4C52.5,31,52.1,29.5,51.7,27.8z M42.3,62.1c0-2.7-0.2-5.3-0.5-7.8l4.3-7.4c0.8,3.9,1.7,8,2.8,12.1   C46.7,60.4,44.6,61.3,42.3,62.1z M17,58.9c1.1-4.1,2.1-8.2,2.8-12l4.8,8.2c-0.2,2.3-0.4,4.7-0.4,7.2C21.6,61.4,19.2,60.3,17,58.9z    M14.5,31.9c0,0.1,0.3,0.7,0.5,1c0.1,0.2,0.4,0.7,0.5,1c0.1,0.1,0.4,0.6,0.4,0.7l-1.6,1.4c-0.8-2.7-1-5.5-0.6-8.3l0.7,0.1   C13.7,30.2,14,30.9,14.5,31.9z M19.9,20.9c2.8,4.2,5.1,8.7,6.9,13.9C19.8,33.5,18.7,27.9,19.9,20.9z M27.3,36.3   c2.7,9.2,1.6,10,1.6,10.2l-2.2-0.4c-0.3-1.7-1.2-4.4-3.8-6.6c0.2-0.9,0.7-1.7-0.1-2.1c-3.3-1.3-3.4-1.6-3.9-1.4   c-6.6-7-1.6-7.1-1.6-14.8v-4.4l1.4,2.3C16.9,28,18.3,35.4,27.3,36.3z M38.7,36.3c9-0.9,10.4-8.4,8.6-17.2l1.4-2.3   c0.2,4.4-0.6,5.4,1.2,10.6c0.9,2.6,0.7,3-0.2,4.7c-0.7,1.5-1.5,2.6-2.7,3.8c-0.5-0.2-0.5,0.1-3.9,1.4c-0.8,0.3-0.3,1.2-0.1,2.1   c-2.6,2.2-3.5,4.9-3.8,6.6l-2.2,0.4C37.1,46.4,36.2,45.1,38.7,36.3z M46.1,20.9c1.2,7,0.1,12.7-6.9,13.9C41,29.6,43.3,25,46.1,20.9   z M40.8,62.5c-4.9,1.3-10.1,1.4-15.1,0.1c0-1.6,0-3.2,0.2-5.4c1.7,2,8.2,1.8,10.7,1.4c0.6-0.2,2.7,0.1,3.9-2l0.1-0.2   C40.7,58.5,40.8,60.5,40.8,62.5z M37.6,57c-0.7,0.1-3.7,0.8-8,0.2c-0.7-0.2-2.1,0.1-2.8-1.2c-0.2-0.4-7.2-12.4-6.9-11.9v-6.2   l1.7,0.7c-2.2,7.2,4.4,15.9,4.9,12.9l0.2-1l1.5,0.2c0,0.2-0.4,1.5,0.6,1.6c4.7,0.3,4.2,0.3,4.3,0.3c5.2-0.5,4.9,0.1,4.8-1.8   l1.5-0.2l0.2,1c0.1,0.6,0.9,0.8,1.3,0.4c3-3.1,5.1-8.5,3.6-13.2l1.7-0.7V44C39,55.7,39.4,56.7,37.6,57z M14.8,37.6l1.9-1.7   c0.5,0.6,1,1.2,1.6,1.8v5.6C17.3,42.1,15.9,40.3,14.8,37.6z M47.6,37.6c0.6-0.6,1.1-1.2,1.6-1.8l1.9,1.7c-1,2.7-2.5,4.5-3.5,5.6   V37.6z M35.7,46.8c0.1,0.3,0.1,1.5,1.1,1.3c3.1-0.7,3.6-0.5,3.9-1.1c0.1-0.3,0.3-3.1,2.7-5.7c0.2,3.5-1.5,6.6-2.7,8.2l0-0.1   c-0.2-1.2-1.8-0.3-3.8-0.1c-1,0.2-0.5,1.3-0.5,1.5L33,51l-3.3-0.2c0-0.2,0.4-1.3-0.5-1.5c-2-0.1-3.6-1.1-3.8,0.1l0,0.1   c-1.2-1.6-2.9-4.7-2.7-8.2c2.6,2.7,2.6,5.3,2.7,5.7c0.3,0.6,0.8,0.4,3.9,1.1c1,0.2,1-1.1,1.1-1.3c2.7,0.2,2.6,0.2,2.7,0.2   L35.7,46.8z M13.2,37.6C13.2,37.6,13.2,37.6,13.2,37.6L13.2,37.6C13.2,37.6,13.2,37.6,13.2,37.6c1.5,4.3,4.1,6.7,5,7.6l-0.1,0.3   c-6.4-5.8-9.4-11-8.9-15.7c0.3-3,2.2-5.2,3.6-6.4C11.7,28.2,11.6,33.1,13.2,37.6z M47.7,45.2c4.8-4.2,7.8-12,5.4-21.7   c1.4,1.2,3.3,3.3,3.6,6.3c0.5,4.6-2.5,9.9-8.9,15.7L47.7,45.2z M37.5,35.4C37.5,35.4,37.5,35.4,37.5,35.4c-0.8,2.5-1.9,7.1-2,9.9   L33,45.6l-2.5-0.2c-0.2-5.9-3.7-17.4-10.5-26.8l-2.6-4.3c0.6-3.5,2.5-6.6,5.1-8.7c0.6,3.8,1.3,6.9,3.9,10.3c2.3,3,3.6,6.8,3.6,10.6   v5.7c0,1.3,1.8,0.5,5,0.8c2.5,0-2-8.7,4.3-17c2.6-3.4,3.3-6.4,3.9-10.3c2.7,2.1,4.6,5.2,5.1,8.7C43.7,22.1,40.6,25.7,37.5,35.4z    M27.8,15c-2.9-3.9-3.2-7.1-3.8-10.4c3.8-2.3,6.8-2.1,10.8-2.1c2.4,0,4.9,0.7,7.2,2.1C41.5,7,41.4,10.8,38.2,15   c-2.5,3.3-3.9,7.3-3.9,11.5v5h-2.8v-5C31.6,22.3,30.2,18.3,27.8,15z M2.8,33.3C2.8,21.6,9.6,10.9,20,6c-2.1,2.2-3.5,5-4,8.1   c0,0.1,0,0.2,0,0.3c-0.1,0.7-0.2,1.4-0.2,2.2c-0.2,4.1,0.5,5.9-1,9.8l-1-0.1c0.7-4.1,1.5-4.6,0.8-5.1c-0.2-0.2-0.6-0.2-0.8-0.1   c-0.2,0.1-5.4,2.9-6.1,8.7c-1,8.7,8.9,16.2,10.4,17.8c-0.7,3.4-1.5,7-2.5,10.5C7.9,52.6,2.8,43.5,2.8,33.3z M50.3,58.1   c-1-3.6-1.8-7.2-2.5-10.5c7.5-6.4,11-12.4,10.4-17.8c-0.7-5.8-5.9-8.6-6.1-8.7c-0.3-0.1-0.6-0.1-0.8,0.1c-0.2,0.2-0.3,0.5-0.2,0.8   c0.5,1.5,0.8,2.9,1.1,4.3l-1,0.1C48.7,19.6,52.8,13.2,46,6c10.3,5,17.2,15.6,17.2,27.3C63.3,43.5,58.1,52.6,50.3,58.1z" />
  </g>
);

const mockAgents = [
  { id: 'opencode',   name: 'opencode',   badge: 'OC', latency: '44ms',  tasks: 12,  status: 'running', model: 'claude-3-5' },
  { id: 'codex',      name: 'codex',      badge: 'CX', latency: '210ms', tasks: 8,   status: 'running', model: 'gpt-4o' },
  { id: 'vibe',       name: 'vibe',       badge: 'VB', latency: '89ms',  tasks: 5,   status: 'running', model: 'mistral' },
  { id: 'agy',        name: 'agy',        badge: 'AG', latency: '12ms',  tasks: 4,   status: 'idle',    model: 'gemini' },
  { id: 'grok',       name: 'grok',       badge: 'GK', latency: '33ms',  tasks: 3,   status: 'running', model: 'grok-2' },
  { id: 'kilo',       name: 'kilo',       badge: 'KL', latency: '15ms',  tasks: 7,   status: 'running', model: 'claude-3-5' },
  { id: 'cline',      name: 'cline',      badge: 'CL', latency: '150ms', tasks: 11,  status: 'running', model: 'gpt-4o' },
  { id: 'researcher', name: 'researcher', badge: 'RS', latency: '22ms',  tasks: 2,   status: 'idle',    model: 'claude-3-5' },
  { id: 'debugger',   name: 'debugger',   badge: 'DG', latency: '44ms',  tasks: 0,   status: 'error',   model: 'gpt-4-turbo' },
  { id: 'cursor',     name: 'cursor',     badge: 'CR', latency: '88ms',  tasks: 6,   status: 'running', model: 'claude-3-5' },
  { id: 'jules',      name: 'jules',      badge: 'JL', latency: '175ms', tasks: 4,   status: 'running', model: 'gemini-2.0' },
];

// How many ms a particle burst stays "active" after a real log event
const ACTIVITY_TTL = 2800;

// Curved bezier path between two points — synapse/neuron style.
function synapsePath(x1: number, y1: number, x2: number, y2: number, curvature = 0.28): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const cpx = mx - dy * curvature;
  const cpy = my + dx * curvature;
  return `M ${x1} ${y1} Q ${cpx} ${cpy} ${x2} ${y2}`;
}

// Organic neuron soma shape — irregular closed smooth bezier blob.
function neuronSoma(r: number, seed: number): string {
  const n = 11;
  const pts: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const angle = (k / n) * Math.PI * 2 - Math.PI / 2;
    const h = Math.sin(seed * 17.3 + k * 2.61) * 0.5 + 0.5;
    const vary = 0.68 + h * 0.32;
    pts.push([Math.cos(angle) * r * vary, Math.sin(angle) * r * vary]);
  }
  const mids = pts.map((p, i) => {
    const q = pts[(i + 1) % n];
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as [number, number];
  });
  let d = `M ${mids[n - 1][0].toFixed(2)} ${mids[n - 1][1].toFixed(2)}`;
  for (let k = 0; k < n; k++) {
    const cp = pts[k];
    const to = mids[k];
    d += ` Q ${cp[0].toFixed(2)} ${cp[1].toFixed(2)} ${to[0].toFixed(2)} ${to[1].toFixed(2)}`;
  }
  d += ' Z';
  return d;
}

// Pure geometry — computes dendrite data for a given seed/radius.
// Called once per node; result shared by both fixed-tip and floating-shaft renderers.
type DendriteGeo = {
  sx: number; sy: number;          // shaft start (soma surface, local space)
  tipX: number; tipY: number;      // shaft end / tip (fixed anchor, parent space)
  cpx: number; cpy: number;        // bezier control point
  branches: {
    bex: number; bey: number;       // branch end
    kx:  number; ky:  number;       // terminal knob centre
    ba:  number;                    // branch angle
  }[];
};
function computeDendrites(r: number, seed: number): DendriteGeo[] {
  const count = 4 + (seed % 3);
  return Array.from({ length: count }, (_, k) => {
    const angle = ((k / count) * Math.PI * 2 - Math.PI / 2)
                + Math.sin(seed * 4.7 + k * 3.13) * 0.35;
    const shaftLen = r * (0.55 + Math.abs(Math.sin(seed * 2.1 + k * 1.7)) * 0.65);
    const sx  = Math.cos(angle) * r * 0.88;
    const sy  = Math.sin(angle) * r * 0.88;
    const tipX = Math.cos(angle) * (r + shaftLen);
    const tipY = Math.sin(angle) * (r + shaftLen);
    const cpx = (sx + tipX) / 2 + Math.sin(seed * 3.3 + k) * r * 0.25;
    const cpy = (sy + tipY) / 2 + Math.cos(seed * 2.9 + k) * r * 0.18;
    const spread    = 0.38 + Math.abs(Math.sin(seed + k)) * 0.2;
    const branchLen = shaftLen * 0.38;
    const branches = [angle + spread, angle - spread].map(ba => {
      const bex = tipX + Math.cos(ba) * branchLen;
      const bey = tipY + Math.sin(ba) * branchLen;
      return { bex, bey, kx: bex + Math.cos(ba) * 2.5, ky: bey + Math.sin(ba) * 2.5, ba };
    });
    return { sx, sy, tipX, tipY, cpx, cpy, branches };
  });
}

// Fixed part: sub-branches + synaptic knobs anchored in parent space (don't float).
function DendriteTips({ geo, color, active, selected }: {
  geo: DendriteGeo[]; color: string; active: boolean; selected: boolean;
}) {
  const sw  = selected ? 0.9 : active ? 0.65 : 0.45;
  const kr  = selected ? 2.1 : active ? 1.55 : 0.9;
  const op  = selected ? 0.9 : active ? 0.65 : 0.18;
  return (
    <g opacity={op}>
      {geo.map((d, k) => (
        <g key={k}>
          {d.branches.map((b, bi) => (
            <g key={bi}>
              <line x1={d.tipX} y1={d.tipY} x2={b.bex} y2={b.bey}
                stroke={color} strokeWidth={sw} strokeLinecap="round" />
              <circle cx={b.kx} cy={b.ky} r={kr} fill={color} />
            </g>
          ))}
        </g>
      ))}
    </g>
  );
}

// Floating part: shafts whose TIP endpoint animates inversely to the soma float,
// so tips appear pinned while the soma drifts — "fingers stuck to wall, hand moves".
function DendriteShafts({ geo, color, active, selected, floatAmp, floatDur, floatBegin }: {
  geo: DendriteGeo[]; color: string; active: boolean; selected: boolean;
  floatAmp: number; floatDur: number; floatBegin: string;
}) {
  const sw = selected ? 1.2 : active ? 0.85 : 0.5;
  const op = selected ? 0.85 : active ? 0.6 : 0.18;
  return (
    <g>
      {geo.map((d, k) => {
        const fa = floatAmp;
        // When soma floats UP by fa, tip local-Y must be +fa to stay on screen.
        // When soma floats DOWN by fa, tip local-Y must be -fa.
        const f = (dy: number) =>
          `M ${d.sx.toFixed(2)} ${d.sy.toFixed(2)} ` +
          `Q ${d.cpx.toFixed(2)} ${(d.cpy + dy).toFixed(2)} ` +
          `${d.tipX.toFixed(2)} ${(d.tipY + dy).toFixed(2)}`;
        const dTop = f(fa);   // soma at top → tip compensates downward in local space
        const dMid = f(0);
        const dBot = f(-fa);  // soma at bottom → tip compensates upward
        return (
          <path key={k} d={dMid} fill="none"
            stroke={color} strokeWidth={sw} strokeLinecap="round" opacity={op}>
            <animate attributeName="d"
              values={`${dTop};${dBot};${dTop}`}
              dur={`${floatDur}s`} begin={`${floatBegin}s`}
              repeatCount="indefinite" calcMode="spline"
              keySplines="0.45 0.05 0.55 0.95;0.45 0.05 0.55 0.95"
              keyTimes="0;0.5;1" />
          </path>
        );
      })}
    </g>
  );
}

type DispatchBurst = {
  key:     string;
  agentId: string;
  size:    number;
  dur:     number;
  color:   string;
  born:    number;
};

export const SwarmRadialTopology: React.FC = () => {
  const storeAgents        = (useSwarmStore as any)((s: any) => s.agents);
  const logs               = (useSwarmStore as any)((s: any) => s.logs)   || [];
  const tasks              = (useSwarmStore as any)((s: any) => s.tasks)  || [];
  const selectedAgentId    = (useSwarmStore as any)((s: any) => s.selectedAgentId) || null;
  const setSelectedAgentId = (useSwarmStore as any)((s: any) => s.setSelectedAgentId) || (() => {});
  const setSelectedAgent   = (useSwarmStore as any)((s: any) => s.setSelectedAgent) || (() => {});
  const triggerBeamPing    = (useSwarmStore as any)((s: any) => s.triggerBeamPing) || (() => {});
  const fetchAgents        = (useSwarmStore as any)((s: any) => s.fetchAgents) || (() => {});
  const addLog             = (useSwarmStore as any)((s: any) => s.addLog) || (() => {});

  const agents = storeAgents?.length ? storeAgents : mockAgents;

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const handleSelectAgent = (id: string) => {
    setSelectedAgent(id);
    setSelectedAgentId(id);
    triggerBeamPing(id, 1.0);
  };

  const agentLiveLatency = useMemo(() => {
    const latMap: Record<string, string> = {};
    agents.forEach((ag: any) => {
      const agTasks = tasks.filter((t: any) => (t.agentId === ag.id || t.agent?.id === ag.id) && t.latencyMs > 0);
      if (agTasks.length > 0) {
        const avg = Math.round(agTasks.reduce((acc: number, t: any) => acc + t.latencyMs, 0) / agTasks.length);
        latMap[ag.id] = `${avg}ms`;
      } else {
        latMap[ag.id] = ag.latency || (ag.avgLatencyMs ? `${ag.avgLatencyMs}ms` : '35ms');
      }
    });
    return latMap;
  }, [agents, tasks]);

  const [input, setInput]               = useState('');
  const [searchQuery, setSearchQuery]   = useState('');
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen]   = useState(true);

  // ── Real-time activity timestamps per agent id ────────────────────────────
  const [agentActivity, setAgentActivity] = useState<Record<string, number>>({});
  const prevLogLen = useRef(0);
  const prevTaskStatuses = useRef<Record<string, string>>({});
  const [now, setNow] = useState(Date.now());

  // ── Outbound dispatch bursts: ULTRON → agent ──────────────────────────────
  const [dispatches, setDispatches] = useState<DispatchBurst[]>([]);
  // Flash ring state: true briefly when ULTRON fires
  const [ultronFlash, setUltronFlash] = useState(false);

  // 500 ms ticker — expires activity state + prunes old dispatches
  useEffect(() => {
    const t = setInterval(() => {
      const ts = Date.now();
      setNow(ts);
      setDispatches(prev => prev.filter(d => d.born > ts - 4000));
    }, 500);
    return () => clearInterval(t);
  }, []);

  // Watch logs — new entries drive particle bursts on the responsible agent
  useEffect(() => {
    if (logs.length <= prevLogLen.current) return;
    const fresh = logs.slice(prevLogLen.current);
    prevLogLen.current = logs.length;

    const ts = Date.now();
    const updates: Record<string, number> = {};
    fresh.forEach((log: any) => {
      const name = (log.agent || '').replace(/^@/, '').toLowerCase();
      const matched = agents.find(
        (a: any) => a.name?.toLowerCase() === name || a.id?.toLowerCase() === name
      );
      if (matched) updates[matched.id] = ts;
    });

    if (Object.keys(updates).length) {
      setAgentActivity(prev => ({ ...prev, ...updates }));
    }
  }, [logs, agents]);

  // Watch tasks — status transitions to 'running' trigger activity + dispatch burst
  useEffect(() => {
    const ts = Date.now();
    const actUpdates: Record<string, number> = {};
    const newDispatches: DispatchBurst[] = [];

    tasks.forEach((task: any) => {
      const prev = prevTaskStatuses.current[task.id];
      if (task.status === 'running' && prev !== 'running') {
        const ag = agents.find((a: any) => a.id === task.agentId);
        if (ag) {
          actUpdates[ag.id] = ts;

          // Token weight proxy: priority 1–10, latencyMs hint
          const weight = Math.max(1, Math.min(10, task.priority ?? 5));
          // Base size 4, max ~10 at priority 10; latency nudges it further
          const latBonus = Math.min(3, (task.latencyMs ?? 0) / 200);
          const size = 4 + (weight / 10) * 6 + latBonus;
          const dur  = 0.9 + (weight / 10) * 0.6; // heavier = slightly slower

          const color = agentColor(ag.name, ag.status);

          // Fire 1–3 particles depending on weight
          const burst = weight >= 7 ? 3 : weight >= 4 ? 2 : 1;
          for (let b = 0; b < burst; b++) {
            newDispatches.push({
              key:     `${task.id}-${b}-${ts}`,
              agentId: ag.id,
              size:    b === 0 ? size : size * (0.55 - b * 0.1),
              dur:     dur + b * 0.18,
              color,
              born:    ts,
            });
          }
        }
      }
      prevTaskStatuses.current[task.id] = task.status;
    });

    if (Object.keys(actUpdates).length) {
      setAgentActivity(prev => ({ ...prev, ...actUpdates }));
    }
    if (newDispatches.length) {
      setUltronFlash(true);
      setTimeout(() => setUltronFlash(false), 400);
      setDispatches(prev => {
        // Keep only dispatches born in the last 4s to avoid unbounded growth
        const cutoff = Date.now() - 4000;
        return [...prev.filter(d => d.born > cutoff), ...newDispatches];
      });
    }
  }, [tasks, agents]);

  // ── ResizeObserver: exact container dims ──────────────────────────────────
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 560 });

  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 20 && height > 20) setDims({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cx = dims.w / 2;
  const cy = dims.h / 2;
  // radius fills ~78 % of the usable half-space (leaving room for node labels)
  const usable = Math.min(dims.w * 0.88, dims.h * 0.82);
  const radius  = (usable / 2) * 0.82;
  const nodeR   = Math.max(20, Math.min(28, radius * 0.115));
  const fSize   = Math.max(9.5, Math.min(13, nodeR * 0.52));

  const filteredAgents = useMemo(
    () => agents.filter((a: any) =>
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (a.badge || '').toLowerCase().includes(searchQuery.toLowerCase())
    ),
    [agents, searchQuery]
  );

  const agentPositions = useMemo(
    () => agents.map((agent: any, i: number) => {
      const theta = (2 * Math.PI * i) / agents.length - Math.PI / 2;
      return { ...agent, x: cx + radius * Math.cos(theta), y: cy + radius * Math.sin(theta) };
    }),
    [agents, cx, cy, radius]
  );

  const orbitPath = (r: number) =>
    `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.001} ${cy - r}`;

  const handleCommand = () => {
    if (input.trim()) {
      addLog({ level: 'info', agent: 'SYSTEM', message: `Executed command: ${input}` });
      setInput('');
    }
  };

  const selectedAgent = agentPositions.find((a: any) => a.id === selectedAgentId);

  return (
    <div className="flex h-full w-full bg-black text-white overflow-hidden font-mono antialiased">

      {/* ── SIDEBAR ─────────────────────────────────────────────────────── */}
      <div className={`${sidebarOpen ? 'w-48 lg:w-56' : 'w-0 overflow-hidden'} transition-all duration-300 border-r border-[#1e1e22] flex flex-col shrink-0 bg-black z-10 relative`}>
        {sidebarOpen && (
          <button onClick={() => setSidebarOpen(false)}
            className="absolute top-3 right-3 z-20 text-zinc-600 hover:text-white text-lg leading-none">&times;</button>
        )}

        <div className="p-3 border-b border-[#1e1e22] flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse shadow-[0_0_6px_rgba(255,255,255,0.8)]" />
            <span className="font-bold tracking-widest text-[10px] uppercase">Ultron</span>
          </div>
          <div className="text-[10px] text-zinc-600">
            {agents.filter((a: any) => a.status === 'running' || a.status === 'active').length} running
          </div>
          <div className="relative">
            <Search size={11} className="absolute left-2 top-2 text-zinc-600" />
            <input type="text" placeholder="Search…" value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-[#0d0d0f] border border-[#27272a] rounded py-1 pl-6 pr-2 text-[10px] text-white focus:outline-none focus:border-zinc-600 placeholder:text-zinc-700 transition-colors" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {filteredAgents.map((agent: any) => {
            const isSel    = selectedAgentId === agent.id;
            const color    = agentColor(agent.name, agent.status);
            const isActive = agent.status === 'running' || agent.status === 'active';
            const isLive   = (agentActivity[agent.id] || 0) > now - ACTIVITY_TTL;
            return (
              <div key={agent.id} onClick={() => handleSelectAgent(agent.id)}
                className={`flex items-center gap-2 px-3 py-2.5 border-b border-[#111] cursor-pointer transition-all duration-150 hover:bg-[#0f0f0f] relative group ${isSel ? 'bg-[#0b0b0e]' : ''}`}
              >
                <div className={`absolute left-0 top-0 bottom-0 w-0.5 origin-left transition-transform duration-150 ${isSel ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100 opacity-50'}`}
                  style={{ backgroundColor: color }} />

                <div className="relative shrink-0">
                  <div className="w-7 h-7 rounded-full border flex items-center justify-center bg-black transition-colors"
                    style={{ borderColor: isSel ? color : '#222', boxShadow: isSel ? `0 0 7px ${color}55` : 'none' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24"
                      stroke={isSel ? color : isActive ? '#888' : '#444'}
                      fill="none">
                      {AGENT_ICONS[agent.name] || AGENT_ICONS['default']}
                    </svg>
                  </div>
                  {isActive && (
                    <svg className="absolute -top-0.5 -left-0.5 w-8 h-8 animate-[spin_4s_linear_infinite]" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="48" fill="none" stroke={isSel ? color : 'rgba(255,255,255,0.25)'}
                        strokeWidth="2.5" strokeDasharray="50 250" strokeLinecap="round" />
                    </svg>
                  )}
                  {/* Real-time activity dot */}
                  {isLive && !isSel && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 animate-pulse"
                      style={{ boxShadow: '0 0 5px #34d399' }} />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center">
                    <span className={`text-[10px] font-medium truncate ${isSel ? 'text-white' : 'text-zinc-500 group-hover:text-zinc-300'}`}>{agent.name}</span>
                    <span className="text-[8px] px-1 border rounded ml-1 shrink-0" style={{ borderColor: color, color }}>{agent.status}</span>
                  </div>
                  <div className="flex gap-1.5 text-[9px] text-zinc-700 mt-0.5">
                    <span className="flex items-center gap-0.5"><Clock size={8} />{agentLiveLatency[agent.id] || agent.latency || '35ms'}</span>
                    <span className="flex items-center gap-0.5"><Zap size={8} />#{agent.tasks ?? agent.tasksCompleted ?? 0}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── CENTER ──────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col relative bg-black min-w-0">
        {!sidebarOpen && (
          <button onClick={() => setSidebarOpen(true)}
            className="absolute top-3 left-3 z-20 text-zinc-600 hover:text-white bg-black/70 p-1.5 rounded border border-[#222] backdrop-blur-sm transition-colors">
            <Menu size={14} />
          </button>
        )}

        {/* SVG canvas */}
        <div ref={canvasContainerRef} className="flex-1 relative overflow-hidden">
          <svg width={dims.w} height={dims.h} viewBox={`0 0 ${dims.w} ${dims.h}`} className="absolute inset-0">
            <defs>
              <filter id="gh"  x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
              <filter id="gs"  x="-35%" y="-35%" width="170%" height="170%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
              <filter id="gl"  x="-5%"  y="-400%" width="110%" height="900%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
              <filter id="gbr" x="-120%" y="-120%" width="340%" height="340%"><feGaussianBlur stdDeviation="16" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>

              <radialGradient id="bg" cx="50%" cy="50%" r="55%">
                <stop offset="0%"   stopColor="#020810" />
                <stop offset="100%" stopColor="#000" />
              </radialGradient>
              <radialGradient id="baura" cx="50%" cy="50%" r="50%">
                <stop offset="0%"   stopColor="#ff6a00" stopOpacity="0.22" />
                <stop offset="40%"  stopColor="#ff3d00" stopOpacity="0.12" />
                <stop offset="75%"  stopColor="#7c2d12" stopOpacity="0.05" />
                <stop offset="100%" stopColor="#000"    stopOpacity="0" />
              </radialGradient>
              <radialGradient id="firecore" cx="50%" cy="50%" r="50%">
                <stop offset="0%"   stopColor="#fff7ed" stopOpacity="0.9" />
                <stop offset="30%"  stopColor="#fb923c" stopOpacity="0.7" />
                <stop offset="70%"  stopColor="#dc2626" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#000"    stopOpacity="0" />
              </radialGradient>

              {/* Per-agent connection gradient */}
              {agentPositions.map((ag: any) => {
                const c = agentColor(ag.name, ag.status);
                return (
                  <linearGradient key={`cg-${ag.id}`} id={`cg-${ag.id}`}
                    x1={ag.x} y1={ag.y} x2={cx} y2={cy} gradientUnits="userSpaceOnUse">
                    <stop offset="0%"   stopColor={c}       stopOpacity="0.95" />
                    <stop offset="65%"  stopColor={c}       stopOpacity="0.30" />
                    <stop offset="100%" stopColor="#ffffff" stopOpacity="0.55" />
                  </linearGradient>
                );
              })}
            </defs>

            {/* Background */}
            <rect x="0" y="0" width={dims.w} height={dims.h} fill="url(#bg)" />

            {/* Dot grid */}
            {Array.from({ length: Math.ceil(dims.h / 46) + 1 }, (_, r) =>
              Array.from({ length: Math.ceil(dims.w / 46) + 1 }, (_, c) => (
                <circle key={`d${r}-${c}`} cx={c * 46} cy={r * 46} r="0.6" fill="#141416" />
              ))
            )}

            {/* Range rings */}
            {[0.25, 0.5, 0.75, 1.0].map((f, ri) => (
              <circle key={`rr-${ri}`} cx={cx} cy={cy} r={(usable / 2) * f}
                fill="none" stroke="#0e0e11" strokeWidth="0.5" />
            ))}

            {/* Radar sweep */}
            <line x1={cx} y1={cy} x2={cx} y2={cy - radius * 1.55}
              stroke="rgba(34,211,238,0.05)" strokeWidth="1.5">
              <animateTransform attributeName="transform" type="rotate"
                from={`0 ${cx} ${cy}`} to={`360 ${cx} ${cy}`} dur="9s" repeatCount="indefinite" />
            </line>

            {/* Orbital tracks */}
            {[0.6, 1.0, 1.38].map((f, ri) => (
              <circle key={`ot-${ri}`} cx={cx} cy={cy} r={radius * f}
                fill="none" stroke={ri === 1 ? '#1c1c20' : '#131315'}
                strokeWidth={ri === 1 ? 0.7 : 0.45} strokeDasharray={ri === 1 ? '3 9' : '1 16'}>
                <animateTransform attributeName="transform" type="rotate"
                  from={ri % 2 ? '360' : '0'} to={ri % 2 ? '0' : '360'}
                  dur={`${88 + ri * 48}s`} repeatCount="indefinite" additive="sum" />
              </circle>
            ))}

            {/* Orbital particles */}
            {[radius * 0.6, radius, radius * 1.38].map((r, ri) =>
              [0, 1].map(pi => (
                <circle key={`op-${ri}-${pi}`} r={ri === 1 ? 2.2 : 1.2}
                  fill={ri === 1 ? '#f97316' : '#252528'} opacity={ri === 1 ? 0.35 : 0.18}>
                  <animateMotion dur={`${15 + ri * 11 + pi * 6}s`}
                    begin={`${-pi * 9}s`} repeatCount="indefinite" path={orbitPath(r)} />
                </circle>
              ))
            )}

            {/* ── Ghost connections — faint synapse web ────────────────── */}
            {agentPositions.map((ag: any) => (
              <path key={`ghost-${ag.id}`} d={synapsePath(ag.x, ag.y, cx, cy)}
                stroke="#181820" strokeWidth="0.55" strokeDasharray="3 10" fill="none" />
            ))}

            {/* ── All agent connection beams — multi-agent simultaneous glow ── */}
            {agentPositions.map((ag: any, i: number) => {
              const isSel     = ag.id === selectedAgentId;
              const isRunning = ag.status === 'running' || ag.status === 'active';
              const isLive    = (agentActivity[ag.id] || 0) > now - ACTIVITY_TTL;
              const isWaiting = ag.status === 'waiting';
              const color     = agentColor(ag.name, ag.status);
              // Each agent gets its own curvature variation so synapses don't overlap
              const curv      = 0.18 + (i % 5) * 0.07;
              const fwd       = synapsePath(ag.x, ag.y, cx, cy, curv);
              const rev       = synapsePath(cx, cy, ag.x, ag.y, curv);

              // Tier determines beam intensity
              // tier 0 = selected  → full beam
              // tier 1 = running   → solid secondary beam
              // tier 2 = live hit  → brief flash
              // tier 3 = waiting   → slow pulse
              // tier 4 = idle      → ambient ghost only (always visible)
              const tier = isSel ? 0 : isRunning ? 1 : isLive ? 2 : isWaiting ? 3 : 4;

              const lineW   = [2.2, 1.8, 1.0, 0.6, 0.35][tier];
              const lineOp  = [0.95, 0.85, 0.55, 0.22, 0.06][tier];
              const glowW   = [14, 12, 5, 3, 0][tier];
              const glowOp  = [0.055, 0.08, 0.04, 0.02, 0][tier];
              const dur     = (isSel ? 1.05 : 1.6) + (i % 4) * 0.3;

              return (
                <g key={`beam-${ag.id}`}>
                  {/* Glow halo — tier 0–2 only */}
                  {tier <= 2 && glowW > 0 && (
                    <path d={fwd} fill="none"
                      stroke={color} strokeWidth={glowW} opacity={glowOp} filter="url(#gl)" />
                  )}

                  {/* Foreground synapse — always rendered, tier 4 = ghost */}
                  <path d={fwd} fill="none"
                    stroke={tier <= 1 ? `url(#cg-${ag.id})` : color}
                    strokeWidth={lineW}
                    opacity={lineOp}
                    strokeDasharray={tier >= 3 ? '3 9' : undefined}>
                    {(tier === 1 || tier === 2) && (
                      <animate attributeName="opacity"
                        values={`${lineOp};${Math.min(1, lineOp * 1.5)};${lineOp}`}
                        dur={`${1.1 + (i % 3) * 0.25}s`} repeatCount="indefinite" />
                    )}
                    {tier === 3 && (
                      <animate attributeName="opacity" values="0.1;0.3;0.1" dur="2.4s" repeatCount="indefinite" />
                    )}
                  </path>

                  {/* Particles — tier 0: heavy stream, tier 1: solid, tier 2: flash burst */}
                  {tier === 0 && [0, dur * 0.36, dur * 0.70].map((begin, pi) => (
                    <circle key={`p0-${pi}`}
                      r={pi === 0 ? 5.5 : pi === 1 ? 3.5 : 2.2}
                      fill={pi === 1 ? '#fff' : color}
                      opacity={1 - pi * 0.18}
                      filter={pi < 2 ? 'url(#gs)' : undefined}>
                      <animateMotion dur={`${dur}s`} begin={`${begin}s`} repeatCount="indefinite" path={fwd} />
                    </circle>
                  ))}
                  {/* Return flow for selected running agents */}
                  {tier === 0 && isRunning && [0, dur * 0.52].map((begin, pi) => (
                    <circle key={`ret-${pi}`}
                      r={pi === 0 ? 4 : 2.5} fill="#a78bfa"
                      opacity={0.85 - pi * 0.2} filter={pi === 0 ? 'url(#gs)' : undefined}>
                      <animateMotion dur={`${dur * 1.35}s`} begin={`${begin}s`}
                        repeatCount="indefinite" path={rev} />
                    </circle>
                  ))}
                  {tier === 0 && isRunning && (
                    <rect x={-6} y={-6} width={12} height={12} rx="2"
                      fill={color} opacity={0.72} filter="url(#gs)">
                      <animateMotion dur={`${dur * 1.7}s`} begin="0.25s" repeatCount="indefinite" path={fwd} />
                    </rect>
                  )}

                  {/* tier 1: running — bright dual-particle stream */}
                  {tier === 1 && (
                    <>
                      <circle r={4.5} fill={color} opacity={0.95} filter="url(#gs)">
                        <animateMotion dur={`${dur}s`} begin={`${i * 0.12}s`} repeatCount="indefinite" path={fwd} />
                      </circle>
                      <circle r={2.5} fill="#fff" opacity={0.6} filter="url(#gs)">
                        <animateMotion dur={`${dur}s`} begin={`${i * 0.12 + dur * 0.48}s`} repeatCount="indefinite" path={fwd} />
                      </circle>
                      {/* return pulse for running non-selected agents */}
                      <circle r={2} fill="#a78bfa" opacity={0.5}>
                        <animateMotion dur={`${dur * 1.5}s`} begin={`${i * 0.08}s`} repeatCount="indefinite" path={rev} />
                      </circle>
                    </>
                  )}

                  {/* tier 2: live flash — single bright burst */}
                  {tier === 2 && (
                    <circle r={3} fill={color} opacity={0.9} filter="url(#gs)">
                      <animateMotion dur={`${dur}s`} begin={`${i * 0.18}s`} repeatCount="indefinite" path={fwd} />
                    </circle>
                  )}
                </g>
              );
            })}

            {/* ── Outbound dispatch bursts: ULTRON → agent ─────────────── */}
            {dispatches.map((d, di) => {
              const ag = agentPositions.find((a: any) => a.id === d.agentId);
              if (!ag) return null;
              const idx  = agentPositions.findIndex((a: any) => a.id === d.agentId);
              const curv = 0.18 + (idx % 5) * 0.07;
              const path = synapsePath(cx, cy, ag.x, ag.y, curv);
              return (
                <g key={d.key}>
                  {/* Main dispatch orb */}
                  <circle r={d.size} fill={d.color} opacity={0.92} filter="url(#gs)">
                    <animateMotion dur={`${d.dur}s`} begin="0s" fill="freeze" path={path} />
                    <animate attributeName="opacity" values="0.92;0.6;0" dur={`${d.dur}s`} fill="freeze" />
                    <animate attributeName="r" values={`${d.size};${d.size * 0.6};${d.size * 0.3}`} dur={`${d.dur}s`} fill="freeze" />
                  </circle>
                  {/* White hot core */}
                  <circle r={d.size * 0.45} fill="#fff" opacity={0.85}>
                    <animateMotion dur={`${d.dur}s`} begin="0s" fill="freeze" path={path} />
                    <animate attributeName="opacity" values="0.85;0.4;0" dur={`${d.dur}s`} fill="freeze" />
                  </circle>
                </g>
              );
            })}

            {/* ── ULTRON dispatch flash ring ────────────────────────────── */}
            {ultronFlash && (
              <circle cx={cx} cy={cy} r={nodeR * 1.62} fill="none"
                stroke="#fb923c" strokeWidth="3" opacity="0.9" filter="url(#gs)">
                <animate attributeName="r"
                  values={`${nodeR * 1.62};${nodeR * 5};${nodeR * 7}`}
                  dur="0.4s" fill="freeze" />
                <animate attributeName="opacity" values="0.9;0.4;0" dur="0.4s" fill="freeze" />
                <animate attributeName="stroke-width" values="3;1;0" dur="0.4s" fill="freeze" />
              </circle>
            )}

            {/* ── Agent nodes — floating + breathing ───────────────────── */}
            {agentPositions.map((ag: any, i: number) => {
              const isSel    = selectedAgentId === ag.id;
              const isHov    = hoveredAgent === ag.id;
              const isActive = ag.status === 'running' || ag.status === 'active';
              const isLive   = (agentActivity[ag.id] || 0) > now - ACTIVITY_TTL;
              const color    = agentColor(ag.name, ag.status);
              const lblW     = Math.max(56, ag.name.length * 6.5 + 14);

              // Per-node float/scale params — varied so no two nodes move in sync
              const floatAmp   = 4 + (i % 4) * 1.5;            // 4 – 8.5 px vertical drift
              const floatDur   = 2.6 + (i % 6) * 0.45;         // 2.6 – 4.85 s
              const floatBegin = (-i * 0.58).toFixed(2);        // phase offset
              const scaleMax   = (1.045 + (i % 3) * 0.012).toFixed(4); // 1.045 – 1.069
              const scaleDur   = 3.2 + (i % 5) * 0.55;         // 3.2 – 5.4 s
              const scaleBegin = -(i * 0.42).toFixed(2);

              const dendGeo = computeDendrites(nodeR, i);

              return (
                <g key={`node-${ag.id}`}
                  transform={`translate(${ag.x}, ${ag.y})`}
                  onClick={() => handleSelectAgent(ag.id)}
                  onMouseEnter={() => setHoveredAgent(ag.id)}
                  onMouseLeave={() => setHoveredAgent(null)}
                  className="cursor-pointer"
                >
                  {/* ── FIXED layer: tips + branches pinned to parent space ── */}
                  <DendriteTips geo={dendGeo} color={color}
                    active={isActive || isLive} selected={isSel} />

                  {/* ── FLOAT layer: soma + shafts drift together ── */}
                  <g>
                    <animateTransform attributeName="transform" type="translate"
                      values={`0,${-floatAmp};0,${floatAmp};0,${-floatAmp}`}
                      dur={`${floatDur}s`} begin={`${floatBegin}s`} repeatCount="indefinite"
                      calcMode="spline"
                      keySplines="0.45 0.05 0.55 0.95;0.45 0.05 0.55 0.95"
                      keyTimes="0;0.5;1" />

                    {/* ── Scale (breathe) layer ── */}
                    <g>
                      <animateTransform attributeName="transform" type="scale"
                        values={`1;${scaleMax};1`}
                        dur={`${scaleDur}s`} begin={`${scaleBegin}s`} repeatCount="indefinite"
                        calcMode="spline"
                        keySplines="0.45 0.05 0.55 0.95;0.45 0.05 0.55 0.95"
                        keyTimes="0;0.5;1" />

                      {/* Shafts — tips animate inversely to float so knobs stay pinned */}
                      <DendriteShafts geo={dendGeo} color={color}
                        active={isActive || isLive} selected={isSel}
                        floatAmp={floatAmp} floatDur={floatDur} floatBegin={floatBegin} />

                      {/* Pulse ring on selection */}
                      {isSel && (
                        <circle r={nodeR + 12} fill="none" stroke={color} strokeWidth="0.8" opacity="0">
                          <animate attributeName="r" values={`${nodeR};${nodeR + 22};${nodeR}`}
                            dur={`${2.3 + (i % 3) * 0.4}s`} repeatCount="indefinite" />
                          <animate attributeName="opacity" values="0;0.55;0"
                            dur={`${2.3 + (i % 3) * 0.4}s`} repeatCount="indefinite" />
                        </circle>
                      )}

                      {/* Live activity flash ring */}
                      {isLive && !isSel && (
                        <circle r={nodeR + 8} fill="none" stroke={color} strokeWidth="0.7" opacity="0">
                          <animate attributeName="r" values={`${nodeR};${nodeR + 18};${nodeR}`} dur="1.4s" repeatCount="indefinite" />
                          <animate attributeName="opacity" values="0;0.4;0" dur="1.4s" repeatCount="indefinite" />
                        </circle>
                      )}

                      {/* Hover/selected glow blob */}
                      {(isHov || isSel) && (
                        <path d={neuronSoma(nodeR + 10, i)}
                          fill={color} opacity={0.06} filter="url(#gh)" />
                      )}

                      {/* ── Neuron soma ── */}
                      <path
                        d={neuronSoma(nodeR, i)}
                        fill="#030810"
                        stroke={isSel ? color : isHov ? '#666' : isLive ? `${color}77` : '#1e1e24'}
                        strokeWidth={isSel ? 2.2 : isLive ? 1.4 : 0.9}
                        filter={isSel ? 'url(#gs)' : undefined}
                      >
                        {(isSel || isLive) && (
                          <animate attributeName="stroke-opacity" values="0.6;1;0.6"
                            dur={`${1.6 + (i % 3) * 0.3}s`} repeatCount="indefinite" />
                        )}
                      </path>

                      {/* Spinner — circle wrapping the soma */}
                      {isActive && (
                        <circle r={nodeR + 6} fill="none"
                          stroke={isSel ? color : isLive ? `${color}55` : 'rgba(255,255,255,0.15)'}
                          strokeWidth={isSel ? 1.5 : 0.7}
                          strokeDasharray="14 10 4 10"
                          className="animate-[spin_4s_linear_infinite]" />
                      )}

                      {/* Error ring */}
                      {ag.status === 'error' && (
                        <circle r={nodeR + 6} fill="none" stroke="#f43f5e" strokeWidth="0.8" strokeDasharray="5 5">
                          <animateTransform attributeName="transform" type="rotate" from="0" to="-360" dur="5s" repeatCount="indefinite" />
                        </circle>
                      )}

                      {/* CLI tool icon */}
                      {(() => {
                        const sz = nodeR * 1.6;
                        const brandSrc = BRAND_ICONS[ag.name];
                        if (brandSrc) {
                          return (
                            <image
                              href={brandSrc}
                              x={-sz / 2} y={-sz / 2}
                              width={sz} height={sz}
                              style={{ opacity: isSel ? 1 : isHov || isLive ? 0.85 : 0.5 }}
                            />
                          );
                        }
                        const iconColor = isSel ? '#fff' : isHov || isLive ? '#ccc' : '#555';
                        const isz = nodeR * 1.15;
                        return (
                          <svg
                            x={-isz / 2} y={-isz / 2}
                            width={isz} height={isz}
                            viewBox="0 0 24 24"
                            stroke={iconColor}
                            overflow="visible"
                          >
                            {AGENT_ICONS[ag.name] || AGENT_ICONS['default']}
                          </svg>
                        );
                      })()}

                      {/* Name pill */}
                      <rect x={-lblW / 2} y={nodeR + 5} width={lblW} height={15} rx="3"
                        fill={isSel ? '#0b1422' : '#050507'}
                        stroke={isSel ? color : isLive ? `${color}44` : '#1a1a1e'}
                        strokeWidth="0.7" />
                      <text x="0" y={nodeR + 16} textAnchor="middle"
                        fill={isSel ? '#d4d4d8' : isLive ? '#888' : '#3f3f46'}
                        fontSize={Math.max(8, fSize * 0.82)} fontFamily="monospace">
                        {ag.name}
                      </text>

                      {/* Hover tooltip */}
                      {isHov && (
                        <g>
                          <rect x={-64} y={-nodeR - 62} width={128} height={54} rx="5"
                            fill="#070b12" stroke="#2a2a30" strokeWidth="0.8" filter="url(#gs)" />
                          <text x={-54} y={-nodeR - 46} fill="#444" fontSize="8.5" fontFamily="monospace">Latency</text>
                          <text x={ 54} y={-nodeR - 46} fill="#e4e4e7" fontSize="8.5" fontFamily="monospace" textAnchor="end">{agentLiveLatency[ag.id] || ag.latency || (ag.avgLatency + 'ms')}</text>
                          <text x={-54} y={-nodeR - 34} fill="#444" fontSize="8.5" fontFamily="monospace">Tasks</text>
                          <text x={ 54} y={-nodeR - 34} fill="#e4e4e7" fontSize="8.5" fontFamily="monospace" textAnchor="end">{ag.tasks ?? ag.tasksCompleted ?? 0}</text>
                          <text x={-54} y={-nodeR - 22} fill="#444" fontSize="8.5" fontFamily="monospace">Model</text>
                          <text x={ 54} y={-nodeR - 22} fill={color}   fontSize="8.5" fontFamily="monospace" textAnchor="end">{ag.model || '—'}</text>
                        </g>
                      )}
                    </g>
                  </g>
                </g>
              );
            })}

            {/* ── Central ULTRON ────────────────────────────────────────── */}
            {(() => {
              const activeCount = agentPositions.filter((ag: any) =>
                ag.status === 'running' || ag.status === 'active').length;
              const isIdle = activeCount === 0;
              const auraOp = isIdle ? '0.2;0.35;0.2' : activeCount >= 4 ? '0.85;1;0.85' : '0.6;0.9;0.6';
              const auraDur = isIdle ? '6s' : activeCount >= 4 ? '1.8s' : '3s';
              return null; // just compute, used in JSX below
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              void auraOp; void auraDur;
            })()}
            <g transform={`translate(${cx}, ${cy})`}>
              {(() => {
                const activeCount = agentPositions.filter((ag: any) =>
                  ag.status === 'running' || ag.status === 'active').length;
                const isIdle = activeCount === 0;
                const auraOp = isIdle ? '0.2;0.35;0.2' : activeCount >= 4 ? '0.85;1;0.85' : '0.6;0.9;0.6';
                const auraDur = isIdle ? '6s' : activeCount >= 4 ? '1.8s' : '3s';
                return (
                  <circle r={nodeR * 3.6} fill="url(#baura)" opacity={isIdle ? 0.2 : 0.7} filter="url(#gbr)">
                    <animate attributeName="r" values={`${nodeR * 3.2};${nodeR * 4.1};${nodeR * 3.2}`} dur={auraDur} repeatCount="indefinite" />
                    <animate attributeName="opacity" values={auraOp} dur={auraDur} repeatCount="indefinite" />
                  </circle>
                );
              })()}

              {/* Fire rings — outer to inner: dark red → orange → amber → white-hot */}
              <circle r={nodeR * 2.9} fill="none" stroke="rgba(220,38,38,0.25)" strokeWidth="0.8" strokeDasharray="16 8 4 10">
                <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="22s" repeatCount="indefinite" />
              </circle>
              <circle r={nodeR * 2.35} fill="none" stroke="rgba(249,115,22,0.55)" strokeWidth="1.0" strokeDasharray="10 6 3 8">
                <animateTransform attributeName="transform" type="rotate" from="360" to="0" dur="13s" repeatCount="indefinite" />
                <animate attributeName="stroke-opacity" values="0.3;0.85;0.3" dur="2.5s" repeatCount="indefinite" />
              </circle>
              <circle r={nodeR * 1.85} fill="none" stroke="rgba(251,191,36,0.5)" strokeWidth="0.7" strokeDasharray="6 5">
                <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="9s" repeatCount="indefinite" />
              </circle>
              <circle r={nodeR * 1.38} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="0.6" strokeDasharray="4 5">
                <animateTransform attributeName="transform" type="rotate" from="360" to="0" dur="16s" repeatCount="indefinite" />
              </circle>

              {/* Core circle — fire border */}
              <circle r={nodeR * 1.62} fill="#0d0500" stroke="#f97316" strokeWidth="1.8" filter="url(#gs)">
                <animate attributeName="stroke-width" values="1.5;3.5;1.5" dur="2.2s" repeatCount="indefinite" />
                <animate attributeName="stroke-opacity" values="0.5;1;0.5" dur="2.2s" repeatCount="indefinite" />
                <animate attributeName="stroke" values="#f97316;#fbbf24;#ef4444;#f97316" dur="4s" repeatCount="indefinite" />
              </circle>

              {/* Ultron head icon — fire color */}
              {(() => {
                const sz = nodeR * 2.6;
                return (
                  <svg x={-sz / 2} y={-sz / 2} width={sz} height={sz}
                    viewBox="0 0 66 66" color="#fb923c" overflow="visible">
                    {ULTRON_HEAD_ICON}
                  </svg>
                );
              })()}

              {/* Tick marks — fire orange */}
              {Array.from({ length: 8 }, (_, k) => {
                const a  = (k / 8) * Math.PI * 2;
                const r1 = nodeR * 1.62;
                const r2 = nodeR * 2.05;
                return (
                  <line key={k}
                    x1={Math.cos(a) * r1} y1={Math.sin(a) * r1}
                    x2={Math.cos(a) * r2} y2={Math.sin(a) * r2}
                    stroke="#f97316" strokeWidth="0.9" opacity="0.5" />
                );
              })}

              {/* ULTRON name pill — fire theme */}
              {(() => {
                const pillY = nodeR * 1.62 + 7;
                const pillW = 60;
                return (
                  <>
                    <rect x={-pillW / 2} y={pillY} width={pillW} height={16} rx="3"
                      fill="#1a0800" stroke="#f97316" strokeWidth="0.8" />
                    <text x="0" y={pillY + 11.5} textAnchor="middle"
                      fill="#fed7aa" fontSize={Math.max(9, fSize * 0.82)}
                      fontFamily="monospace" fontWeight="bold" letterSpacing="1.5">
                      ULTRON
                    </text>
                  </>
                );
              })()}
            </g>

            {/* Radar ripples — fire orange */}
            {[0, 1.7, 3.4].map((delay, i) => (
              <circle key={`rdr-${i}`} cx={cx} cy={cy} r={nodeR} fill="none"
                stroke="rgba(249,115,22,0.4)" strokeWidth="0.7" opacity="0">
                <animate attributeName="r" values={`${nodeR};${radius * 1.45}`}
                  dur="6s" begin={`${delay}s`} repeatCount="indefinite"
                  calcMode="spline" keySplines="0.2 0.8 0.4 1" keyTimes="0;1" />
                <animate attributeName="opacity" values="0.45;0"
                  dur="6s" begin={`${delay}s`} repeatCount="indefinite"
                  calcMode="spline" keySplines="0.2 0.8 0.4 1" keyTimes="0;1" />
              </circle>
            ))}
          </svg>
        </div>

        {/* Command bar */}
        <div className="border-t border-[#1a1a1e] bg-black p-3 flex flex-col gap-2 shrink-0">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {['/task', '/agent', '/priority', '/cancel', '/status', '/logs'].map(cmd => (
              <button key={cmd} onClick={() => setInput(cmd + ' ')}
                className="px-2.5 py-1 text-[10px] border border-[#222] rounded-full text-zinc-600 hover:text-white hover:border-white transition-colors flex items-center gap-1 bg-[#090909] shrink-0">
                <Command size={8} />{cmd}
              </button>
            ))}
          </div>
          <div className="flex items-center border border-[#222] bg-[#050505] rounded overflow-hidden focus-within:border-zinc-600 transition-colors">
            <div className="pl-3 pr-2 text-zinc-700 flex items-center gap-1.5">
              <Terminal size={12} />
              <span className="text-white text-sm">{'>'}</span>
            </div>
            <input type="text"
              className="flex-1 bg-transparent outline-none text-white py-2 px-1 text-sm font-mono placeholder:text-zinc-800"
              placeholder="Enter command…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCommand(); }}
            />
            <button className="px-3 py-2 bg-white text-black font-bold text-[11px] uppercase hover:bg-zinc-200 transition-colors flex items-center gap-1"
              onClick={handleCommand}>
              <Zap size={11} /> Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SwarmRadialTopology;
