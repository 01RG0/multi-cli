import React, { useState } from 'react';
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
import { GripVertical, Eye, EyeOff, Plus, X, Zap, CheckCircle, XCircle, Loader } from 'lucide-react';

type TestState = 'idle' | 'testing' | 'ok' | 'fail';

interface SortableProviderItemProps {
  id: string;
}

function SortableProviderItem({ id }: SortableProviderItemProps) {
  const { providers, updateProvider } = useSwarmStore();
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

  const handleTest = async () => {
    if (testState === 'testing') return;
    setTestState('testing');
    setTestedLatency(null);
    const start = Date.now();
    try {
      const res = await fetch('http://localhost:8080/health', { signal: AbortSignal.timeout(5000) });
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
      // Backend unreachable — mark red but don't throw
      setTestState('fail');
      updateProvider(provider.id, { health: 'red' });
    }
    setTimeout(() => setTestState('idle'), 4000);
  };

  const healthColor =
    provider.health === 'green' ? 'bg-green-500' :
    provider.health === 'red'   ? 'bg-red-500' : 'bg-amber-500';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 p-3 mb-2 bg-zinc-950 border border-zinc-800 text-zinc-100 hover:border-zinc-600 rounded-lg"
    >
      <div
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        className="cursor-grab text-zinc-500 hover:text-white p-1 shrink-0"
      >
        <GripVertical size={16} />
      </div>

      <div className="flex-1 grid grid-cols-12 gap-3 items-center min-w-0">
        <div className="col-span-3 font-medium text-white text-sm truncate">
          {provider.name}
        </div>

        <div className="col-span-4 flex items-center gap-2 min-w-0">
          <div className="bg-black border border-zinc-800 text-zinc-300 font-mono text-xs px-2.5 py-1.5 rounded flex-1 min-w-0 flex items-center justify-between gap-1">
            <span className="truncate">{showKey ? (provider.apiKey || 'Stored in .env') : provider.apiKeyMasked}</span>
            <button onClick={() => setShowKey(!showKey)} className="text-zinc-500 hover:text-white shrink-0">
              {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
        </div>

        <div className="col-span-2 flex items-center gap-1.5 text-xs text-zinc-400">
          <div className={`w-2 h-2 rounded-full shrink-0 ${healthColor}`} />
          <span className="tabular-nums">{testedLatency ?? provider.latency}ms</span>
        </div>

        {/* TEST button */}
        <div className="col-span-1 flex justify-center">
          <button
            onClick={handleTest}
            disabled={testState === 'testing'}
            title="Ping provider"
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono border transition-all ${
              testState === 'testing' ? 'border-zinc-700 text-zinc-600 cursor-not-allowed' :
              testState === 'ok'      ? 'border-green-800 text-green-400 bg-green-950/30' :
              testState === 'fail'    ? 'border-red-800 text-red-400 bg-red-950/30' :
              'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white'
            }`}
          >
            {testState === 'testing' && <Loader size={10} className="animate-spin" />}
            {testState === 'ok'      && <CheckCircle size={10} />}
            {testState === 'fail'    && <XCircle size={10} />}
            {testState === 'idle'    && <Zap size={10} />}
            <span>
              {testState === 'testing' ? '…' :
               testState === 'ok'      ? 'OK' :
               testState === 'fail'    ? 'FAIL' : 'TEST'}
            </span>
          </button>
        </div>

        <div className="col-span-2 flex justify-end">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={provider.enabled}
              onChange={(e) => updateProvider(provider.id, { enabled: e.target.checked })}
            />
            <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-white peer-checked:after:bg-black"></div>
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

  React.useEffect(() => {
    fetch('http://localhost:8080/health')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data || !Array.isArray(data.chain)) return;
        const chain: string[] = data.chain;
        setProviders(providers.map(p => ({
          ...p,
          health: chain.some(name => name.toLowerCase() === p.name.toLowerCase()) ? 'green' : p.health,
        })));
      })
      .catch(() => {});
  }, []);

  const handleAddProvider = () => {
    if (!newName.trim()) return;
    const key = newKey.trim();
    const masked = key.length > 8
      ? `${key.slice(0, 4)}••••••${key.slice(-3)}`
      : key ? '••••••••' : '(not configured)';
    const newProvider = {
      id: `p-${Date.now()}`,
      name: newName.trim(),
      apiKeyMasked: masked,
      apiKey: key,
      latencyMs: 200,
      latency: 200,
      health: (key ? 'green' : 'amber') as 'green' | 'amber' | 'red',
      enabled: !!key,
      cooldownUntil: null,
    };
    setProviders([...providers, newProvider]);
    setNewName(''); setNewKey(''); setNewUrl(''); setShowAddForm(false);
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
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
      <div className="mb-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-xl font-bold text-white">PROVIDER CHAIN</h2>
          <button
            onClick={() => setShowAddForm(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white text-xs font-mono rounded transition"
          >
            {showAddForm ? <X size={13} /> : <Plus size={13} />}
            {showAddForm ? 'Cancel' : 'Add Provider'}
          </button>
        </div>
        <p className="text-sm text-zinc-400 mb-4">Fallback Hierarchy · {providers.length} configured</p>

        {showAddForm && (
          <div className="mb-4 p-4 bg-zinc-950 border border-zinc-700 rounded-lg flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1 flex-1 min-w-32">
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Name *</label>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Together AI"
                className="bg-black border border-zinc-800 text-white text-xs rounded px-2.5 py-1.5 focus:outline-none focus:border-zinc-500"
              />
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-40">
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider">API Key</label>
              <input
                value={newKey}
                onChange={e => setNewKey(e.target.value)}
                placeholder="sk-..."
                type="password"
                className="bg-black border border-zinc-800 text-white text-xs rounded px-2.5 py-1.5 focus:outline-none focus:border-zinc-500"
              />
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-40">
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Base URL (optional)</label>
              <input
                value={newUrl}
                onChange={e => setNewUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
                className="bg-black border border-zinc-800 text-white text-xs rounded px-2.5 py-1.5 focus:outline-none focus:border-zinc-500"
              />
            </div>
            <button
              onClick={handleAddProvider}
              disabled={!newName.trim()}
              className="px-4 py-1.5 bg-white hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-600 text-black text-xs font-bold rounded transition"
            >
              Add
            </button>
          </div>
        )}

        <div className="grid grid-cols-12 gap-3 px-10 pb-2 text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
          <div className="col-span-3">Provider</div>
          <div className="col-span-4">API Key</div>
          <div className="col-span-2">Latency</div>
          <div className="col-span-1 text-center">Test</div>
          <div className="col-span-2 text-right">Enabled</div>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={providers.map(p => p.id)}
            strategy={verticalListSortingStrategy}
          >
            {providers.map((provider) => (
              <SortableProviderItem key={provider.id} id={provider.id} />
            ))}
          </SortableContext>
        </DndContext>
      </div>

      <div className="bg-[#121215] border border-[#27272a] rounded-lg p-5 text-white mt-8">
        <h3 className="text-lg font-semibold mb-4">Agent Config</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium w-1/3">Name</label>
            <input
              type="text"
              value={agentConfig.name}
              onChange={(e) => setAgentConfig({ name: e.target.value })}
              className="w-2/3 bg-black border border-zinc-800 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:border-white focus:ring-1 focus:ring-white"
            />
          </div>

          <div className="flex items-center justify-between">
            <label className="text-sm font-medium w-1/3">Max Concurrent Tasks</label>
            <input
              type="number"
              value={agentConfig.maxConcurrentTasks}
              onChange={(e) => setAgentConfig({ maxConcurrentTasks: parseInt(e.target.value) })}
              className="w-2/3 bg-black border border-zinc-800 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:border-white focus:ring-1 focus:ring-white"
            />
          </div>

          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Enabled</label>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={agentConfig.enabled}
                onChange={(e) => setAgentConfig({ enabled: e.target.checked })}
              />
              <div className="w-11 h-6 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-white peer-checked:after:bg-black"></div>
            </label>
          </div>

          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Preferred Provider Override</label>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={agentConfig.preferredProviderOverride}
                onChange={(e) => setAgentConfig({ preferredProviderOverride: e.target.checked })}
              />
              <div className="w-11 h-6 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-white peer-checked:after:bg-black"></div>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
