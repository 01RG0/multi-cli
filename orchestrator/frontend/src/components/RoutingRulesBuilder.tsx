import React, { useState, useMemo } from 'react';
import { useSwarmStore, RoutingRule } from '../store/useSwarmStore';
import { Plus, Trash2, ArrowRight, Zap, Sparkles, ToggleLeft, ToggleRight } from 'lucide-react';

const MODEL_COLORS: Record<string, string> = {
  'gpt-4o':            '#10A37F',
  'gpt-4o-mini':       '#10A37F',
  'o3-mini':           '#10A37F',
  'claude-3-5-sonnet': '#D97706',
  'claude-3-haiku':    '#D97706',
  'gemini-2.0-flash':  '#4285F4',
  'gemini-2.5-pro':    '#4285F4',
  'grok-2':            '#FFFFFF',
  'mistral-large':     '#FF8205',
  'deepseek-v3':       '#38BDF8',
};
const MODELS = Object.keys(MODEL_COLORS);

// Agent → default model
const AGENT_DEFAULTS: Record<string, string> = {
  opencode:   'claude-3-5-sonnet',
  codex:      'gpt-4o',
  cursor:     'claude-3-5-sonnet',
  cline:      'claude-3-5-sonnet',
  jules:      'gemini-2.0-flash',
  grok:       'grok-2',
  kilo:       'claude-3-5-sonnet',
  researcher: 'deepseek-v3',
  vibe:       'mistral-large',
  agy:        'gemini-2.5-pro',
  debugger:   'o3-mini',
};

const FALLBACK_AGENTS = Object.keys(AGENT_DEFAULTS);

const FIELDS = [
  { value: 'task_type', label: 'task_type'  },
  { value: 'intent',    label: 'intent'     },
  { value: 'content',   label: 'content'    },
  { value: 'language',  label: 'language'   },
  { value: 'priority',  label: 'priority'   },
  { value: 'model_pref',label: 'model_pref' },
];

const OPERATORS = [
  { value: 'equals',      label: '= equals'      },
  { value: 'contains',    label: '⊆ contains'    },
  { value: 'starts_with', label: '^ starts with' },
  { value: 'matches',     label: '~ regex'       },
];

// Derive a suggested rule from a task prompt string
function deriveRuleFromPrompt(prompt: string, agentId: string): Partial<RoutingRule> | null {
  const p = prompt.toLowerCase();
  const keywords: [string, string, string][] = [
    ['debug', 'task_type', 'debug'],
    ['fix bug', 'content', 'fix'],
    ['stack trace', 'content', 'stack trace'],
    ['refactor', 'task_type', 'refactor'],
    ['lint', 'task_type', 'lint'],
    ['typecheck', 'content', 'typecheck'],
    ['research', 'task_type', 'research'],
    ['search', 'content', 'search'],
    ['pull request', 'task_type', 'pull_request'],
    ['open pr', 'content', 'open pr'],
    ['scaffold', 'task_type', 'scaffold'],
    ['create project', 'content', 'create project'],
    ['implement', 'content', 'implement'],
    ['write function', 'content', 'write function'],
    ['analyse', 'intent', 'reasoning'],
    ['analyze', 'intent', 'reasoning'],
    ['generate', 'intent', 'generate'],
    ['multimodal', 'task_type', 'multimodal'],
    ['edit file', 'content', 'edit file'],
    ['autonomous', 'intent', 'autonomous'],
  ];
  for (const [keyword, field, value] of keywords) {
    if (p.includes(keyword)) {
      return { field, operator: 'contains', value, targetAgent: agentId, model: AGENT_DEFAULTS[agentId] ?? 'claude-3-5-sonnet' };
    }
  }
  return null;
}

export default function RoutingRulesBuilder() {
  const routingRules    = (useSwarmStore as any)((s: any) => s.routingRules) as RoutingRule[];
  const addRoutingRule  = (useSwarmStore as any)((s: any) => s.addRoutingRule);
  const updateRoutingRule = (useSwarmStore as any)((s: any) => s.updateRoutingRule);
  const deleteRoutingRule = (useSwarmStore as any)((s: any) => s.deleteRoutingRule);
  const agents          = (useSwarmStore as any)((s: any) => s.agents);
  const tasks           = (useSwarmStore as any)((s: any) => s.tasks) ?? [];
  const logs            = (useSwarmStore as any)((s: any) => s.logs)  ?? [];

  const agentIds: string[] = useMemo(
    () => (agents?.map((a: any) => a.id) ?? FALLBACK_AGENTS),
    [agents]
  );

  const [testPrompt, setTestPrompt] = useState('');

  // ── Derive suggestions from live task/log activity ──────────────────────────
  const suggestions = useMemo(() => {
    const seen = new Set<string>();
    const results: Array<Partial<RoutingRule> & { _label: string }> = [];

    // From tasks
    for (const t of tasks.slice(-40)) {
      const derived = deriveRuleFromPrompt(t.prompt ?? '', t.agentId ?? '');
      if (!derived) continue;
      const key = `${derived.field}:${derived.value}:${derived.targetAgent}`;
      if (seen.has(key)) continue;
      // Skip if already in rules
      if (routingRules.some(r => r.field === derived.field && r.value === derived.value && r.targetAgent === derived.targetAgent)) continue;
      seen.add(key);
      results.push({ ...derived, _label: `"${t.prompt?.slice(0, 40)}" → ${derived.targetAgent}` });
    }

    // From logs (agent activity)
    const agentCounts: Record<string, number> = {};
    for (const l of logs.slice(-60)) {
      if (l.agent) agentCounts[l.agent] = (agentCounts[l.agent] ?? 0) + 1;
    }
    const topAgents = Object.entries(agentCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => id);

    for (const agentId of topAgents) {
      const key = `task_type:*:${agentId}`;
      if (seen.has(key)) continue;
      if (routingRules.some(r => r.targetAgent === agentId && r.field === 'task_type')) continue;
      seen.add(key);
      results.push({
        field: 'task_type', operator: 'contains', value: agentId,
        targetAgent: agentId, model: AGENT_DEFAULTS[agentId] ?? 'claude-3-5-sonnet',
        _label: `High activity on ${agentId} → auto-route`,
      });
    }

    return results.slice(0, 6);
  }, [tasks, logs, routingRules]);

  const handleAddBlank = () => {
    addRoutingRule({
      field: 'task_type', operator: 'equals', value: '',
      targetAgent: agentIds[0] ?? 'opencode',
      model: 'claude-3-5-sonnet', priority: 5, enabled: true,
    });
  };

  const handleAcceptSuggestion = (s: Partial<RoutingRule>) => {
    addRoutingRule({
      field: s.field ?? 'task_type', operator: s.operator ?? 'contains', value: s.value ?? '',
      targetAgent: s.targetAgent ?? 'opencode', model: s.model ?? 'claude-3-5-sonnet',
      priority: 5, enabled: true,
    });
  };

  const matchedRule = useMemo(() => {
    if (!testPrompt) return null;
    return [...routingRules]
      .filter(r => r.enabled !== false)
      .sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5))
      .find(rule => {
        if (!rule.value) return false;
        const t = testPrompt.toLowerCase();
        const v = rule.value.toLowerCase();
        if (rule.operator === 'contains')    return t.includes(v);
        if (rule.operator === 'equals')      return t === v;
        if (rule.operator === 'starts_with') return t.startsWith(v);
        return false;
      }) ?? null;
  }, [testPrompt, routingRules]);

  const sel = 'bg-zinc-950 border border-zinc-800 text-white text-[11px] rounded px-2 py-1.5 focus:border-zinc-500 focus:outline-none min-w-0 font-mono';

  return (
    <div className="bg-[#121215] border border-[#27272a] rounded-lg p-4 text-white font-mono flex flex-col gap-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xs font-bold tracking-widest text-zinc-300">ROUTING RULES</h2>
          <p className="text-[10px] text-zinc-600 mt-0.5">Built from live activity — routes tasks to agents + providers</p>
        </div>
        <button
          onClick={handleAddBlank}
          className="bg-zinc-900 hover:bg-zinc-800 text-white border border-zinc-700 px-2.5 py-1.5 rounded text-[11px] flex items-center gap-1.5"
        >
          <Plus size={12} /> ADD RULE
        </button>
      </div>

      {/* Suggestions from activity */}
      {suggestions.length > 0 && (
        <div className="border border-zinc-800 rounded-lg p-3 bg-black/40">
          <p className="text-[10px] text-zinc-500 mb-2 tracking-wider flex items-center gap-1.5">
            <Sparkles size={10} className="text-cyan-400" />
            SUGGESTED FROM LIVE ACTIVITY
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => handleAcceptSuggestion(s)}
                className="flex items-center gap-1.5 px-2 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 hover:border-cyan-700 rounded text-[10px] text-zinc-300 transition"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                {s._label}
                <span className="text-zinc-600 ml-1">+ add</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Rules list */}
      <div className="space-y-1.5">
        {routingRules.length === 0 ? (
          <div className="text-center py-8 text-zinc-600 text-[11px] border border-dashed border-zinc-800 rounded-lg bg-black">
            <p>No routing rules yet.</p>
            <p className="mt-1 text-zinc-700">Use <span className="text-zinc-500">ADD RULE</span> or accept a suggestion above as activity grows.</p>
          </div>
        ) : (
          <>
            <div className="grid text-[9px] text-zinc-600 tracking-widest mb-1 px-1" style={{ gridTemplateColumns: '18px 1fr 1fr 1fr 14px 1fr 1fr 26px 22px' }}>
              <span>#</span><span>FIELD</span><span>OP</span><span>VALUE</span><span />
              <span>AGENT</span><span>MODEL</span><span>PRI</span><span />
            </div>
            {routingRules.map((rule, idx) => {
              const isMatched = rule.id === matchedRule?.id;
              const accent = MODEL_COLORS[rule.model] ?? '#71717a';
              const enabled = rule.enabled !== false;
              return (
                <div
                  key={rule.id}
                  className={`grid items-center gap-1.5 px-2 py-1.5 rounded-lg border transition-all ${
                    !enabled
                      ? 'opacity-40 border-zinc-900 bg-black/30'
                      : isMatched
                        ? 'border-cyan-500/50 bg-zinc-900/80 shadow-[0_0_8px_rgba(34,211,238,0.12)]'
                        : 'border-zinc-800/60 bg-black/60 hover:border-zinc-700'
                  }`}
                  style={{ gridTemplateColumns: '18px 1fr 1fr 1fr 14px 1fr 1fr 26px 22px' }}
                >
                  <span className="text-[9px] text-zinc-600 text-center">{idx + 1}</span>

                  <select value={rule.field} onChange={e => updateRoutingRule(rule.id, { field: e.target.value })} className={sel}>
                    {FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>

                  <select value={rule.operator} onChange={e => updateRoutingRule(rule.id, { operator: e.target.value })} className={sel}>
                    {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>

                  <input
                    type="text"
                    placeholder="value…"
                    value={rule.value}
                    onChange={e => updateRoutingRule(rule.id, { value: e.target.value })}
                    className={sel}
                  />

                  <ArrowRight size={10} className="text-zinc-700 mx-auto" />

                  <select value={rule.targetAgent} onChange={e => updateRoutingRule(rule.id, { targetAgent: e.target.value })} className={sel}>
                    {agentIds.map(id => <option key={id} value={id}>{id}</option>)}
                  </select>

                  <div className="flex items-center gap-1 min-w-0">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: accent }} />
                    <select
                      value={rule.model ?? ''}
                      onChange={e => updateRoutingRule(rule.id, { model: e.target.value })}
                      className={`${sel} flex-1`}
                      style={{ borderColor: `${accent}30` }}
                    >
                      {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>

                  <input
                    type="number"
                    min={1} max={10}
                    value={rule.priority ?? 5}
                    onChange={e => updateRoutingRule(rule.id, { priority: Number(e.target.value) })}
                    className={`${sel} w-10 text-center`}
                    title="Priority (1=highest)"
                  />

                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() => updateRoutingRule(rule.id, { enabled: !enabled })}
                      className={`transition-colors ${enabled ? 'text-cyan-500 hover:text-cyan-300' : 'text-zinc-700 hover:text-zinc-500'}`}
                      title={enabled ? 'Disable rule' : 'Enable rule'}
                    >
                      {enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                    </button>
                    <button
                      onClick={() => deleteRoutingRule(rule.id)}
                      className="text-zinc-700 hover:text-red-400 transition-colors p-0.5"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Provider legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[9px] text-zinc-600">
        {Object.entries(MODEL_COLORS).map(([m, c]) => (
          <span key={m} className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: c }} />
            {m}
          </span>
        ))}
      </div>

      {/* Dry-run tester */}
      <div className="bg-black border border-zinc-800 rounded-lg p-3">
        <p className="text-[10px] text-zinc-500 mb-2 tracking-wider flex items-center gap-1.5">
          <Zap size={10} /> DRY-RUN TESTER
        </p>
        <textarea
          value={testPrompt}
          onChange={e => setTestPrompt(e.target.value)}
          placeholder="Type a task — see which rule + provider fires…"
          className="w-full bg-zinc-950 border border-zinc-800 text-white text-[11px] rounded px-2.5 py-2 focus:outline-none focus:border-zinc-600 resize-none min-h-[56px]"
        />
        {testPrompt && (
          <div className={`mt-2 text-[11px] flex items-center gap-2 ${matchedRule ? '' : 'text-zinc-600'}`}
            style={matchedRule ? { color: MODEL_COLORS[matchedRule.model] ?? '#fff' } : {}}>
            {matchedRule ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: MODEL_COLORS[matchedRule.model] ?? '#fff' }} />
                → <strong>{matchedRule.targetAgent}</strong> via <strong>{matchedRule.model}</strong>
                <span className="text-zinc-600 ml-1">(priority {matchedRule.priority})</span>
              </>
            ) : (
              <span>No matching rule — task falls through to default agent.</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
