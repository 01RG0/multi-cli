import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { Brain, Plus, Search, ZoomIn, ZoomOut, Maximize2, Tag } from 'lucide-react';

type MemType = 'episodic' | 'semantic' | 'working' | 'procedural' | 'index';
interface MemNode {
  id: string; label: string; type: MemType; content: string;
  tags: string[]; connections: string[];
  activation: number; x: number; y: number;
}
const TYPE_META: Record<MemType, { color: string; glow: string; label: string }> = {
  episodic:   { color: '#f59e0b', glow: '#fbbf24', label: 'Episodic'   },
  semantic:   { color: '#22d3ee', glow: '#67e8f9', label: 'Semantic'   },
  working:    { color: '#f8fafc', glow: '#ffffff', label: 'Working'    },
  procedural: { color: '#4ade80', glow: '#86efac', label: 'Procedural' },
  index:      { color: '#a855f7', glow: '#c084fc', label: 'Index'      },
};

const SEED_NODES: MemNode[] = [
  { id:'idx',          label:'MEMORY.md',        type:'index',      content:'Root memory index linking all persistent knowledge nodes across project context.',                   tags:['index','root'],       connections:['user_role','fb_routing','fb_terse','proj_swarm','proj_complete','proj_prd','agent_map'], activation:0.92, x:620, y:420 },
  { id:'user_role',    label:'User Role',         type:'semantic',   content:'Senior full-stack engineer building AI orchestrator dashboard. Deep React/TypeScript experience.', tags:['user','role'],        connections:['idx','user_prefs','wm_neurons'],                                                       activation:0.70, x:280, y:210 },
  { id:'user_prefs',   label:'User Preferences',  type:'semantic',   content:'Dark UI. Terse output. No trailing summaries. No emojis. Monochrome aesthetic.',                  tags:['user','ux'],          connections:['user_role','fb_terse'],                                                               activation:0.55, x:110, y:390 },
  { id:'fb_routing',   label:'Routing=Dynamic',   type:'procedural', content:'Routing rules must be built from live activity patterns and past task history.',                   tags:['feedback','routing'], connections:['idx','fb_terse'],                                                                    activation:0.95, x:400, y:660 },
  { id:'fb_terse',     label:'Terse Output',      type:'procedural', content:'No recap. No trailing explanation. State results directly. One sentence max.',                    tags:['feedback','style'],   connections:['idx','user_prefs'],                                                                  activation:0.82, x:190, y:590 },
  { id:'fb_zustand',   label:'Zustand Selector',  type:'procedural', content:'Always write: useSwarmStore(s => s.field). Required for correct reactivity.',                    tags:['feedback','code'],    connections:['proj_complete'],                                                                     activation:0.65, x:920, y:230 },
  { id:'proj_swarm',   label:'Swarm Setup',       type:'episodic',   content:'9 sub-agent CLIs installed and working. Free models. No API keys required.',                     tags:['project','agents'],   connections:['idx','proj_complete','agent_map'],                                                    activation:0.58, x:870, y:580 },
  { id:'proj_prd',     label:'Orchestrator PRD',  type:'episodic',   content:'Go + React + SQLite + WebSocket. 7 milestones. M7 research sweep complete.',                     tags:['project','prd'],      connections:['idx','proj_swarm'],                                                                   activation:0.42, x:1040,y:400 },
  { id:'proj_complete',label:'Milestones Done',   type:'episodic',   content:'All 7 milestones shipped 2026-09-24. 31 tests pass. Proxy live on :8080.',                       tags:['project','shipped'],  connections:['idx','fb_zustand','proj_swarm'],                                                      activation:0.88, x:800, y:190 },
  { id:'wm_neurons',   label:'Neuron UI Active',  type:'working',    content:'Building neuron topology: pinned dendrite tips, fire ULTRON, per-agent identity colors.',        tags:['working','ui'],       connections:['wm_colors','proj_complete','user_role'],                                              activation:1.0,  x:390, y:230 },
  { id:'wm_colors',    label:'Agent Color Map',   type:'working',    content:'opencode=cyan, codex=green, jules=purple, cline=indigo, vibe=orange, cursor=grey, ULTRON=fire.', tags:['working','colors'],   connections:['wm_neurons','agent_map'],                                                             activation:1.0,  x:240, y:90  },
  { id:'agent_map',    label:'11 Agents',         type:'semantic',   content:'opencode codex vibe agy grok kilo cline researcher debugger cursor jules',                       tags:['agents'],             connections:['proj_swarm','wm_colors','idx'],                                                       activation:0.68, x:640, y:100 },
];

// ── Geometry ──────────────────────────────────────────────────────────────────
function growBranch(
  shafts: string[], boutons: { x: number; y: number; r: number }[],
  x: number, y: number, angle: number, length: number,
  depth: number, seed: number, bi: number,
) {
  if (length < 4 || depth === 0) { boutons.push({ x, y, r: 1.1 + (seed % 3) * 0.25 }); return; }
  const ex = x + Math.cos(angle) * length, ey = y + Math.sin(angle) * length;
  const wx = Math.sin(seed * 7.3 + bi * 3.1 + depth * 1.7) * length * 0.18;
  const wy = Math.cos(seed * 5.9 + bi * 2.7 + depth * 2.1) * length * 0.18;
  shafts.push(`M ${x.toFixed(1)} ${y.toFixed(1)} Q ${((x+ex)/2+wx).toFixed(1)} ${((y+ey)/2+wy).toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`);
  const spread  = 0.42 + Math.abs(Math.sin(seed * 2.3 + bi)) * 0.24;
  const lenMult = 0.58 + Math.sin(seed * 3.1 + bi + depth) * 0.07;
  growBranch(shafts, boutons, ex, ey, angle + spread, length * lenMult, depth - 1, seed, bi * 2);
  growBranch(shafts, boutons, ex, ey, angle - spread, length * lenMult, depth - 1, seed, bi * 2 + 1);
}

interface NeuronGeom {
  somaD: string; shaftsD: string;
  boutons: { x: number; y: number; r: number }[];
  axonEnd: { x: number; y: number };
}

function buildNeuron(seed: number, activation: number, cs: number, depth = 2): NeuronGeom {
  const somaR  = 7 + activation * 8 + cs * 5;
  const spread = 44 + activation * 32 + cs * 18;
  const n = 10;
  const sPts: [number, number][] = Array.from({ length: n }, (_, k) => {
    const a = (k / n) * Math.PI * 2 - Math.PI / 2;
    const v = 0.68 + (Math.sin(seed * 19.1 + k * 2.61) * 0.5 + 0.5) * 0.32;
    return [Math.cos(a) * somaR * v, Math.sin(a) * somaR * v];
  });
  const sMids = sPts.map((p, i) => { const q = sPts[(i+1)%n]; return [(p[0]+q[0])/2, (p[1]+q[1])/2] as [number,number]; });
  let somaD = `M ${sMids[n-1][0].toFixed(1)} ${sMids[n-1][1].toFixed(1)}`;
  for (let k = 0; k < n; k++) somaD += ` Q ${sPts[k][0].toFixed(1)} ${sPts[k][1].toFixed(1)} ${sMids[k][0].toFixed(1)} ${sMids[k][1].toFixed(1)}`;
  somaD += ' Z';
  const rawShafts: string[] = [], boutons: { x: number; y: number; r: number }[] = [];
  const tc = 4 + (seed % 3);
  for (let t = 0; t < tc; t++) {
    const base = ((t / tc) * Math.PI * 1.75 - Math.PI * 0.875) + Math.sin(seed * 5.1 + t * 2.3) * 0.2;
    const sx = Math.cos(base) * somaR * 0.9, sy = Math.sin(base) * somaR * 0.9;
    growBranch(rawShafts, boutons, sx, sy, base, spread * (0.5 + Math.abs(Math.sin(seed * 3.7 + t)) * 0.32), depth, seed + t * 7, t);
  }
  const axA = Math.PI / 2 + Math.sin(seed * 2.7) * 0.32, axL = spread * 1.7;
  const axonEnd = { x: Math.cos(axA) * axL, y: Math.sin(axA) * axL };
  rawShafts.push(`M 0 0 Q ${(axonEnd.x/2+Math.sin(seed*4.1)*axL*0.1).toFixed(1)} ${(axonEnd.y/2).toFixed(1)} ${axonEnd.x.toFixed(1)} ${axonEnd.y.toFixed(1)}`);
  growBranch(rawShafts, boutons, axonEnd.x, axonEnd.y, axA - 0.45, axL * 0.18, 1, seed + 13, 20);
  growBranch(rawShafts, boutons, axonEnd.x, axonEnd.y, axA + 0.45, axL * 0.18, 1, seed + 26, 21);
  return { somaD, shaftsD: rawShafts.join(' '), boutons: boutons.slice(0, 20), axonEnd };
}

function edgePath(x1: number, y1: number, x2: number, y2: number) {
  const dx = x2-x1, dy = y2-y1, mx = (x1+x2)/2, my = (y1+y2)/2;
  return `M ${x1} ${y1} Q ${(mx-dy*0.18).toFixed(1)} ${(my+dx*0.18).toFixed(1)} ${x2} ${y2}`;
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function MemoryNeuralGraph() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dims, setDims]     = useState({ w: 900, h: 560 });
  const [zoom, setZoom]     = useState(0.72);
  const [pan, setPan]       = useState({ x: 30, y: 30 });
  const [sel, setSel]       = useState<string | null>(null);
  const [hov, setHov]       = useState<string | null>(null);
  const [hovEdge, setHovEdge] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [nodes, setNodes]   = useState<MemNode[]>(SEED_NODES);
  const [showAdd, setShowAdd] = useState(false);
  const [nLabel, setNLabel] = useState('');
  const [nType, setNType]   = useState<MemType>('working');
  const [nText, setNText]   = useState('');
  const drag = useRef<{ ox: number; oy: number; px: number; py: number } | null>(null);

  useEffect(() => { try { const s = localStorage.getItem('ultron_memgraph'); if (s) setNodes(JSON.parse(s)); } catch {} }, []);
  useEffect(() => { try { localStorage.setItem('ultron_memgraph', JSON.stringify(nodes)); } catch {} }, [nodes]);

  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      if (width > 40 && height > 40) setDims({ w: width, h: height });
    });
    ro.observe(el); return () => ro.disconnect();
  }, []);

  const onDown  = useCallback((e: React.MouseEvent) => { if ((e.target as Element).closest('.nn')) return; drag.current = { ox: e.clientX, oy: e.clientY, px: pan.x, py: pan.y }; }, [pan]);
  const onMove  = useCallback((e: React.MouseEvent) => { if (!drag.current) return; setPan({ x: drag.current.px + e.clientX - drag.current.ox, y: drag.current.py + e.clientY - drag.current.oy }); }, []);
  const onUp    = useCallback(() => { drag.current = null; }, []);
  const onWheel = useCallback((e: React.WheelEvent) => { e.preventDefault(); setZoom(z => Math.max(0.18, Math.min(2.6, z - e.deltaY * 0.001))); }, []);

  const filtered = useMemo(() => {
    if (!search) return null;
    const q = search.toLowerCase();
    return new Set(nodes.filter(n => n.label.toLowerCase().includes(q) || n.content.toLowerCase().includes(q) || n.tags.some(t => t.includes(q))).map(n => n.id));
  }, [search, nodes]);

  // depth=3 for selected node (more dendrites), depth=2 otherwise (perf)
  const geomMap = useMemo(() => {
    const m = new Map<string, NeuronGeom>();
    nodes.forEach((n, i) => {
      const cs = Math.min(n.content.length / 250, 1);
      m.set(n.id, buildNeuron(i, n.activation, cs, sel === n.id ? 3 : 2));
    });
    return m;
  }, [nodes, sel]);

  const selNode  = nodes.find(n => n.id === sel) ?? null;
  const selColor = selNode ? TYPE_META[selNode.type].color : '#fff';

  const addNode = () => {
    if (!nLabel.trim()) return;
    const id = `mem_${Date.now()}`;
    const nn: MemNode = { id, label: nLabel.trim(), type: nType, content: nText.trim(), tags: [nType], connections: sel ? [sel] : [], activation: 1.0, x: 620 + (Math.random() - 0.5) * 300, y: 420 + (Math.random() - 0.5) * 200 };
    setNodes(prev => { const next = [...prev, nn]; if (sel) return next.map(n => n.id === sel ? { ...n, connections: [...new Set([...n.connections, id])] } : n); return next; });
    setNLabel(''); setNText(''); setShowAdd(false);
  };

  return (
    <div className="flex flex-col h-full bg-[#060402] font-mono text-white overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#1c1508] shrink-0 bg-[#090602]">
        <div className="flex items-center gap-2">
          <Brain size={13} className="text-amber-500" />
          <span className="text-[11px] font-bold tracking-widest text-zinc-300">MEMORY CORTEX</span>
          <span className="text-[9px] text-zinc-700 ml-1">SQLite · {nodes.length} neurons</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <Search size={9} className="absolute left-2 top-[5px] text-zinc-700" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="search…"
              className="bg-black border border-zinc-900 text-[10px] text-white pl-5 pr-2 py-0.5 rounded focus:outline-none focus:border-amber-700 w-28 placeholder:text-zinc-800" />
          </div>
          <button onClick={() => setZoom(z => Math.min(2.6, z + 0.12))} className="text-zinc-700 hover:text-white p-0.5"><ZoomIn size={11} /></button>
          <button onClick={() => setZoom(z => Math.max(0.18, z - 0.12))} className="text-zinc-700 hover:text-white p-0.5"><ZoomOut size={11} /></button>
          <button onClick={() => { setZoom(0.72); setPan({ x: 30, y: 30 }); }} className="text-zinc-700 hover:text-white p-0.5"><Maximize2 size={11} /></button>
          <button onClick={() => setShowAdd(v => !v)}
            className="flex items-center gap-1 bg-amber-950/50 hover:bg-amber-900/50 border border-amber-900/60 text-amber-500 text-[10px] px-2 py-0.5 rounded">
            <Plus size={9} /> NODE
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-[#1c1508] bg-[#0c0804] shrink-0 flex-wrap">
          <input value={nLabel} onChange={e => setNLabel(e.target.value)} placeholder="label"
            className="bg-black border border-zinc-900 text-[10px] text-white px-2 py-0.5 rounded focus:outline-none focus:border-amber-700 w-28" />
          <select value={nType} onChange={e => setNType(e.target.value as MemType)}
            className="bg-black border border-zinc-900 text-[10px] text-white px-2 py-0.5 rounded">
            {(Object.keys(TYPE_META) as MemType[]).map(t => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
          </select>
          <input value={nText} onChange={e => setNText(e.target.value)} placeholder="content"
            className="bg-black border border-zinc-900 text-[10px] text-white px-2 py-0.5 rounded flex-1 min-w-24 focus:outline-none focus:border-amber-700" />
          <button onClick={addNode} className="bg-amber-600 hover:bg-amber-500 text-black text-[10px] font-bold px-3 py-0.5 rounded">ADD</button>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        <div ref={wrapRef}
          className="flex-1 relative overflow-hidden cursor-grab active:cursor-grabbing"
          style={{ background: 'radial-gradient(ellipse at 50% 45%, #0e0a05 0%, #020100 100%)' }}
          onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} onWheel={onWheel}>

          <svg width={dims.w} height={dims.h} className="absolute inset-0 select-none">
            <defs>
              <filter id="fng" x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur stdDeviation="5" result="b1" />
                <feGaussianBlur stdDeviation="2" result="b2" in="SourceGraphic" />
                <feMerge><feMergeNode in="b1" /><feMergeNode in="b2" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <filter id="fns" x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="2.5" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <filter id="fnb" x="-120%" y="-120%" width="340%" height="340%">
                <feGaussianBlur stdDeviation="3" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <filter id="fne" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="1.2" />
              </filter>
              {(Object.entries(TYPE_META) as [MemType, typeof TYPE_META[MemType]][]).map(([t, m]) => (
                <radialGradient key={t} id={`sg-${t}`} cx="35%" cy="30%" r="70%">
                  <stop offset="0%"   stopColor={m.glow}  stopOpacity="0.55" />
                  <stop offset="45%"  stopColor={m.color} stopOpacity="0.2" />
                  <stop offset="100%" stopColor="#000"    stopOpacity="0" />
                </radialGradient>
              ))}
            </defs>

            <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>

              {/* ── Edges — always visible, thickness by activation weight ── */}
              {nodes.map(src => src.connections.map(dstId => {
                const dst = nodes.find(n => n.id === dstId); if (!dst) return null;
                const ekey = `${src.id}:${dstId}`;
                const isFoc = sel === src.id || sel === dstId || hov === src.id || hov === dstId || hovEdge === ekey;
                const isVis = filtered ? filtered.has(src.id) || filtered.has(dstId) : true;
                const col   = TYPE_META[src.type].color;
                const act   = (src.activation + dst.activation) / 2;
                const edW   = isFoc ? 0.9 + act * 0.5 : 0.35 + act * 0.45;
                const edOp  = isFoc ? 0.82 : 0.18 + act * 0.28;
                const d     = edgePath(src.x, src.y, dst.x, dst.y);
                const sigDur = `${1.5 + ((src.id.length + dstId.length) % 8) * 0.2}s`;
                const mx = (src.x + dst.x) / 2, my = (src.y + dst.y) / 2;
                return (
                  <g key={ekey} opacity={isVis ? 1 : 0.05}
                    onMouseEnter={() => setHovEdge(ekey)}
                    onMouseLeave={() => setHovEdge(null)}
                    style={{ cursor: 'pointer' }}>
                    {/* Wide hit area */}
                    <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
                    {/* Soft glow halo */}
                    {act > 0.6 && <path d={d} fill="none" stroke={col} strokeWidth={edW + 1} opacity={0.07} filter="url(#fne)" />}
                    {/* Focused halo */}
                    {isFoc && <path d={d} fill="none" stroke={col} strokeWidth={edW + 2} opacity={0.14} filter="url(#fne)" />}
                    {/* Wire */}
                    <path d={d} fill="none" stroke={col} strokeWidth={edW} opacity={edOp} strokeLinecap="round" />
                    {/* Signal particle — only focused edges (perf) */}
                    {isFoc && (
                      <circle r={2.5} fill={col} opacity={0.9} filter="url(#fnb)">
                        <animateMotion dur={sigDur} repeatCount="indefinite" path={d} />
                      </circle>
                    )}
                    {/* Ambient slow signal on high-act edges */}
                    {!isFoc && act > 0.75 && (
                      <circle r={1.2} fill={col} opacity={0.28}>
                        <animateMotion dur={`${3 + act}s`} repeatCount="indefinite" path={d} />
                      </circle>
                    )}
                    {/* Synaptic cleft dot at target */}
                    <circle cx={dst.x} cy={dst.y} r={isFoc ? 3.5 : 2} fill={col} opacity={isFoc ? 0.45 : 0.1} filter="url(#fnb)" />

                    {/* ── Connection context labels (Obsidian-style) ── */}
                    {isFoc && (() => {
                      const midText = `${src.label} → ${dst.label}`;
                      const midW = Math.max(80, midText.length * 4.3 + 14);
                      const srcW = Math.max(56, src.label.length * 4.1 + 14);
                      const dstW = Math.max(56, dst.label.length * 4.1 + 14);
                      return (
                        <>
                          {/* Edge midpoint label */}
                          <rect x={mx - midW / 2} y={my - 9} width={midW} height={13} rx={3}
                            fill="#09070400" stroke={col} strokeWidth={0.6} opacity={0.92} />
                          <rect x={mx - midW / 2} y={my - 9} width={midW} height={13} rx={3} fill="#0a0705" opacity={0.88} />
                          <text x={mx} y={my + 1.5} textAnchor="middle" fill={col} fontSize={7} fontFamily="monospace">
                            {midText}
                          </text>
                          {/* Source endpoint pill */}
                          <rect x={src.x - srcW / 2} y={src.y - 21} width={srcW} height={12} rx={3} fill="#0a0705" stroke={TYPE_META[src.type].color} strokeWidth={0.5} opacity={0.9} />
                          <text x={src.x} y={src.y - 12} textAnchor="middle" fill={TYPE_META[src.type].color} fontSize={6.5} fontFamily="monospace">{src.label}</text>
                          {/* Dest endpoint pill */}
                          <rect x={dst.x - dstW / 2} y={dst.y + 8} width={dstW} height={12} rx={3} fill="#0a0705" stroke={TYPE_META[dst.type].color} strokeWidth={0.5} opacity={0.9} />
                          <text x={dst.x} y={dst.y + 17} textAnchor="middle" fill={TYPE_META[dst.type].color} fontSize={6.5} fontFamily="monospace">{dst.label}</text>
                        </>
                      );
                    })()}
                  </g>
                );
              }))}

              {/* ── Neurons ────────────────────────────────────────────────── */}
              {nodes.map((node, ni) => {
                const meta   = TYPE_META[node.type];
                const color  = meta.color, glow = meta.glow;
                const isSel  = sel === node.id, isHov = hov === node.id;
                const isVis  = filtered ? filtered.has(node.id) : true;
                const geom   = geomMap.get(node.id)!;
                const cs     = Math.min(node.content.length / 250, 1);
                const somaR  = 7 + node.activation * 8 + cs * 5;
                const shaftOp = isSel ? 0.9 : isHov ? 0.72 : 0.28 + node.activation * 0.38;
                const shaftW  = isSel ? 1.0 : 0.5 + node.activation * 0.3;
                const bDur    = `${3.2 + (ni * 0.31) % 1.8}s`;
                const bDel    = `${(ni * 0.47) % 2.5}s`;
                const fDur    = `${4.5 + (ni * 0.53) % 2.5}s`;

                return (
                  <g key={node.id} className="nn"
                    transform={`translate(${node.x},${node.y})`}
                    opacity={isVis ? 1 : 0.07}
                    onClick={() => setSel(s => s === node.id ? null : node.id)}
                    onMouseEnter={() => setHov(node.id)}
                    onMouseLeave={() => setHov(null)}
                    style={{ cursor: 'pointer' }}>

                    {/* Selection pulse */}
                    {isSel && (
                      <circle r={somaR + 6} fill="none" stroke={color} strokeWidth="0.8" opacity="0">
                        <animate attributeName="r"       values={`${somaR+2};${somaR+26};${somaR+2}`} dur="2.2s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0;0.5;0"                              dur="2.2s" repeatCount="indefinite" />
                      </circle>
                    )}

                    {/* Ambient cloud — high activation only */}
                    {node.activation > 0.6 && (
                      <circle r={somaR * 1.8} fill={color} opacity="0" filter="url(#fng)">
                        <animate attributeName="opacity" values={`0;${0.04 + node.activation * 0.09};0`} dur={fDur} begin={bDel} repeatCount="indefinite" />
                        <animate attributeName="r"       values={`${somaR*1.4};${somaR*2.5};${somaR*1.4}`} dur={fDur} begin={bDel} repeatCount="indefinite" />
                      </circle>
                    )}

                    {/* Shafts + boutons — static, always rooted at node.x,y */}
                    {(isSel || isHov) && <path d={geom.shaftsD} fill="none" stroke={glow} strokeWidth={3} opacity={0.1} filter="url(#fng)" />}
                    <path d={geom.shaftsD} fill="none" stroke={color} strokeWidth={shaftW} opacity={shaftOp} strokeLinecap="round" />

                    {geom.boutons.map((b, bi) => {
                      const bOp = isSel ? 1.0 : isHov ? 0.85 : 0.38 + node.activation * 0.45;
                      return (
                        <g key={bi}>
                          <circle cx={b.x} cy={b.y} r={b.r * 2.5} fill={glow} opacity={bOp * 0.25} filter="url(#fnb)" />
                          <circle cx={b.x} cy={b.y} r={b.r} fill={glow} opacity={bOp}>
                            <animate attributeName="r"
                              values={`${b.r};${b.r * 1.5};${b.r}`}
                              dur={`${2.3 + (bi * 0.19) % 1.2}s`}
                              begin={`${(bi * 0.23) % 2}s`}
                              repeatCount="indefinite" />
                          </circle>
                        </g>
                      );
                    })}

                    <circle cx={geom.axonEnd.x} cy={geom.axonEnd.y} r={3} fill={color} opacity={shaftOp * 0.7} filter="url(#fnb)" />

                    {/* Soma — scale-breathes in place, stays at node.x,y */}
                    <g>
                      <animateTransform attributeName="transform" type="scale"
                        values={`1;${1 + node.activation * 0.06};1`}
                        dur={bDur} begin={bDel} repeatCount="indefinite" additive="sum" />
                      <path d={geom.somaD} fill={`url(#sg-${node.type})`} />
                      <path d={geom.somaD} fill="none"
                        stroke={isSel ? glow : isHov ? `${color}dd` : `${color}60`}
                        strokeWidth={isSel ? 1.5 : 0.7}
                        filter={isSel ? 'url(#fns)' : undefined}>
                        {isSel && <animate attributeName="stroke-opacity" values="0.5;1;0.5" dur={bDur} begin={bDel} repeatCount="indefinite" />}
                      </path>
                      {/* Nucleus */}
                      <circle r={somaR * 0.32} fill="none" stroke={color} strokeWidth="0.4" opacity="0.18" />
                      <circle r={somaR * 0.13} fill={glow} opacity={0.5 + node.activation * 0.4} filter="url(#fnb)">
                        <animate attributeName="r"
                          values={`${somaR * 0.09};${somaR * 0.17};${somaR * 0.09}`}
                          dur={bDur} begin={bDel} repeatCount="indefinite" />
                      </circle>
                    </g>

                    {/* Labels stay outside float */}
                    {(() => {
                      const labelFs = isSel ? 9 : 7 + cs * 1.5;
                      const labelW  = Math.max(44, node.label.length * labelFs * 0.62 + 10);
                      const subText = `${meta.label.toUpperCase()} · ${Math.round(node.activation * 100)}%`;
                      const subW    = Math.max(40, subText.length * 6.5 * 0.6 + 8);
                      return (
                        <>
                          <rect x={-labelW / 2} y={somaR + 4} width={labelW} height={labelFs + 4} rx={2} fill="#0a0705" opacity={0.82} />
                          <text y={somaR + 13} textAnchor="middle"
                            fill={isSel ? '#fff' : isHov ? '#d4d4d8' : `${color}99`}
                            fontSize={labelFs} fontFamily="monospace"
                            fontWeight={isSel ? 'bold' : 'normal'}>
                            {node.label}
                          </text>
                          <rect x={-subW / 2} y={somaR + 15} width={subW} height={10} rx={2} fill="#0a0705" opacity={0.75} />
                          <text y={somaR + 23} textAnchor="middle" fill={`${color}50`} fontSize={6.5} fontFamily="monospace">
                            {subText}
                          </text>
                        </>
                      );
                    })()}
                  </g>
                );
              })}
            </g>
          </svg>

          <div className="absolute bottom-2 left-3 text-[8px] text-zinc-800 font-mono pointer-events-none">
            {Math.round(zoom * 100)}% · drag · scroll to zoom
          </div>
          <div className="absolute bottom-2 right-3 flex flex-col gap-0.5 pointer-events-none">
            {(Object.entries(TYPE_META) as [MemType, typeof TYPE_META[MemType]][]).map(([t, m]) => (
              <div key={t} className="flex items-center gap-1 text-[8px]" style={{ color: `${m.color}80` }}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: m.color }} />
                {m.label}
              </div>
            ))}
          </div>
        </div>

        {/* Sidebar */}
        {selNode && (
          <div className="w-52 shrink-0 border-l border-[#1c1508] bg-[#090602] flex flex-col overflow-y-auto text-[11px]">
            <div className="px-3 py-2 border-b border-[#1c1508] flex items-center gap-2" style={{ borderLeftColor: selColor, borderLeftWidth: 3 }}>
              <span className="font-bold text-white truncate flex-1">{selNode.label}</span>
              <button onClick={() => setSel(null)} className="text-zinc-700 hover:text-white shrink-0 text-base leading-none">×</button>
            </div>
            <div className="px-3 py-3 flex flex-col gap-3">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: selColor }} />
                <span style={{ color: selColor }} className="font-bold text-[10px]">{TYPE_META[selNode.type].label}</span>
              </div>
              <div>
                <div className="text-[9px] text-zinc-700 mb-1">ACTIVATION</div>
                <div className="h-1 bg-zinc-950 rounded overflow-hidden">
                  <div className="h-full rounded" style={{ width: `${selNode.activation * 100}%`, background: selColor }} />
                </div>
                <span className="text-[9px] mt-0.5 block" style={{ color: selColor }}>{Math.round(selNode.activation * 100)}%</span>
              </div>
              <div>
                <div className="text-[9px] text-zinc-700 mb-1">CONTENT SIZE</div>
                <div className="h-1 bg-zinc-950 rounded overflow-hidden">
                  <div className="h-full rounded" style={{ width: `${Math.min(selNode.content.length / 250, 1) * 100}%`, background: `${selColor}66` }} />
                </div>
                <span className="text-[9px] mt-0.5 block text-zinc-700">{selNode.content.length} chars</span>
              </div>
              <div>
                <div className="text-[9px] text-zinc-700 mb-1">CONTENT</div>
                <p className="text-zinc-500 text-[10px] leading-relaxed">{selNode.content}</p>
              </div>
              {selNode.tags.length > 0 && (
                <div>
                  <div className="text-[9px] text-zinc-700 mb-1 flex items-center gap-1"><Tag size={7} /> TAGS</div>
                  <div className="flex flex-wrap gap-1">
                    {selNode.tags.map(t => (
                      <span key={t} className="px-1.5 py-0.5 rounded text-[8px] border"
                        style={{ borderColor: `${selColor}35`, color: `${selColor}bb`, background: `${selColor}0d` }}>
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div className="text-[9px] text-zinc-700 mb-1">SYNAPTIC LINKS ({selNode.connections.length})</div>
                {selNode.connections.map(cid => {
                  const cn = nodes.find(n => n.id === cid); if (!cn) return null;
                  return (
                    <button key={cid} onClick={() => setSel(cid)}
                      className="flex items-center gap-1.5 text-zinc-600 hover:text-white text-[10px] py-0.5 w-full text-left transition-colors">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: TYPE_META[cn.type].color }} />
                      {cn.label}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => { setNodes(prev => prev.filter(n => n.id !== selNode.id).map(n => ({ ...n, connections: n.connections.filter(c => c !== selNode.id) }))); setSel(null); }}
                className="text-[10px] text-red-950 hover:text-red-500 transition-colors text-left mt-1">
                × remove neuron
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
