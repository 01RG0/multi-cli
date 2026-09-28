import React, { useState, useEffect } from 'react';
import { useSwarmStore } from '../store/useSwarmStore';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Eye, EyeOff, Plus, X, Zap, CheckCircle, XCircle, Loader, Copy, Trash2, BarChart2 } from 'lucide-react';

type TestState = 'idle' | 'testing' | 'ok' | 'fail';

interface ProviderStat {
  requests: number;
  input_tokens: number;
  output_tokens: number;
  errors: number;
  last_used_ms: number;
}

interface SortableProviderItemProps {
  id: string;
  onClone: (id: string) => void;
  stats: Record<string, ProviderStat>;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// Normalize a provider name for fuzzy matching: lowercase, strip spaces/dashes/underscores
function normName(s: string): string {
  return s.toLowerCase().replace(/[\s\-_]/g, '');
}

function findStat(
  stats: Record<string, ProviderStat>,
  providerName: string,
): ProviderStat | undefined {
  const needle = normName(providerName);
  // Exact normalized match first
  const exact = Object.entries(stats).find(([k]) => normName(k) === needle);
  if (exact) return exact[1];
  // Substring match (e.g. "AWS Bedrock" ↔ "bedrock", "Alibaba DashScope" ↔ "dashscope")
  const sub = Object.entries(stats).find(
    ([k]) => needle.includes(normName(k)) || normName(k).includes(needle),
  );
  return sub?.[1];
}

function SortableProviderItem({ id, onClone, stats }: SortableProviderItemProps) {
  const { providers, updateProvider, setProviders } = useSwarmStore();
  const provider = providers.find(p => p.id === id);
  const [showKey, setShowKey] = useState(false);
  const [testState, setTestState] = useState<TestState>('idle');
  const [testedLatency, setTestedLatency] = useState<number | null>(null);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    setActivatorNodeRef
  } = useSortable({ id });

  const style = { transform: CSS.Transform.toString(transform), transition };

  if (!provider) return null;

  const stat = findStat(stats, provider.name);

  const totalTokens = stat ? stat.input_tokens + stat.output_tokens : 0;

  const handleTest = async () => {
    if (testState === 'testing') return;
    setTestState('testing');
    setTestedLatency(null);
    const start = Date.now();
    try {
      const res = await fetch('/health', { signal: AbortSignal.timeout(5000) });
      const elapsed = Date.now() - start;
      if (res.ok) {
        setTestedLatency(elapsed);
        setTestState('ok');
        updateProvider(provider.id, { latencyMs: elapsed, latency: elapsed, health: 'green' });
      } else {
        setTestState('fail');
        updateProvider(provider.id, { health: 'red' });
      }
    } catch {
      setTestState('fail');
      updateProvider(provider.id, { health: 'red' });
    }
    setTimeout(() => setTestState('idle'), 4000);
  };

  const handleDelete = () => {
    setProviders(providers.filter(p => p.id !== provider.id));
  };

  const healthColor =
    provider.health === 'green' ? 'bg-green-500' :
    provider.health === 'red'   ? 'bg-red-500' : 'bg-amber-500';

  const hasErrors = stat && stat.errors > 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 p-3 mb-2 bg-zinc-950 border border-zinc-800 text-zinc-100 hover:border-zinc-600 rounded-lg group"
    >
      <div
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        className="cursor-grab text-zinc-500 hover:text-white p-1 shrink-0"
      >
        <GripVertical size={16} />
      </div>

      <div className="flex-1 grid grid-cols-12 gap-2 items-center min-w-0">
        {/* Name + model tag */}
        <div className="col-span-2 min-w-0">
          <div className="font-medium text-white text-sm truncate">{provider.name}</div>
          {provider.model && (
            <div className="text-[10px] text-zinc-500 font-mono truncate mt-0.5">{provider.model}</div>
          )}
        </div>

        {/* API key */}
        <div className="col-span-3 flex items-center gap-1 min-w-0">
          <div className="bg-black border border-zinc-800 text-zinc-300 font-mono text-xs px-2 py-1 rounded flex-1 min-w-0 flex items-center justify-between gap-1">
            <span className="truncate text-[10px]">{showKey ? (provider.apiKey || 'Stored in .env') : provider.apiKeyMasked}</span>
            <button onClick={() => setShowKey(!showKey)} className="text-zinc-500 hover:text-white shrink-0">
              {showKey ? <EyeOff size={11} /> : <Eye size={11} />}
            </button>
          </div>
        </div>

        {/* Requests */}
        <div className="col-span-2 text-center">
          {stat ? (
            <div className="flex flex-col items-center">
              <span className="text-white text-xs font-mono tabular-nums">{fmt(stat.requests)}</span>
              {hasErrors && (
                <span className="text-red-500 text-[9px]">{stat.errors} err</span>
              )}
            </div>
          ) : (
            <span className="text-zinc-700 text-xs">—</span>
          )}
        </div>

        {/* Tokens */}
        <div className="col-span-2 text-center">
          {totalTokens > 0 ? (
            <div className="flex flex-col items-center">
              <span className="text-amber-400 text-xs font-mono tabular-nums">{fmt(totalTokens)}</span>
              <span className="text-zinc-600 text-[9px]">{fmt(stat!.input_tokens)}in · {fmt(stat!.output_tokens)}out</span>
            </div>
          ) : (
            <span className="text-zinc-700 text-xs">—</span>
          )}
        </div>

        {/* Latency */}
        <div className="col-span-1 flex items-center gap-1 text-xs text-zinc-400 justify-center">
          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${healthColor}`} />
          <span className="tabular-nums text-[10px]">{testedLatency ?? provider.latency}ms</span>
        </div>

        {/* TEST + actions */}
        <div className="col-span-2 flex justify-end items-center gap-1.5">
          <button
            onClick={handleTest}
            disabled={testState === 'testing'}
            title="Ping provider"
            className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono border transition-all ${
              testState === 'testing' ? 'border-zinc-700 text-zinc-600 cursor-not-allowed' :
              testState === 'ok'      ? 'border-green-800 text-green-400 bg-green-950/30' :
              testState === 'fail'    ? 'border-red-800 text-red-400 bg-red-950/30' :
              'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white'
            }`}
          >
            {testState === 'testing' && <Loader size={9} className="animate-spin" />}
            {testState === 'ok'      && <CheckCircle size={9} />}
            {testState === 'fail'    && <XCircle size={9} />}
            {testState === 'idle'    && <Zap size={9} />}
            <span>{testState === 'testing' ? '…' : testState === 'ok' ? 'OK' : testState === 'fail' ? 'FAIL' : 'TEST'}</span>
          </button>

          <button onClick={() => onClone(provider.id)} title="Clone (same key, new model)"
            className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-blue-400 transition-all p-0.5 rounded">
            <Copy size={12} />
          </button>

          <button onClick={handleDelete} title="Remove"
            className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 transition-all p-0.5 rounded">
            <Trash2 size={12} />
          </button>

          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" className="sr-only peer" checked={provider.enabled}
              onChange={(e) => updateProvider(provider.id, { enabled: e.target.checked })} />
            <div className="w-8 h-4 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-white after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-white peer-checked:after:bg-black"></div>
          </label>
        </div>
      </div>
    </div>
  );
}

export default function ProviderChain() {
  const { providers, setProviders, updateProvider, agentConfig, setAgentConfig } = useSwarmStore();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newModel, setNewModel] = useState('');
  const [providerStats, setProviderStats] = useState<Record<string, ProviderStat>>({});

  // Load real provider health + stats from backend
  useEffect(() => {
    const load = () => {
      fetch('/health')
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data || !Array.isArray(data.chain)) return;
          const chain: string[] = data.chain;
          setProviders(providers.map(p => ({
            ...p,
            health: chain.some(name => name.toLowerCase() === p.name.toLowerCase()) ? 'green' : p.health,
          })));
        })
        .catch(() => {});

      fetch('/api/providers/stats')
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) setProviderStats(data); })
        .catch(() => {});
    };

    load();
    const interval = setInterval(load, 10000); // refresh every 10s
    return () => clearInterval(interval);
  }, []);

  const openAddForm = (prefill?: { name: string; key: string; url: string; model: string }) => {
    if (prefill) {
      setNewName(prefill.name); setNewKey(prefill.key);
      setNewUrl(prefill.url); setNewModel(prefill.model);
    } else {
      setNewName(''); setNewKey(''); setNewUrl(''); setNewModel('');
    }
    setShowAddForm(true);
  };

  const handleClone = (id: string) => {
    const src = providers.find(p => p.id === id);
    if (!src) return;
    const base = src.name.replace(/-\d+$/, '');
    const idx = providers.filter(p => p.name.startsWith(base)).length + 1;
    openAddForm({ name: `${base}-${idx}`, key: src.apiKey || '', url: src.baseUrl || '', model: src.model || '' });
  };

  const handleAddProvider = () => {
    if (!newName.trim()) return;
    const key = newKey.trim();
    const masked = key.length > 8 ? `${key.slice(0, 4)}••••••${key.slice(-3)}` : key ? '••••••••' : '(not configured)';
    setProviders([...providers, {
      id: `p-${Date.now()}`,
      name: newName.trim(),
      apiKeyMasked: masked,
      apiKey: key,
      baseUrl: newUrl.trim() || undefined,
      model: newModel.trim() || undefined,
      latencyMs: 200,
      latency: 200,
      health: (key ? 'green' : 'amber') as 'green' | 'amber' | 'red',
      enabled: !!key,
      cooldownUntil: null,
    }]);
    setNewName(''); setNewKey(''); setNewUrl(''); setNewModel(''); setShowAddForm(false);
  };

  const totalRequests = Object.values(providerStats).reduce((s, p) => s + p.requests, 0);
  const totalTokens   = Object.values(providerStats).reduce((s, p) => s + p.input_tokens + p.output_tokens, 0);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (active.id !== over?.id) {
      const oldIndex = providers.findIndex(p => p.id === active.id);
      const newIndex = providers.findIndex(p => p.id === over?.id);
      setProviders(arrayMove(providers, oldIndex, newIndex));
    }
  };

  return (
    <div className="w-full p-5 bg-[#121215] border border-[#27272a] rounded-lg text-white">

      {/* Header with stats summary + Add button */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-xl font-bold text-white">PROVIDER CHAIN</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              {providers.length} providers · drag to reorder · hover to clone or remove
            </p>
          </div>

          {/* Add Provider — always-visible prominent button */}
          <button
            onClick={() => showAddForm ? setShowAddForm(false) : openAddForm()}
            className={`flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-mono font-bold transition-all ${
              showAddForm
                ? 'bg-zinc-900 border-zinc-600 text-zinc-400'
                : 'bg-white hover:bg-zinc-100 border-white text-black'
            }`}
          >
            {showAddForm ? <X size={14} /> : <Plus size={14} />}
            {showAddForm ? 'Cancel' : '+ Add Provider'}
          </button>
        </div>

        {/* Stats summary bar */}
        {(totalRequests > 0 || totalTokens > 0) && (
          <div className="flex items-center gap-4 px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg mb-4 text-xs">
            <BarChart2 size={12} className="text-zinc-500 shrink-0" />
            <div className="flex items-center gap-1">
              <span className="text-zinc-500">Requests</span>
              <span className="text-white font-mono font-bold">{fmt(totalRequests)}</span>
            </div>
            <div className="w-px h-3 bg-zinc-800" />
            <div className="flex items-center gap-1">
              <span className="text-zinc-500">Tokens</span>
              <span className="text-amber-400 font-mono font-bold">{fmt(totalTokens)}</span>
            </div>
            <div className="w-px h-3 bg-zinc-800" />
            <span className="text-zinc-600">live · resets on restart</span>
          </div>
        )}

        {/* Add form */}
        {showAddForm && (
          <div className="mb-4 p-4 bg-zinc-950 border border-zinc-700 rounded-lg space-y-3">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex flex-col gap-1 flex-1 min-w-32">
                <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Name *</label>
                <input value={newName} onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. openrouter-strong"
                  className="bg-black border border-zinc-800 text-white text-xs rounded px-2.5 py-1.5 focus:outline-none focus:border-zinc-500" />
              </div>
              <div className="flex flex-col gap-1 flex-1 min-w-40">
                <label className="text-[10px] text-zinc-500 uppercase tracking-wider">API Key</label>
                <input value={newKey} onChange={e => setNewKey(e.target.value)}
                  placeholder="sk-..." type="password"
                  className="bg-black border border-zinc-800 text-white text-xs rounded px-2.5 py-1.5 focus:outline-none focus:border-zinc-500" />
              </div>
            </div>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex flex-col gap-1 flex-1 min-w-40">
                <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Base URL (optional)</label>
                <input value={newUrl} onChange={e => setNewUrl(e.target.value)}
                  placeholder="https://openrouter.ai/api/v1"
                  className="bg-black border border-zinc-800 text-white text-xs rounded px-2.5 py-1.5 focus:outline-none focus:border-zinc-500" />
              </div>
              <div className="flex flex-col gap-1 flex-1 min-w-40">
                <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Model (optional)</label>
                <input value={newModel} onChange={e => setNewModel(e.target.value)}
                  placeholder="e.g. anthropic/claude-opus-4"
                  className="bg-black border border-zinc-800 text-white text-xs rounded px-2.5 py-1.5 focus:outline-none focus:border-zinc-500" />
              </div>
              <button onClick={handleAddProvider} disabled={!newName.trim()}
                className="px-4 py-1.5 bg-white hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-600 text-black text-xs font-bold rounded transition">
                Add
              </button>
            </div>
          </div>
        )}

        {/* Column headers */}
        <div className="grid grid-cols-12 gap-2 px-10 pb-2 text-[9px] font-medium text-zinc-600 uppercase tracking-wider">
          <div className="col-span-2">Provider</div>
          <div className="col-span-3">API Key</div>
          <div className="col-span-2 text-center">Requests</div>
          <div className="col-span-2 text-center">Tokens</div>
          <div className="col-span-1 text-center">Latency</div>
          <div className="col-span-2 text-right">Test · Clone · Del · On</div>
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={providers.map(p => p.id)} strategy={verticalListSortingStrategy}>
            {providers.map(provider => (
              <SortableProviderItem key={provider.id} id={provider.id} onClone={handleClone} stats={providerStats} />
            ))}
          </SortableContext>
        </DndContext>
      </div>

      {/* Agent Config */}
      <div className="bg-[#121215] border border-[#27272a] rounded-lg p-5 text-white mt-4">
        <h3 className="text-lg font-semibold mb-4">Agent Config</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium w-1/3">Name</label>
            <input type="text" value={agentConfig.name}
              onChange={e => setAgentConfig({ name: e.target.value })}
              className="w-2/3 bg-black border border-zinc-800 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:border-white focus:ring-1 focus:ring-white" />
          </div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium w-1/3">Max Concurrent Tasks</label>
            <input type="number" value={agentConfig.maxConcurrentTasks}
              onChange={e => setAgentConfig({ maxConcurrentTasks: parseInt(e.target.value) })}
              className="w-2/3 bg-black border border-zinc-800 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:border-white focus:ring-1 focus:ring-white" />
          </div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Enabled</label>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked={agentConfig.enabled}
                onChange={e => setAgentConfig({ enabled: e.target.checked })} />
              <div className="w-11 h-6 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-white peer-checked:after:bg-black"></div>
            </label>
          </div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Preferred Provider Override</label>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked={agentConfig.preferredProviderOverride}
                onChange={e => setAgentConfig({ preferredProviderOverride: e.target.checked })} />
              <div className="w-11 h-6 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-white peer-checked:after:bg-black"></div>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
