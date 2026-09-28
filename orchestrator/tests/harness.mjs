#!/usr/bin/env node
/**
 * Ultron Memory System — Scenario Test Harness
 *
 * Runs all YAML scenarios in orchestrator/tests/scenarios/ against a real
 * orchestrator server instance with an isolated SQLite DB per scenario.
 *
 * Usage (from project root D:/pRoG/multi cli/):
 *   node orchestrator/tests/harness.mjs
 *   node orchestrator/tests/harness.mjs --scenario cross-session-recall
 *
 * Requirements:
 *   - Node 18+ (built-in fetch)
 *   - orchestrator binary at ./orchestrator/orchestrator (or ./orchestrator/orchestrator.exe)
 *   - config.yaml at ./orchestrator/config.yaml
 *   - Python3 available for YAML parsing (fallback: built-in mini-parser)
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT       = join(__dirname, '..', '..');          // D:/pRoG/multi cli/
const ORC_DIR    = join(ROOT, 'orchestrator');           // orchestrator/
const SCEN_DIR   = join(__dirname, 'scenarios');
const RESULTS_DIR = join(SCEN_DIR, 'results');
const BINARY     = process.platform === 'win32'
  ? join(ORC_DIR, 'orchestrator.exe')
  : join(ORC_DIR, 'orchestrator');
const CONFIG_SRC = join(ORC_DIR, 'config.yaml');
const TEST_PORT  = 18099;
const SERVER_BASE = `http://localhost:${TEST_PORT}`;

// ─── YAML parser ──────────────────────────────────────────────────────────────

function parseYaml(text) {
  // Try Python3 first (handles full YAML spec)
  try {
    const json = execSync(
      `python3 -c "import yaml,json,sys; print(json.dumps(yaml.safe_load(sys.stdin.read())))"`,
      { input: text, timeout: 5000, encoding: 'utf8' }
    );
    return JSON.parse(json);
  } catch {
    // fall through to mini-parser
  }
  return miniYamlParse(text);
}

/**
 * Minimal recursive YAML parser for the scenario schema subset.
 * Handles: scalars, quoted strings, arrays (- items), nested objects (key: value),
 * block scalars (>), inline arrays ([a, b]), numbers, booleans.
 */
function miniYamlParse(text) {
  const lines = text.split('\n');
  let pos = 0;

  function peek() { return pos < lines.length ? lines[pos] : null; }
  function consume() { return lines[pos++]; }
  function indent(line) {
    const m = line.match(/^(\s*)/);
    return m ? m[1].length : 0;
  }
  function isComment(line) { return /^\s*#/.test(line) || line.trim() === ''; }

  function parseValue(raw) {
    const v = raw.trim();
    if (v === 'true')  return true;
    if (v === 'false') return false;
    if (v === 'null' || v === '~' || v === '') return null;
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    if ((v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))) {
      return v.slice(1, -1);
    }
    if (v.startsWith('[') && v.endsWith(']')) {
      const inner = v.slice(1, -1);
      return inner.split(',').map(s => parseValue(s.trim())).filter(x => x !== null || s.trim() === 'null');
    }
    // Multiline block (> or |) — caller handles these separately
    return v;
  }

  function parseBlock(baseIndent) {
    const obj = {};
    while (pos < lines.length) {
      const line = peek();
      if (line === null) break;
      if (isComment(line)) { consume(); continue; }
      const ind = indent(line);
      if (ind < baseIndent) break;
      consume();
      const trimmed = line.trimStart();
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;
      const key = trimmed.slice(0, colonIdx).trim();
      let rest = trimmed.slice(colonIdx + 1).trimStart();
      // Strip inline comment
      const hashIdx = rest.indexOf(' #');
      if (hashIdx !== -1) rest = rest.slice(0, hashIdx).trim();
      if (rest === '>' || rest === '|') {
        // Block scalar: collect subsequent indented lines
        const bodyLines = [];
        while (pos < lines.length) {
          const next = peek();
          if (next === null || (next.trim() !== '' && indent(next) <= ind)) break;
          bodyLines.push(consume().trim());
        }
        obj[key] = bodyLines.join(' ');
      } else if (rest === '') {
        // Look ahead to determine: nested mapping or sequence
        const next = peek();
        if (next !== null && !isComment(next) && indent(next) > ind) {
          const nextTrimmed = next.trimStart();
          if (nextTrimmed.startsWith('- ')) {
            obj[key] = parseList(ind + 1);
          } else {
            obj[key] = parseBlock(ind + 1);
          }
        } else {
          obj[key] = null;
        }
      } else {
        obj[key] = parseValue(rest);
      }
    }
    return obj;
  }

  function parseList(baseIndent) {
    const arr = [];
    while (pos < lines.length) {
      const line = peek();
      if (line === null) break;
      if (isComment(line)) { consume(); continue; }
      const ind = indent(line);
      if (ind < baseIndent) break;
      const trimmed = line.trimStart();
      if (!trimmed.startsWith('- ') && trimmed !== '-') break;
      consume();
      const rest = trimmed.slice(2).trimStart();
      if (rest === '' || rest === '{}') {
        // Next lines are the object fields for this list item
        const next = peek();
        if (next !== null && !isComment(next) && indent(next) > ind) {
          arr.push(parseBlock(ind + 1));
        } else {
          arr.push({});
        }
      } else if (rest.includes(':')) {
        // Inline mapping — parse as a single-key object, then continue
        const colonIdx = rest.indexOf(':');
        const k = rest.slice(0, colonIdx).trim();
        const v = rest.slice(colonIdx + 1).trim();
        const item = { [k]: parseValue(v) };
        // Merge subsequent lines at same indent+2 into this item
        const next = peek();
        if (next !== null && !isComment(next) && indent(next) > ind) {
          Object.assign(item, parseBlock(ind + 2));
        }
        arr.push(item);
      } else {
        arr.push(parseValue(rest));
      }
    }
    return arr;
  }

  return parseBlock(0);
}

// ─── Ultron system prompt (minimal — enough to activate tool use) ─────────────

function buildSystemPrompt() {
  const date = new Date().toISOString().split('T')[0];
  return `# ULTRON — Orchestration Intelligence
Date: ${date}
You are Ultron, the autonomous orchestrator of the 01RG0 multi-CLI platform.
You have persistent memory tools. Always use search_memory before answering
questions about user preferences or past facts. Use upsert_memory to store
new preferences, facts, and lessons. Use update_core_memory for identity-level
information that should persist forever. Use list_episodes to review task history.
Respond concisely and precisely.`;
}

// ─── ULTRON_TOOLS (mirrors useOrchestatorChat.ts exactly) ────────────────────

const ULTRON_TOOLS = [
  {
    name: 'search_memory',
    description: 'Search the knowledge graph for relevant nodes.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
  },
  {
    name: 'upsert_memory',
    description: 'Add or update a node in the knowledge graph.',
    input_schema: {
      type: 'object',
      properties: {
        label:      { type: 'string' },
        type:       { type: 'string', enum: ['preference', 'fact', 'lesson', 'feedback', 'project', 'person'] },
        content:    { type: 'string' },
        confidence: { type: 'number' },
      },
      required: ['label', 'type', 'content'],
    },
  },
  {
    name: 'get_core_memory',
    description: 'Read the persistent core memory block.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'update_core_memory',
    description: 'Update the persistent core memory block.',
    input_schema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] },
  },
  {
    name: 'list_episodes',
    description: 'List recent task history with outcomes.',
    input_schema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'dispatch_task',
    description: 'Dispatch a task to a specific CLI agent.',
    input_schema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', enum: ['opencode','codex','vibe','agy','grok','cline','kilo','cursor','hermes','deepseek','harness','kimocode','pi','researcher','debugger','jules'] },
        prompt:   { type: 'string' },
        priority: { type: 'number' },
      },
      required: ['agent_id', 'prompt'],
    },
  },
  {
    name: 'dispatch_pipeline',
    description: 'Dispatch a multi-agent pipeline. Steps run sequentially.',
    input_schema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              agent_id: { type: 'string' },
              prompt:   { type: 'string' },
            },
            required: ['agent_id', 'prompt'],
          },
        },
      },
      required: ['steps'],
    },
  },
  {
    name: 'get_queue_status',
    description: 'Get the current task queue status.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_agent_status',
    description: 'Get which CLI agents are idle or running.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_provider_health',
    description: 'Get the health and latency of all configured LLM providers.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'schedule_cron',
    description: 'Schedule a recurring task.',
    input_schema: {
      type: 'object',
      properties: {
        cron:     { type: 'string' },
        agent_id: { type: 'string' },
        prompt:   { type: 'string' },
      },
      required: ['cron', 'agent_id', 'prompt'],
    },
  },
  {
    name: 'update_routing_rule',
    description: 'Add or update a routing rule.',
    input_schema: {
      type: 'object',
      properties: {
        name:            { type: 'string' },
        condition:       { type: 'string' },
        target_provider: { type: 'string' },
        priority:        { type: 'number' },
      },
      required: ['name', 'condition', 'target_provider'],
    },
  },
  {
    name: 'record_feedback',
    description: 'Record feedback on a task outcome.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        outcome: { type: 'string', enum: ['success', 'failure', 'partial'] },
        notes:   { type: 'string' },
      },
      required: ['task_id', 'outcome'],
    },
  },
  {
    name: 'cancel_task',
    description: 'Cancel a queued task by ID.',
    input_schema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
  },
  {
    name: 'retry_task',
    description: 'Retry a failed task by ID.',
    input_schema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
  },
  {
    name: 'run_skill',
    description: 'Run a saved skill by name.',
    input_schema: {
      type: 'object',
      properties: {
        skill_name: { type: 'string' },
        input:      { type: 'string' },
      },
      required: ['skill_name'],
    },
  },
  {
    name: 'list_skills',
    description: 'List all available skills.',
    input_schema: { type: 'object', properties: {} },
  },
];

// ─── Tool executor (mirrors useOrchestatorChat.ts executeTool) ────────────────

async function executeTool(name, input, base) {
  try {
    switch (name) {
      case 'search_memory': {
        const r = await fetch(`${base}/api/memory/search?q=${encodeURIComponent(input.query)}&limit=${input.limit ?? 5}`);
        return JSON.stringify(await r.json());
      }
      case 'upsert_memory': {
        const r = await fetch(`${base}/api/memory/upsert`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
        });
        return JSON.stringify(await r.json());
      }
      case 'get_core_memory': {
        const r = await fetch(`${base}/api/memory/core`);
        return JSON.stringify(await r.json());
      }
      case 'update_core_memory': {
        const r = await fetch(`${base}/api/memory/core`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
        });
        return JSON.stringify(await r.json());
      }
      case 'list_episodes': {
        const r = await fetch(`${base}/api/memory/episodes?limit=${input.limit ?? 10}`);
        return JSON.stringify(await r.json());
      }
      case 'dispatch_task': {
        const r = await fetch(`${base}/api/tasks/enqueue`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId: input.agent_id, prompt: input.prompt, priority: input.priority ?? 5 }),
        });
        return JSON.stringify(await r.json());
      }
      case 'dispatch_pipeline': {
        const steps = input.steps ?? [];
        const results = [];
        for (const s of steps) {
          const r = await fetch(`${base}/api/tasks/enqueue`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId: s.agent_id, prompt: s.prompt }),
          });
          results.push(await r.json());
        }
        return JSON.stringify(results);
      }
      case 'get_queue_status': {
        const r = await fetch(`${base}/api/tasks`);
        return JSON.stringify(await r.json());
      }
      case 'get_agent_status': {
        const r = await fetch(`${base}/api/agents/status`);
        return JSON.stringify(await r.json());
      }
      case 'get_provider_health': {
        const r = await fetch(`${base}/health`);
        return JSON.stringify(await r.json());
      }
      case 'list_skills': {
        const r = await fetch(`${base}/api/skills`);
        return JSON.stringify(await r.json());
      }
      case 'run_skill': {
        const listRes = await fetch(`${base}/api/skills`);
        const list = await listRes.json();
        const skill = Array.isArray(list) ? list.find(s => s.name === input.skill_name) : null;
        if (!skill) return JSON.stringify({ error: `skill not found: ${input.skill_name}` });
        const r = await fetch(`${base}/api/skills/${skill.id}/run`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: input.input || '' }),
        });
        return JSON.stringify(await r.json());
      }
      default:
        return JSON.stringify({ error: `unhandled tool in harness: ${name}` });
    }
  } catch (e) {
    return JSON.stringify({ error: String(e) });
  }
}

// ─── Agentic turn loop ────────────────────────────────────────────────────────

const COOLDOWN_WAIT_MS = 70_000; // slightly over the 60s server cooldown
const MAX_RETRIES = 3;

async function fetchWithRetry(base, payload) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) return res.json();
    const body = await res.text();
    const isExhausted = body.includes('exhausted') || body.includes('cooling down') || res.status === 429 || res.status === 502;
    if (isExhausted && attempt < MAX_RETRIES) {
      console.log(`      ⏳ providers exhausted/cooling — waiting ${COOLDOWN_WAIT_MS / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})...`);
      await sleep(COOLDOWN_WAIT_MS);
      continue;
    }
    throw new Error(`/v1/messages HTTP ${res.status}: ${body}`);
  }
}

async function runTurn(conversationHistory, userText, base) {
  conversationHistory.push({ role: 'user', content: userText });

  const toolsCalled = [];
  let responseText  = '';
  const MAX_TURNS   = 10;
  let turns         = 0;

  while (turns < MAX_TURNS) {
    turns++;
    const payload = {
      model:      'us.anthropic.claude-sonnet-4-6',
      max_tokens: 2048,
      system:     buildSystemPrompt(),
      tools:      ULTRON_TOOLS,
      messages:   conversationHistory,
    };

    const response = await fetchWithRetry(base, payload);
    if (response.error) throw new Error(`API error: ${response.error.message}`);

    // Collect text blocks
    for (const block of (response.content || [])) {
      if (block.type === 'text') responseText += block.text + '\n';
    }

    // Add assistant turn to history
    conversationHistory.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') break;

    // Execute tool calls
    const toolResultBlocks = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      toolsCalled.push({ name: block.name, input: block.input });
      const result = await executeTool(block.name, block.input, base);
      toolResultBlocks.push({ type: 'tool_result', tool_use_id: block.id, content: result });
    }
    conversationHistory.push({ role: 'user', content: toolResultBlocks });
  }

  return { responseText: responseText.trim(), toolsCalled };
}

// ─── Assertions ───────────────────────────────────────────────────────────────

function assertTurn(sessionId, turnIdx, result, assert) {
  const failures = [];
  if (!assert) return failures;

  if (assert.response_contains) {
    for (const word of assert.response_contains) {
      if (!result.responseText.toLowerCase().includes(word.toLowerCase())) {
        failures.push(`[${sessionId}/turn${turnIdx}] response_contains "${word}" — not found in:\n  "${result.responseText.slice(0, 200)}"`);
      }
    }
  }
  if (assert.tools_called) {
    for (const tool of assert.tools_called) {
      if (!result.toolsCalled.some(t => t.name === tool)) {
        const called = result.toolsCalled.map(t => t.name).join(', ') || '(none)';
        failures.push(`[${sessionId}/turn${turnIdx}] expected tool "${tool}" to be called — tools called: ${called}`);
      }
    }
  }
  if (assert.tools_called_any) {
    // At least one of the listed tools must have been called
    const anyMatch = assert.tools_called_any.some(tool => result.toolsCalled.some(t => t.name === tool));
    if (!anyMatch) {
      const called = result.toolsCalled.map(t => t.name).join(', ') || '(none)';
      failures.push(`[${sessionId}/turn${turnIdx}] expected at least one of [${assert.tools_called_any.join(', ')}] to be called — tools called: ${called}`);
    }
  }
  if (assert.tools_not_called) {
    for (const tool of assert.tools_not_called) {
      if (result.toolsCalled.some(t => t.name === tool)) {
        failures.push(`[${sessionId}/turn${turnIdx}] tool "${tool}" was called but should not have been`);
      }
    }
  }
  return failures;
}

// ─── Post-checks ──────────────────────────────────────────────────────────────

async function runPostCheck(check, base) {
  try {
    if (check.type === 'search_memory') {
      const r = await fetch(`${base}/api/memory/search?q=${encodeURIComponent(check.query)}&limit=10`);
      const data = await r.json();
      const nodes = Array.isArray(data) ? data : (data.results || []);
      const needle = check.expect_label_contains.toLowerCase();
      const found = nodes.some(n => {
        const node = n.node || n;
        const searchIn = [node.label, node.body, node.summary].map(s => (s || '').toLowerCase()).join(' ');
        return searchIn.includes(needle);
      });
      return found ? null : `post_check search_memory "${check.query}" → no label/body containing "${check.expect_label_contains}" (got ${nodes.length} results)`;
    }
    if (check.type === 'core_memory_contains') {
      const r = await fetch(`${base}/api/memory/core`);
      const data = await r.json();
      const text = JSON.stringify(data);
      return text.includes(check.substring) ? null : `post_check core_memory_contains "${check.substring}" — not found`;
    }
    if (check.type === 'episode_count_gte') {
      const r = await fetch(`${base}/api/memory/episodes?limit=200`);
      const data = await r.json();
      const eps = Array.isArray(data) ? data : (data.episodes || []);
      return eps.length >= check.n ? null : `post_check episode_count_gte ${check.n} — got ${eps.length}`;
    }
    return `post_check unknown type: ${check.type}`;
  } catch (e) {
    return `post_check error: ${e.message}`;
  }
}

// ─── Server lifecycle ─────────────────────────────────────────────────────────

function writeTestConfig(scenarioId) {
  const rawConfig = readFileSync(CONFIG_SRC, 'utf8');
  const dbPath = process.platform === 'win32'
    ? `C:/Temp/ultron-test-${scenarioId}.db`
    : `/tmp/ultron-test-${scenarioId}.db`;
  const patched = rawConfig
    .replace(/db_path:\s*\S+/,       `db_path: ${dbPath}`)
    .replace(/proxy_port:\s*\d+/,    `proxy_port: ${TEST_PORT}`)
    .replace(/proxy_log:\s*\S+/,     'proxy_log: false');
  const tmpCfg = process.platform === 'win32'
    ? `C:/Temp/ultron-test-${scenarioId}.yaml`
    : `/tmp/ultron-test-${scenarioId}.yaml`;
  writeFileSync(tmpCfg, patched);
  return tmpCfg;
}

async function startServer(cfgPath) {
  const proc = spawn(BINARY, ['--workers', cfgPath], {
    cwd: ORC_DIR,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.stdout.on('data', d => process.stdout.write(`  [server] ${d}`));
  proc.stderr.on('data', d => process.stderr.write(`  [server] ${d}`));

  // Wait for /health
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${SERVER_BASE}/health`);
      if (r.ok) return proc;
    } catch {
      // not ready yet
    }
    await sleep(500);
  }
  proc.kill();
  throw new Error('Server did not become healthy within 20s');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Load scenario files ──────────────────────────────────────────────────────

function loadScenarios(filterName) {
  const files = readdirSync(SCEN_DIR)
    .filter(f => f.endsWith('.yaml') && f !== 'RESULTS.md');

  const scenarios = [];
  for (const file of files) {
    const text = readFileSync(join(SCEN_DIR, file), 'utf8');
    const parsed = parseYaml(text);
    if (filterName && parsed.id !== filterName) continue;
    scenarios.push(parsed);
  }
  return scenarios;
}

// ─── Run one scenario ─────────────────────────────────────────────────────────

async function runScenario(scenario) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`SCENARIO: ${scenario.id} — ${scenario.name}`);
  console.log(`${'─'.repeat(60)}`);

  const cfgPath = writeTestConfig(scenario.id);
  let proc = null;
  const allFailures = [];
  const sessionResults = [];

  try {
    proc = await startServer(cfgPath);
    console.log(`  ✓ server up at ${SERVER_BASE}`);

    for (const session of (scenario.sessions || [])) {
      console.log(`\n  Session: ${session.id}`);
      const conversationHistory = [];
      const turnResults = [];

      for (let i = 0; i < (session.turns || []).length; i++) {
        const turn = session.turns[i];
        console.log(`    Turn ${i + 1}: "${turn.user.slice(0, 60)}..."`);
        const result = await runTurn(conversationHistory, turn.user, SERVER_BASE);
        console.log(`      tools called: [${result.toolsCalled.map(t => t.name).join(', ') || 'none'}]`);
        console.log(`      response: "${result.responseText.slice(0, 80)}..."`);

        const failures = assertTurn(session.id, i + 1, result, turn.assert);
        for (const f of failures) {
          console.log(`      ✗ ${f}`);
          allFailures.push(f);
        }
        if (failures.length === 0 && turn.assert) {
          console.log(`      ✓ assertions passed`);
        }
        turnResults.push({ turn: i + 1, user: turn.user, toolsCalled: result.toolsCalled.map(t => t.name), response: result.responseText, failures });
      }
      sessionResults.push({ id: session.id, turns: turnResults });
    }

    // Post-checks
    const postCheckResults = [];
    for (const check of (scenario.post_checks || [])) {
      console.log(`\n  Post-check: ${check.type}`);
      const failure = await runPostCheck(check, SERVER_BASE);
      if (failure) {
        console.log(`    ✗ ${failure}`);
        allFailures.push(failure);
        postCheckResults.push({ check, passed: false, error: failure });
      } else {
        console.log(`    ✓ passed`);
        postCheckResults.push({ check, passed: true });
      }
    }

    const passed = allFailures.length === 0;
    console.log(`\n  Result: ${passed ? '✓ PASS' : `✗ FAIL (${allFailures.length} failures)`}`);

    const resultJson = {
      id:          scenario.id,
      name:        scenario.name,
      passed,
      failures:    allFailures,
      sessions:    sessionResults,
      post_checks: postCheckResults,
      ran_at:      new Date().toISOString(),
    };

    if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
    writeFileSync(join(RESULTS_DIR, `${scenario.id}.json`), JSON.stringify(resultJson, null, 2));

    return resultJson;

  } finally {
    if (proc) {
      proc.kill();
      await sleep(300);
    }
  }
}

// ─── Generate RESULTS.md ──────────────────────────────────────────────────────

function generateResultsMd(results) {
  const now = new Date().toISOString();
  const passed = results.filter(r => r.passed).length;
  const total  = results.length;

  const rows = results.map(r => {
    const icon = r.passed ? '✅ PASS' : '❌ FAIL';
    const sessions = r.sessions?.length ?? 0;
    const failCount = r.failures?.length ?? 0;
    return `| ${r.id} | ${icon} | ${sessions} | ${failCount} |`;
  }).join('\n');

  const details = results.map(r => {
    const lines = [`### ${r.id}\n`];
    if (!r.passed) {
      lines.push('**Failures:**');
      for (const f of r.failures) lines.push(`- ${f}`);
    } else {
      lines.push('All assertions passed.');
    }
    return lines.join('\n');
  }).join('\n\n');

  const md = `# Ultron Memory System — Scenario Test Results

> Last run: ${now}
> Passed: ${passed}/${total}

## Summary

| Scenario | Status | Sessions | Failures |
|----------|--------|----------|----------|
${rows}

## How to run

\`\`\`bash
# From project root: D:/pRoG/multi cli/
node orchestrator/tests/harness.mjs

# Run a single scenario:
node orchestrator/tests/harness.mjs --scenario cross-session-recall
\`\`\`

## Scenario Descriptions

| Scenario | What it tests |
|----------|---------------|
| same-session-recall | Ultron recalls facts from earlier in the same conversation without memory tools |
| cross-session-recall | Fact stored in session 1 is retrievable in a fresh session 2 via search_memory |
| contradiction-handling | Updated preference overwrites old node (UpsertNode dedup by label+type) |
| casual-vs-explicit-memorization | Explicit 'remember forever' reliably triggers upsert_memory |
| failure-mode-learning | Lesson from failure is recorded and retrieved in a future session |
| core-vs-graph-boundary | update_core_memory vs upsert_memory used for different scopes |
| retrieval-relevance-check | Paraphrased queries retrieve correct technology facts via BM25+cosine search |
| episode-growth-stress | Task dispatch generates episodes visible via list_episodes |
| concurrent-dispatch | dispatch_pipeline creates tasks visible via get_queue_status |

## Detailed Results

${details}
`;
  writeFileSync(join(SCEN_DIR, 'RESULTS.md'), md);
  console.log(`\nResults written to orchestrator/tests/scenarios/RESULTS.md`);
}

// ─── Run one scenario against an EXISTING server (no spawn/kill) ─────────────

async function runScenarioHosted(scenario, hostBase) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`SCENARIO: ${scenario.id} — ${scenario.name}`);
  console.log(`${'─'.repeat(60)}`);

  const allFailures = [];
  const sessionResults = [];

  for (const session of (scenario.sessions || [])) {
    console.log(`\n  Session: ${session.id}`);
    const conversationHistory = [];
    const turnResults = [];

    for (let i = 0; i < (session.turns || []).length; i++) {
      const turn = session.turns[i];
      console.log(`    Turn ${i + 1}: "${(turn.user || '').slice(0, 60)}..."`);
      const result = await runTurn(conversationHistory, turn.user, hostBase);
      console.log(`      tools called: [${result.toolsCalled.map(t => t.name).join(', ') || 'none'}]`);
      console.log(`      response: "${result.responseText.slice(0, 120)}"`);

      const failures = assertTurn(session.id, i + 1, result, turn.assert);
      for (const f of failures) {
        console.log(`      ✗ ${f}`);
        allFailures.push(f);
      }
      if (failures.length === 0 && turn.assert) console.log(`      ✓ assertions passed`);
      turnResults.push({ turn: i + 1, user: turn.user, toolsCalled: result.toolsCalled.map(t => t.name), response: result.responseText, failures });
    }
    sessionResults.push({ id: session.id, turns: turnResults });
  }

  const postCheckResults = [];
  for (const check of (scenario.post_checks || [])) {
    console.log(`\n  Post-check: ${check.type}`);
    const failure = await runPostCheck(check, hostBase);
    if (failure) {
      console.log(`    ✗ ${failure}`);
      allFailures.push(failure);
      postCheckResults.push({ check, passed: false, error: failure });
    } else {
      console.log(`    ✓ passed`);
      postCheckResults.push({ check, passed: true });
    }
  }

  const passed = allFailures.length === 0;
  console.log(`\n  Result: ${passed ? '✓ PASS' : `✗ FAIL (${allFailures.length} failures)`}`);

  const resultJson = { id: scenario.id, name: scenario.name, passed, failures: allFailures, sessions: sessionResults, post_checks: postCheckResults, ran_at: new Date().toISOString() };
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, `${scenario.id}.json`), JSON.stringify(resultJson, null, 2));
  return resultJson;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const scenarioFlag = args.indexOf('--scenario');
  const filterName   = scenarioFlag !== -1 ? args[scenarioFlag + 1] : null;
  const hostFlag     = args.indexOf('--host');
  const hostOverride = hostFlag !== -1 ? args[hostFlag + 1] : null;

  // --host <url>: skip server spawn, run against existing server
  if (hostOverride) {
    const base = hostOverride.replace(/\/$/, '');
    console.log(`Using existing server at ${base} (no DB isolation)`);
    const scenarios = loadScenarios(filterName);
    if (scenarios.length === 0) { console.error('No scenarios found'); process.exit(1); }
    console.log(`Running ${scenarios.length} scenario(s)...`);
    const results = [];
    for (let i = 0; i < scenarios.length; i++) {
      if (i > 0) {
        console.log(`\n  ⏸  Pausing 15s between scenarios to ease rate limits...`);
        await sleep(15_000);
      }
      results.push(await runScenarioHosted(scenarios[i], base));
    }
    generateResultsMd(results);
    const failed = results.filter(r => !r.passed);
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`TOTAL: ${results.length - failed.length}/${results.length} passed`);
    if (failed.length > 0) { console.log('FAILED:'); for (const r of failed) console.log(`  - ${r.id}`); process.exit(1); }
    return;
  }

  if (!existsSync(BINARY)) {
    console.error(`ERROR: orchestrator binary not found at ${BINARY}`);
    console.error('Build it first: cd orchestrator && go build -o orchestrator ./cmd/orchestrator/');
    process.exit(1);
  }
  if (!existsSync(CONFIG_SRC)) {
    console.error(`ERROR: config.yaml not found at ${CONFIG_SRC}`);
    process.exit(1);
  }

  // Ensure Temp dir on Windows
  if (process.platform === 'win32') {
    try { mkdirSync('C:/Temp', { recursive: true }); } catch {}
  }

  const scenarios = loadScenarios(filterName);
  if (scenarios.length === 0) {
    console.error(filterName
      ? `No scenario found with id "${filterName}"`
      : 'No scenario YAML files found in ' + SCEN_DIR);
    process.exit(1);
  }

  console.log(`Running ${scenarios.length} scenario(s)...`);

  const results = [];
  for (const scenario of scenarios) {
    const r = await runScenario(scenario);
    results.push(r);
  }

  generateResultsMd(results);

  const failed = results.filter(r => !r.passed);
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`TOTAL: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) {
    console.log('FAILED scenarios:');
    for (const r of failed) console.log(`  - ${r.id}`);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
