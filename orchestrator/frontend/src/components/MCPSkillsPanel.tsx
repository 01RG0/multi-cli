import React, { useState, useEffect, useCallback } from 'react';
import { Puzzle, Server, Zap, Plus, Trash2, Play, ChevronDown, ChevronRight, X } from 'lucide-react';

const BASE = 'http://localhost:8080';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MCPTool {
  name: string;
  description: string;
  input_schema?: Record<string, unknown>;
}

interface MCPServer {
  name: string;
  status: string;
  tool_count: number;
  tools?: MCPTool[];
}

interface Skill {
  id: string;
  name: string;
  description: string;
  prompt_template: string;
  tools: string[];
  agent_id: string;
  created_at: number;
  updated_at: number;
}

// ─── Run Skill Modal ──────────────────────────────────────────────────────────

function RunSkillModal({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setResult(null);
    try {
      const r = await fetch(`${BASE}/api/skills/${skill.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      });
      const data = await r.json();
      setResult(JSON.stringify(data, null, 2));
    } catch (e) {
      setResult(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-lg p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-mono font-bold text-sm">RUN SKILL — {skill.name}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-zinc-400 text-xs mb-3">{skill.description}</p>
        <label className="block text-zinc-500 text-xs font-mono mb-1">INPUT (replaces {'{{input}}'})</label>
        <textarea
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg text-white text-xs font-mono p-2.5 resize-none focus:outline-none focus:border-zinc-500 mb-3"
          rows={4}
          placeholder="Enter input text…"
          value={input}
          onChange={e => setInput(e.target.value)}
        />
        {result && (
          <pre className="bg-zinc-800 border border-zinc-700 rounded-lg text-xs font-mono text-zinc-300 p-2.5 mb-3 overflow-auto max-h-40">
            {result}
          </pre>
        )}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 rounded text-xs font-mono text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 transition-colors">
            CANCEL
          </button>
          <button
            onClick={run}
            disabled={loading}
            className="px-3 py-1.5 rounded text-xs font-mono bg-white text-black hover:bg-zinc-200 transition-colors disabled:opacity-50"
          >
            {loading ? 'RUNNING…' : 'RUN'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── New Skill Form ───────────────────────────────────────────────────────────

const KNOWN_AGENTS = ['opencode', 'codex', 'vibe', 'agy', 'grok', 'cline', 'kilo', 'cursor', 'researcher', 'debugger', 'jules', 'hermes', 'deepseek', 'harness', 'kimocode', 'pi'];

function NewSkillForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [template, setTemplate] = useState('');
  const [agentId, setAgentId] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!name.trim() || !template.trim()) { setErr('Name and prompt template are required.'); return; }
    setSaving(true);
    setErr('');
    try {
      const r = await fetch(`${BASE}/api/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: desc.trim(), prompt_template: template.trim(), agent_id: agentId, tools: [] }),
      });
      if (!r.ok) throw new Error(await r.text());
      setName(''); setDesc(''); setTemplate(''); setAgentId('');
      setOpen(false);
      onCreated();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 text-xs font-mono transition-colors"
      >
        <Plus className="w-3.5 h-3.5" /> NEW SKILL
      </button>
    );
  }

  return (
    <div className="border border-zinc-700 rounded-xl p-4 bg-zinc-900/60 space-y-3">
      <p className="text-white text-xs font-mono font-bold">NEW SKILL</p>
      {err && <p className="text-red-400 text-xs">{err}</p>}
      <input
        className="w-full bg-zinc-800 border border-zinc-700 rounded text-white text-xs font-mono px-2.5 py-1.5 focus:outline-none focus:border-zinc-500"
        placeholder="Skill name"
        value={name}
        onChange={e => setName(e.target.value)}
      />
      <input
        className="w-full bg-zinc-800 border border-zinc-700 rounded text-white text-xs font-mono px-2.5 py-1.5 focus:outline-none focus:border-zinc-500"
        placeholder="Description (optional)"
        value={desc}
        onChange={e => setDesc(e.target.value)}
      />
      <textarea
        className="w-full bg-zinc-800 border border-zinc-700 rounded text-white text-xs font-mono px-2.5 py-1.5 resize-none focus:outline-none focus:border-zinc-500"
        placeholder={"Prompt template. Use {{input}} and {{context}} as placeholders."}
        rows={5}
        value={template}
        onChange={e => setTemplate(e.target.value)}
      />
      <select
        className="w-full bg-zinc-800 border border-zinc-700 rounded text-white text-xs font-mono px-2.5 py-1.5 focus:outline-none focus:border-zinc-500"
        value={agentId}
        onChange={e => setAgentId(e.target.value)}
      >
        <option value="">Preferred agent (optional)</option>
        {KNOWN_AGENTS.map(a => <option key={a} value={a}>{a}</option>)}
      </select>
      <div className="flex gap-2 justify-end">
        <button onClick={() => setOpen(false)} className="px-3 py-1.5 rounded text-xs font-mono text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 transition-colors">
          CANCEL
        </button>
        <button onClick={save} disabled={saving} className="px-3 py-1.5 rounded text-xs font-mono bg-white text-black hover:bg-zinc-200 transition-colors disabled:opacity-50">
          {saving ? 'SAVING…' : 'SAVE'}
        </button>
      </div>
    </div>
  );
}

// ─── MCP Servers Tab ─────────────────────────────────────────────────────────

function MCPServersTab() {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BASE}/api/mcp/servers`);
      const data: MCPServer[] = await r.json();
      setServers(data);
    } catch {
      setServers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTools = async (name: string) => {
    try {
      const r = await fetch(`${BASE}/api/mcp/servers/${encodeURIComponent(name)}/tools`);
      const tools: MCPTool[] = await r.json();
      setServers(prev => prev.map(s => s.name === name ? { ...s, tools } : s));
    } catch { /* ignore */ }
  };

  const toggle = (name: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
        loadTools(name);
      }
      return next;
    });
  };

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="text-zinc-500 text-xs font-mono p-4">Loading MCP servers…</p>;

  if (servers.length === 0) {
    return (
      <div className="p-4 text-center">
        <Server className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
        <p className="text-zinc-500 text-xs font-mono">No MCP servers running.</p>
        <p className="text-zinc-600 text-xs font-mono mt-1">Add mcp_servers entries to config.yaml to connect servers.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {servers.map(srv => {
        const isOpen = expanded.has(srv.name);
        return (
          <div key={srv.name} className="border border-zinc-800 rounded-xl overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-900/50 transition-colors"
              onClick={() => toggle(srv.name)}
            >
              <div className="flex items-center gap-3">
                <span className="w-2 h-2 rounded-full bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]" />
                <span className="text-white text-xs font-mono font-bold">{srv.name}</span>
                <span className="text-zinc-500 text-xs font-mono">{srv.tool_count} tools</span>
              </div>
              {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />}
            </button>
            {isOpen && (
              <div className="border-t border-zinc-800 px-4 py-3 bg-zinc-950/50">
                {!srv.tools ? (
                  <p className="text-zinc-500 text-xs font-mono">Loading tools…</p>
                ) : srv.tools.length === 0 ? (
                  <p className="text-zinc-500 text-xs font-mono">No tools</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {srv.tools.map(tool => (
                      <span
                        key={tool.name}
                        title={tool.description}
                        className="px-2 py-0.5 rounded-full border border-zinc-700 text-zinc-300 text-[10px] font-mono cursor-default hover:border-zinc-500 hover:text-white transition-colors"
                      >
                        {tool.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Skills Tab ───────────────────────────────────────────────────────────────

function SkillsTab() {
  const [skillList, setSkillList] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [runTarget, setRunTarget] = useState<Skill | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BASE}/api/skills`);
      const data: Skill[] = await r.json();
      setSkillList(data);
    } catch {
      setSkillList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteSkill = async (id: string) => {
    if (!confirm('Delete this skill?')) return;
    await fetch(`${BASE}/api/skills/${id}`, { method: 'DELETE' });
    load();
  };

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      <NewSkillForm onCreated={load} />

      {loading ? (
        <p className="text-zinc-500 text-xs font-mono">Loading skills…</p>
      ) : skillList.length === 0 ? (
        <div className="p-4 text-center">
          <Zap className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
          <p className="text-zinc-500 text-xs font-mono">No skills yet.</p>
          <p className="text-zinc-600 text-xs font-mono mt-1">Create reusable prompt templates to speed up common tasks.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {skillList.map(sk => (
            <div key={sk.id} className="border border-zinc-800 rounded-xl px-4 py-3 flex items-start justify-between gap-3 hover:border-zinc-700 transition-colors">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-white text-xs font-mono font-bold truncate">{sk.name}</span>
                  {sk.agent_id && (
                    <span className="shrink-0 px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-400 text-[10px] font-mono">
                      {sk.agent_id}
                    </span>
                  )}
                </div>
                {sk.description && <p className="text-zinc-500 text-xs truncate">{sk.description}</p>}
                <p className="text-zinc-600 text-[10px] font-mono mt-1 truncate">{sk.prompt_template.slice(0, 80)}{sk.prompt_template.length > 80 ? '…' : ''}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setRunTarget(sk)}
                  title="Run skill"
                  className="p-1.5 rounded border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors"
                >
                  <Play className="w-3 h-3" />
                </button>
                <button
                  onClick={() => deleteSkill(sk.id)}
                  title="Delete skill"
                  className="p-1.5 rounded border border-zinc-700 text-zinc-400 hover:text-red-400 hover:border-red-800 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {runTarget && <RunSkillModal skill={runTarget} onClose={() => { setRunTarget(null); load(); }} />}
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

type PanelTab = 'servers' | 'skills';

export default function MCPSkillsPanel() {
  const [activeTab, setActiveTab] = useState<PanelTab>('servers');

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 shrink-0">
        <Puzzle className="w-4 h-4 text-zinc-400" />
        <span className="text-white text-xs font-mono font-bold tracking-wide">MCP &amp; SKILLS</span>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 px-4 pt-3 pb-2 border-b border-zinc-800 shrink-0">
        {(['servers', 'skills'] as PanelTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`relative px-3 py-1.5 rounded text-xs font-mono transition-all duration-200 ${
              activeTab === tab
                ? 'text-black font-bold'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-900/50'
            }`}
          >
            {activeTab === tab && (
              <div className="absolute inset-0 bg-white rounded z-[-1]" />
            )}
            {tab === 'servers' ? 'MCP SERVERS' : 'SKILLS'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {activeTab === 'servers' ? <MCPServersTab /> : <SkillsTab />}
      </div>
    </div>
  );
}
