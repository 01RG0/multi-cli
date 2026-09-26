import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSwarmStore } from '../store/useSwarmStore';
import { X, Terminal as TerminalIcon, Activity, Database, Clock, Zap, Target, Maximize2 } from 'lucide-react';

// ─── Performance chart ────────────────────────────────────────────────────────

const PERF_W = 400;
const PERF_H = 120;
const PL = 32; // pad left
const PT = 10; // pad top
const PR = 8;  // pad right
const PB = 22; // pad bottom

function genNext(prev: number): number {
  return Math.max(12, Math.min(98, prev + (Math.random() - 0.46) * 11));
}

function initPerfData(n = 60): number[] {
  const d: number[] = [55 + Math.random() * 20];
  for (let i = 1; i < n; i++) d.push(genNext(d[i - 1]));
  return d;
}

function toPoints(data: number[]): Array<[number, number]> {
  const cw = PERF_W - PL - PR;
  const ch = PERF_H - PT - PB;
  return data.map((v, i) => [
    PL + (i / (data.length - 1)) * cw,
    PT + (1 - v / 100) * ch,
  ]);
}

function pointsAttr(pts: Array<[number, number]>): string {
  return pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

function areaAttr(pts: Array<[number, number]>): string {
  const base = PT + PERF_H - PT - PB;
  return [
    ...pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`),
    `${(PERF_W - PR).toFixed(1)},${base.toFixed(1)}`,
    `${PL},${base.toFixed(1)}`,
  ].join(' ');
}

// ─── Memory graph ─────────────────────────────────────────────────────────────

interface GNode { id: string; label: string; x: number; y: number; r: number; color: string; rows: number }
interface GEdge { from: string; to: string; dur: number }

const BASE_NODES: GNode[] = [
  { id: 'kg',        label: 'knowledge_graph', x: 200, y: 100, r: 18, color: '#a855f7', rows: 1     },
  { id: 'tasks',     label: 'tasks',           x:  92, y:  35, r: 13, color: '#38bdf8', rows: 483   },
  { id: 'agents',    label: 'agents',          x: 308, y:  35, r: 13, color: '#38bdf8', rows: 9     },
  { id: 'logs',      label: 'logs',            x: 356, y: 128, r: 11, color: '#34d399', rows: 2948  },
  { id: 'providers', label: 'providers',       x: 278, y: 180, r: 11, color: '#f59e0b', rows: 6     },
  { id: 'files',     label: 'files',           x: 122, y: 180, r: 11, color: '#f59e0b', rows: 127   },
  { id: 'tools',     label: 'tools',           x:  44, y: 128, r: 11, color: '#34d399', rows: 34    },
];

const EDGES: GEdge[] = [
  { from: 'kg', to: 'tasks',     dur: 1.8 },
  { from: 'kg', to: 'agents',    dur: 2.1 },
  { from: 'kg', to: 'logs',      dur: 1.5 },
  { from: 'kg', to: 'providers', dur: 2.4 },
  { from: 'kg', to: 'files',     dur: 2.0 },
  { from: 'kg', to: 'tools',     dur: 1.6 },
  { from: 'tasks',  to: 'agents', dur: 3.0 },
  { from: 'agents', to: 'logs',   dur: 2.5 },
  { from: 'files',  to: 'tools',  dur: 3.2 },
];

function getNode(id: string) { return BASE_NODES.find(n => n.id === id)!; }

// ─── Component ────────────────────────────────────────────────────────────────

interface AgentDeepInspectorProps {
  agentId?: string;
  onClose?: () => void;
  isEmbedded?: boolean;
}

export const AgentDeepInspector: React.FC<AgentDeepInspectorProps> = ({
  agentId = 'opencode',
  onClose,
  isEmbedded = true,
}) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storeSelectedId    = (useSwarmStore as any)((s: any) => s.selectedAgentId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agents             = (useSwarmStore as any)((s: any) => s.agents);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tasks              = (useSwarmStore as any)((s: any) => s.tasks) || [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const logs               = (useSwarmStore as any)((s: any) => s.logs) || [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setSelectedAgentId = (useSwarmStore as any)((s: any) => s.setSelectedAgentId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fetchLogs          = (useSwarmStore as any)((s: any) => s.fetchLogs);

  const resolvedId = storeSelectedId || agentId;
  const rawAgent = agents?.find((a: any) => a.id === resolvedId);

  // Compute real metrics from store tasks
  const agentTasks = useMemo(() => {
    return tasks.filter((t: any) => t.agentId === resolvedId || t.agent?.id === resolvedId || t.agent?.name === resolvedId);
  }, [tasks, resolvedId]);

  const completedTasks = useMemo(() => agentTasks.filter((t: any) => t.status === 'completed'), [agentTasks]);
  const failedTasks = useMemo(() => agentTasks.filter((t: any) => t.status === 'failed'), [agentTasks]);
  const runningTask = useMemo(() => agentTasks.find((t: any) => t.status === 'running'), [agentTasks]);

  const tasksCompletedCount = completedTasks.length > 0 ? completedTasks.length : (rawAgent?.tasksCompleted || 0);
  const totalFinished = completedTasks.length + failedTasks.length;
  const successRate = totalFinished > 0 
    ? Math.round((completedTasks.length / totalFinished) * 100) 
    : (rawAgent?.successRate || 98);
  const errorRate = 100 - successRate;

  const avgLatency = completedTasks.length > 0
    ? Math.round(completedTasks.reduce((acc: number, t: any) => acc + (t.latencyMs || 0), 0) / completedTasks.length)
    : (rawAgent?.avgLatencyMs || rawAgent?.metrics?.avgLatency || 131);

  const tokensUsed = rawAgent?.tokensUsed || (tasksCompletedCount * 1250);

  const agent = {
    name: rawAgent?.name || resolvedId,
    status: runningTask ? 'RUNNING' : (rawAgent?.status?.toUpperCase() || 'IDLE'),
    taskId: runningTask ? runningTask.id : (rawAgent?.currentTaskId || rawAgent?.taskId || '—'),
    metrics: {
      tasksCompleted: tasksCompletedCount,
      successRate,
      errorRate,
      avgLatency,
      tokensUsed,
    },
  };

  useEffect(() => {
    if (fetchLogs) fetchLogs();
  }, [fetchLogs]);

  // ── Live terminal state ──
  const [termLines, setTermLines] = useState<{ id: number; text: string; type: 'cmd' | 'out' | 'log' | 'err' }[]>([]);
  const termRef = useRef<HTMLDivElement>(null);
  const termCounter = useRef(0);

  const [isExpanded, setIsExpanded] = useState(!isEmbedded);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Performance chart state ──
  const [perfData, setPerfData] = useState<number[]>(initPerfData);
  const [perfFlash, setPerfFlash] = useState(false);

  // ── Memory graph state ──
  const [nodeRows, setNodeRows] = useState<Record<string, number>>(
    Object.fromEntries(BASE_NODES.map(n => [n.id, n.rows]))
  );
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const [queryLabel, setQueryLabel] = useState<{ text: string; x: number; y: number } | null>(null);

  // Agent-specific terminal line pools
  const TERM_POOLS: Record<string, { cmd: string; out: string[] }[]> = {
    codex:      [
      { cmd: 'codex run --task generate-tests', out: ['Parsing AST...', 'Generated 12 test cases', 'Coverage: 94.2%'] },
      { cmd: 'codex explain src/auth.ts', out: ['Reading file...', 'JWT middleware detected', 'Token expiry: 3600s'] },
      { cmd: 'codex refactor --pattern hooks', out: ['Scanning hooks...', 'Refactoring 7 files', 'Done ✓'] },
    ],
    agy:        [
      { cmd: 'agy search "deepmind gradient descent"', out: ['Querying knowledge base...', 'Found 38 relevant papers', 'Summarising...'] },
      { cmd: 'agy reason --chain-of-thought', out: ['Step 1: Decompose problem', 'Step 2: Evaluate paths', 'Confidence: 0.91'] },
    ],
    grok:       [
      { cmd: 'grok --query "latest ML papers"', out: ['Searching xAI index...', 'Retrieved 22 results', 'Top: Mixture of Experts v3'] },
      { cmd: 'grok explain --code diff.patch', out: ['Analysing patch...', 'Semantic diff ready', 'No regressions found'] },
    ],
    kilo:       [
      { cmd: 'kilo lint --strict', out: ['Scanning 143 files...', '3 warnings, 0 errors', 'ESLint rules: 58 active'] },
      { cmd: 'kilo typecheck', out: ['Running tsc --noEmit', 'No errors found ✓', 'Build target: ES2022'] },
    ],
    cline:      [
      { cmd: 'cline plan "add auth middleware"', out: ['Planning steps...', 'Step 1: Read existing routes', 'Step 2: Write middleware', 'Step 3: Register routes'] },
      { cmd: 'cline exec --autonomous', out: ['Executing plan...', 'Modified 3 files', 'Running tests...', 'All passing ✓'] },
    ],
    vibe:       [
      { cmd: 'vibe generate --model mistral-7b', out: ['Loading model weights...', 'Temperature: 0.7', 'Generating tokens...', '512 tokens/sec'] },
      { cmd: 'vibe finetune --dataset ./data', out: ['Loading 4.2k samples', 'Epoch 1/3: loss 0.43', 'Epoch 2/3: loss 0.31'] },
    ],
    cursor:     [
      { cmd: 'cursor --edit src/App.tsx', out: ['Opening in editor...', 'AI suggestions ready', 'Apply? [y/n]'] },
      { cmd: 'cursor chat "fix this bug"', out: ['Analysing context...', 'Root cause: null pointer', 'Patch generated'] },
    ],
    opencode:   [
      { cmd: 'opencode run --task refactor', out: ['Reading codebase...', 'Identifying patterns', 'Rewriting 4 modules'] },
      { cmd: 'opencode diff --staged', out: ['+147 -83 lines changed', 'Review ready', 'Linting passed ✓'] },
    ],
    researcher: [
      { cmd: 'researcher fetch --topic "RAG pipelines"', out: ['Fetching from 12 sources...', 'Summarising...', 'Vector stored ✓'] },
      { cmd: 'researcher compare --models gpt-4,claude-3', out: ['Running evals...', 'GPT-4: 87.3%', 'Claude-3: 91.1%'] },
    ],
    jules:      [
      { cmd: 'jules assign --task "fix login bug"', out: ['Cloning repo...', 'Creating branch fix/login-bug', 'Analysing error traces', 'Writing patch...'] },
      { cmd: 'jules pr --auto-review', out: ['Running tests...', '42/42 passed', 'PR ready for review', 'Link: github.com/pr/881'] },
    ],
    debugger:   [
      { cmd: 'debugger trace --pid 4821', out: ['Attaching to process...', 'Breakpoint hit: auth.ts:44', 'Stack unwound'] },
      { cmd: 'debugger heap --snapshot', out: ['Capturing heap...', '142 MB allocated', 'No leaks detected'] },
    ],
  };

  // Seed terminal on agent change, then tick new lines every ~2s
  useEffect(() => {
    setTermLines([]);
    termCounter.current = 0;
    const pool = TERM_POOLS[resolvedId] || TERM_POOLS['opencode'];
    let step = 0;
    let lineIdx = 0;
    let cmdIdx = Math.floor(Math.random() * pool.length);

    const tick = () => {
      const entry = pool[cmdIdx];
      if (step === 0) {
        // emit command line
        setTermLines(prev => {
          const id = termCounter.current++;
          const next = [...prev, { id, text: `$ ${entry.cmd}`, type: 'cmd' as const }];
          return next.slice(-40); // keep last 40 lines
        });
        step = 1;
      } else if (lineIdx < entry.out.length) {
        const txt = entry.out[lineIdx++];
        setTermLines(prev => {
          const id = termCounter.current++;
          const next = [...prev, { id, text: txt, type: (txt.startsWith('!') ? 'err' : 'out') as 'err' | 'out' }];
          return next.slice(-40);
        });
      } else {
        // done with this cmd — pick next
        step = 0;
        lineIdx = 0;
        cmdIdx = (cmdIdx + 1) % pool.length;
      }
    };

    // Initial burst
    tick(); tick(); tick();
    const t = setInterval(tick, 1800);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedId]);

  // Auto-scroll terminal to bottom
  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [termLines]);

  // Click outside to dismiss drawer
  useEffect(() => {
    if (!isExpanded || isEmbedded) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsExpanded(false);
        if (onClose) onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isExpanded, isEmbedded, onClose]);

  // Live performance data ticker (every 950ms)
  useEffect(() => {
    const t = setInterval(() => {
      setPerfData(prev => {
        const next = genNext(prev[prev.length - 1]);
        return [...prev.slice(1), next];
      });
      setPerfFlash(true);
      setTimeout(() => setPerfFlash(false), 120);
    }, 950);
    return () => clearInterval(t);
  }, []);

  // Node activation ticker (every 1.7s)
  useEffect(() => {
    const QUERIES = ['SELECT *', 'INSERT', 'UPDATE', 'JOIN', 'INDEX', 'VACUUM'];
    const t = setInterval(() => {
      const node = BASE_NODES[Math.floor(Math.random() * BASE_NODES.length)];
      setActiveNode(node.id);
      setQueryLabel({
        text: `${QUERIES[Math.floor(Math.random() * QUERIES.length)]} ${node.label}`,
        x: node.x,
        y: node.y - node.r - 10,
      });
      setNodeRows(prev => ({
        ...prev,
        [node.id]: prev[node.id] + Math.floor(Math.random() * 4),
      }));
      setTimeout(() => { setActiveNode(null); setQueryLabel(null); }, 700);
    }, 1700);
    return () => clearInterval(t);
  }, []);

  const isDrawer = isExpanded && !isEmbedded;
  const containerClasses = isDrawer
    ? 'fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm'
    : 'w-full h-full flex flex-col';
  const panelClasses = isDrawer
    ? 'w-full max-w-4xl h-full bg-[#121215] border-l border-[#27272a] shadow-2xl flex flex-col overflow-y-auto animate-in slide-in-from-right duration-300'
    : 'w-full h-full bg-[#121215] border border-[#27272a] rounded-lg flex flex-col overflow-y-auto';

  // Derived chart points
  const pts = toPoints(perfData);
  const curX = pts[pts.length - 1][0];
  const curY = pts[pts.length - 1][1];
  const curVal = perfData[perfData.length - 1];
  const gridYs = [0.25, 0.5, 0.75].map(f => PT + f * (PERF_H - PT - PB));
  const gridXs = [0, 0.25, 0.5, 0.75, 1].map(f => PL + f * (PERF_W - PL - PR));
  const timeLabels = ['−60s', '−45s', '−30s', '−15s', 'NOW'];

  return (
    <div className={containerClasses}>
      <div ref={containerRef} className={panelClasses}>

        {/* Agent selector strip */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-[#27272a] overflow-x-auto no-scrollbar shrink-0">
          <span className="text-zinc-600 text-[10px] font-mono mr-1 shrink-0">AGENT:</span>
          {(agents || []).map((a: any) => {
            const isActive = a.id === resolvedId;
            return (
              <button
                key={a.id}
                onClick={() => setSelectedAgentId(a.id)}
                className={`shrink-0 px-2.5 py-1 rounded text-[10px] font-mono tracking-wide transition-all duration-150 border ${
                  isActive
                    ? 'bg-white text-black border-white font-bold'
                    : 'bg-transparent text-zinc-400 border-zinc-700 hover:border-zinc-400 hover:text-zinc-200'
                }`}
              >
                {a.name?.toUpperCase()}
              </button>
            );
          })}
        </div>

        {/* Header */}
        <div className="p-6 border-b border-[#27272a] flex justify-between items-start">
          <div>
            <div className="text-zinc-500 text-xs font-mono mb-2 tracking-widest">
              ULTRON › AGENTS › {agent.name.toUpperCase()}
            </div>
            <div className="flex items-center gap-4">
              <h1 className="text-4xl font-bold text-white tracking-tight">{agent.name}</h1>
              <span className="px-3 py-1 bg-white/10 text-white text-xs font-medium rounded-full border border-white/20 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                RUNNING TASK #{agent.taskId || 47}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isEmbedded && !isExpanded && (
              <button onClick={() => setIsExpanded(true)} className="p-2 text-zinc-400 hover:text-white transition-colors rounded-md hover:bg-white/5">
                <Maximize2 size={20} />
              </button>
            )}
            {(onClose || isDrawer) && (
              <button onClick={() => { setIsExpanded(false); if (onClose) onClose(); }} className="p-2 text-zinc-400 hover:text-white transition-colors rounded-md hover:bg-white/10 bg-black/20">
                <X size={20} />
              </button>
            )}
          </div>
        </div>

        <div className="p-6 space-y-6 flex-1 flex flex-col">

          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'TASKS COMPLETED', value: agent.metrics?.tasksCompleted || 483, icon: Target },
              { label: 'SUCCESS RATE',    value: `${agent.metrics?.successRate || 97}%`, icon: Activity },
              { label: 'AVG LATENCY',     value: `${agent.metrics?.avgLatency || 131}ms`, icon: Clock },
              { label: 'TOKENS USED',     value: `${((agent.metrics?.tokensUsed || 220000) / 1000).toFixed(0)}K`, icon: Zap },
            ].map((kpi, i) => (
              <div key={i} className="bg-[#121215] border border-[#27272a] rounded-lg p-4 flex flex-col hover:border-zinc-700 transition-colors">
                <div className="flex items-center gap-2 text-zinc-500 text-xs font-medium mb-3">
                  <kpi.icon size={14} />
                  {kpi.label}
                </div>
                <div className="text-2xl font-mono text-white font-semibold">{kpi.value}</div>
              </div>
            ))}
          </div>

          {/* Middle: Terminal + Live Performance Chart */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 overflow-hidden" style={{ minHeight: '260px' }}>

            {/* Terminal */}
            <div className="bg-black border border-[#27272a] rounded-lg flex flex-col font-mono text-xs relative overflow-hidden hover:border-zinc-700 transition-colors h-full">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-[#27272a] bg-[#121215] shrink-0">
                <TerminalIcon size={14} className="text-zinc-400" />
                <span className="text-zinc-400 font-medium tracking-wider">TERMINAL</span>
              </div>
              <div ref={termRef} className="p-4 overflow-y-auto text-zinc-300 space-y-0.5" style={{ maxHeight: '260px' }}>
                {termLines.map(line => (
                  <div key={line.id} className={
                    line.type === 'cmd' ? 'text-emerald-400 font-bold' :
                    line.type === 'err' ? 'text-red-400' :
                    'text-zinc-400'
                  }>
                    {line.type === 'cmd'
                      ? <><span className="text-blue-400">~/{agent.name}</span> {line.text}</>
                      : <><span className="text-zinc-600 mr-2">›</span>{line.text}</>
                    }
                  </div>
                ))}
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-blue-400">~/{agent.name}</span>
                  <span className="text-emerald-400">$</span>
                  <span className="w-2 h-3.5 bg-white animate-pulse inline-block ml-0.5" />
                </div>
              </div>
            </div>

            {/* Live Performance Chart */}
            <div className="bg-[#121215] border border-[#27272a] rounded-lg flex flex-col overflow-hidden hover:border-zinc-700 transition-colors h-full">
              <div className="flex items-center justify-between px-4 py-2 border-b border-[#27272a] shrink-0">
                <div className="flex items-center gap-2">
                  <Activity size={14} className="text-blue-400" />
                  <span className="text-zinc-400 font-medium tracking-wider text-xs font-mono">TERMINAL PERFORMANCE (24H)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-mono font-bold tabular-nums transition-colors duration-100 ${
                      perfFlash ? 'text-blue-300' : 'text-blue-400'
                    }`}
                  >
                    {curVal.toFixed(1)}%
                  </span>
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                </div>
              </div>

              <div className="flex-1 p-3 relative">
                <svg
                  viewBox={`0 0 ${PERF_W} ${PERF_H}`}
                  preserveAspectRatio="none"
                  className="w-full h-full"
                >
                  <defs>
                    <linearGradient id="perf-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgba(56,189,248,0.25)" />
                      <stop offset="100%" stopColor="rgba(56,189,248,0)" />
                    </linearGradient>
                    <filter id="perf-glow">
                      <feGaussianBlur stdDeviation="2" result="blur" />
                      <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                  </defs>

                  {/* Horizontal grid lines */}
                  {gridYs.map((y, i) => (
                    <g key={i}>
                      <line x1={PL} y1={y} x2={PERF_W - PR} y2={y} stroke="#27272a" strokeWidth="0.5" />
                      <text x={PL - 4} y={y + 3} fill="#52525b" fontSize="7" textAnchor="end" fontFamily="monospace">
                        {[75, 50, 25][i]}
                      </text>
                    </g>
                  ))}

                  {/* Vertical grid lines */}
                  {gridXs.map((x, i) => (
                    <line key={i} x1={x} y1={PT} x2={x} y2={PT + PERF_H - PT - PB} stroke="#1c1c1f" strokeWidth="0.5" />
                  ))}

                  {/* Baseline */}
                  <line x1={PL} y1={PT + PERF_H - PT - PB} x2={PERF_W - PR} y2={PT + PERF_H - PT - PB} stroke="#3f3f46" strokeWidth="0.8" />

                  {/* Area fill */}
                  <polygon points={areaAttr(pts)} fill="url(#perf-fill)" />

                  {/* Line */}
                  <polyline
                    points={pointsAttr(pts)}
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                    filter="url(#perf-glow)"
                  />

                  {/* Cursor dot */}
                  <circle cx={curX} cy={curY} r="3.5" fill="#38bdf8" opacity="0.9">
                    <animate attributeName="r" values="3.5;5;3.5" dur="1s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.9;0.5;0.9" dur="1s" repeatCount="indefinite" />
                  </circle>
                  <circle cx={curX} cy={curY} r="7" fill="none" stroke="#38bdf8" strokeWidth="0.8" opacity="0.3">
                    <animate attributeName="r" values="7;12;7" dur="1s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.3;0;0.3" dur="1s" repeatCount="indefinite" />
                  </circle>

                  {/* X-axis labels */}
                  {gridXs.map((x, i) => (
                    <text key={i} x={x} y={PERF_H - 4} fill="#52525b" fontSize="7" textAnchor="middle" fontFamily="monospace">
                      {timeLabels[i]}
                    </text>
                  ))}
                </svg>
              </div>
            </div>
          </div>

          {/* Bottom: Memory Context SQLite Graph */}
          <div className="bg-[#121215] border border-[#27272a] rounded-lg flex flex-col min-h-[230px] overflow-hidden hover:border-zinc-700 transition-colors">
            <div className="flex items-center justify-between px-4 py-2 border-b border-[#27272a]">
              <div className="flex items-center gap-2">
                <Database size={14} className="text-purple-400" />
                <span className="text-zinc-400 font-medium tracking-wider text-xs font-mono">MEMORY CONTEXT (SQLITE GRAPH)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-zinc-500 font-mono border border-[#27272a] px-2 py-0.5 rounded">
                  {BASE_NODES.length} tables
                </span>
                <span className="text-[10px] text-emerald-500 font-mono border border-emerald-900/50 bg-emerald-900/20 px-2 py-0.5 rounded flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  LIVE
                </span>
              </div>
            </div>

            <div className="flex-1 relative bg-[#0a0a0c]">
              <svg viewBox="0 0 400 220" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
                <defs>
                  {BASE_NODES.map(n => (
                    <filter key={`glow-${n.id}`} id={`glow-${n.id}`} x="-40%" y="-40%" width="180%" height="180%">
                      <feGaussianBlur stdDeviation={n.id === activeNode ? '5' : '3'} result="blur" />
                      <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                  ))}
                </defs>

                {/* Edges with flowing dash animation */}
                {EDGES.map((e, i) => {
                  const a = getNode(e.from);
                  const b = getNode(e.to);
                  const isActive = activeNode === e.from || activeNode === e.to;
                  return (
                    <line
                      key={i}
                      x1={a.x} y1={a.y}
                      x2={b.x} y2={b.y}
                      stroke={isActive ? '#6d28d9' : '#27272a'}
                      strokeWidth={isActive ? 1.5 : 0.8}
                      strokeDasharray="5 4"
                    >
                      <animate
                        attributeName="stroke-dashoffset"
                        from="0"
                        to="-18"
                        dur={`${e.dur}s`}
                        repeatCount="indefinite"
                      />
                      {isActive && (
                        <animate
                          attributeName="stroke-opacity"
                          values="0.6;1;0.6"
                          dur="0.4s"
                          repeatCount="indefinite"
                        />
                      )}
                    </line>
                  );
                })}

                {/* Nodes */}
                {BASE_NODES.map(n => {
                  const isAct = activeNode === n.id;
                  const rows = nodeRows[n.id] ?? n.rows;
                  return (
                    <g key={n.id}>
                      {/* Outer pulse ring */}
                      <circle cx={n.x} cy={n.y} r={n.r + 6} fill="none" stroke={n.color} strokeWidth="0.5" opacity="0">
                        <animate
                          attributeName="r"
                          values={`${n.r};${n.r + 10};${n.r}`}
                          dur={`${2 + (n.x % 7) * 0.3}s`}
                          repeatCount="indefinite"
                        />
                        <animate
                          attributeName="opacity"
                          values="0;0.35;0"
                          dur={`${2 + (n.x % 7) * 0.3}s`}
                          repeatCount="indefinite"
                        />
                      </circle>

                      {/* Core circle */}
                      <circle
                        cx={n.x}
                        cy={n.y}
                        r={n.r}
                        fill="#18181b"
                        stroke={isAct ? n.color : '#3f3f46'}
                        strokeWidth={isAct ? 2.5 : 1.5}
                        filter={isAct ? `url(#glow-${n.id})` : undefined}
                      >
                        {isAct && (
                          <animate
                            attributeName="stroke-opacity"
                            values="0.7;1;0.7"
                            dur="0.35s"
                            repeatCount="indefinite"
                          />
                        )}
                      </circle>

                      {/* Center dot */}
                      <circle cx={n.x} cy={n.y} r={n.r * 0.28} fill={n.color} opacity={isAct ? 1 : 0.6}>
                        <animate
                          attributeName="opacity"
                          values={isAct ? '0.8;1;0.8' : '0.5;0.7;0.5'}
                          dur={`${1.5 + (n.y % 5) * 0.4}s`}
                          repeatCount="indefinite"
                        />
                      </circle>

                      {/* Label below */}
                      <text
                        x={n.x}
                        y={n.y + n.r + 11}
                        fill={isAct ? n.color : '#71717a'}
                        fontSize="8"
                        textAnchor="middle"
                        fontFamily="monospace"
                        fontWeight={isAct ? 'bold' : 'normal'}
                      >
                        {n.label}
                      </text>

                      {/* Row count badge */}
                      <text
                        x={n.x}
                        y={n.y + n.r + 19}
                        fill={isAct ? '#a1a1aa' : '#3f3f46'}
                        fontSize="6.5"
                        textAnchor="middle"
                        fontFamily="monospace"
                      >
                        {rows.toLocaleString()} rows
                      </text>
                    </g>
                  );
                })}

                {/* Floating query flash label */}
                {queryLabel && (
                  <text
                    x={queryLabel.x}
                    y={queryLabel.y}
                    fill="#a855f7"
                    fontSize="7.5"
                    textAnchor="middle"
                    fontFamily="monospace"
                    opacity="0.9"
                  >
                    <animate attributeName="opacity" values="0;1;0" dur="0.7s" begin="0s" fill="freeze" />
                    {queryLabel.text}
                  </text>
                )}
              </svg>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default AgentDeepInspector;
