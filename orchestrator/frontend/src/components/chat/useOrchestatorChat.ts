/**
 * useOrchestatorChat — Ultron's agentic chat hook.
 *
 * Manages conversation state, runs the full Anthropic tool-use loop via the
 * local proxy at http://localhost:8080/v1/messages, and surfaces WS task
 * events from the shared Zustand store as inline task cards.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useSwarmStore } from '../../store/useSwarmStore';
import { ULTRON_SYSTEM_PROMPT, buildUltronSystemPrompt } from './ultronPrompt';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ToolUseBlock {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface FileAttachment {
  id: string;
  name: string;
  url: string;
  size: number;
  mimeType: string;
  category: 'audio' | 'document' | 'image' | 'code' | 'other';
}

export interface ChatMessage {
  id: string;
  /** Alias for id — used by react-chat-elements / BubbleList as the React key */
  key: string;
  /** role driving the display logic */
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'task_card';
  content: string;
  /** which CLI agent this task was dispatched to */
  agentId?: string;
  /** task ID returned by dispatch_task */
  taskId?: string;
  toolUse?: ToolUseBlock;
  toolResult?: string;
  /** how long the tool took in ms */
  toolDurationMs?: number;
  /** assistant streaming / final / error / loading (loading = waiting for first token) */
  status?: 'loading' | 'streaming' | 'done' | 'error';
  timestamp: number;
  /** rich file attachments */
  attachments?: FileAttachment[];
  /** token usage for assistant turns */
  usage?: { input_tokens: number; output_tokens: number; total_tokens?: number };
  /** total turn latency in ms */
  latencyMs?: number;
  /** user thumbs up / down feedback */
  feedback?: 'up' | 'down';
  /** model identifier */
  model?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  agentId: string;
  /** idle = no active task; other states mirror task lifecycle */
  status: 'running' | 'completed' | 'failed' | 'queued' | 'idle';
  lastMessage: string;
  updatedAt: number;
}

// ─── Utility: attachment category & file size ─────────────────────────────────

export function detectAttachmentCategory(
  mimeType: string,
  filename: string,
): 'audio' | 'document' | 'image' | 'code' | 'other' {
  const mime = (mimeType || '').toLowerCase();
  const ext = (filename.split('.').pop() || '').toLowerCase();

  if (
    mime.startsWith('audio/') ||
    ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'webm', 'wma', 'opus'].includes(ext)
  ) {
    return 'audio';
  }
  if (
    mime.startsWith('image/') ||
    ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'tiff'].includes(ext)
  ) {
    return 'image';
  }
  if (
    mime.includes('pdf') ||
    mime.includes('word') ||
    mime.includes('document') ||
    mime.includes('csv') ||
    mime.includes('sheet') ||
    mime.includes('presentation') ||
    mime.includes('text/plain') ||
    ['pdf', 'doc', 'docx', 'txt', 'csv', 'xlsx', 'xls', 'ppt', 'pptx', 'rtf', 'odt', 'ods'].includes(ext)
  ) {
    return 'document';
  }
  if (
    mime.includes('javascript') ||
    mime.includes('typescript') ||
    mime.includes('json') ||
    mime.includes('xml') ||
    mime.includes('html') ||
    mime.includes('css') ||
    [
      'js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp',
      'cs', 'rb', 'php', 'swift', 'kt', 'sql', 'sh', 'bash', 'zsh', 'yaml', 'yml',
      'json', 'xml', 'html', 'css', 'scss', 'md', 'toml', 'env', 'proto'
    ].includes(ext)
  ) {
    return 'code';
  }
  return 'other';
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Utility: relative time formatter ────────────────────────────────────────

/** Returns a human-readable relative time string, e.g. "2m ago", "just now". */
export function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000)  return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ─── Anthropic API shapes ─────────────────────────────────────────────────────

type ApiTextBlock   = { type: 'text';        text: string };
type ApiToolUse     = { type: 'tool_use';    id: string; name: string; input: Record<string, unknown> };
type ApiToolResult  = { type: 'tool_result'; tool_use_id: string; content: string };
type ApiContentBlock = ApiTextBlock | ApiToolUse | ApiToolResult;

interface ApiMessage {
  role: 'user' | 'assistant';
  content: string | ApiContentBlock[];
}

interface ApiResponse {
  id: string;
  type: string;
  role: 'assistant';
  content: ApiContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | string;
  usage?: { input_tokens: number; output_tokens: number };
  error?: { type: string; message: string };
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const ULTRON_TOOLS = [
  {
    name: 'search_memory',
    description: 'Search the knowledge graph for relevant nodes. Call this before answering complex questions or starting tasks to check what you already know.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', default: 5 },
      },
      required: ['query'],
    },
  },
  {
    name: 'upsert_memory',
    description: 'Add or update a node in the knowledge graph. Use for user preferences, project facts, lessons learned.',
    input_schema: {
      type: 'object' as const,
      properties: {
        label:      { type: 'string' },
        type:       { type: 'string', enum: ['preference', 'fact', 'lesson', 'feedback', 'project', 'person'] },
        content:    { type: 'string' },
        confidence: { type: 'number', default: 0.9 },
      },
      required: ['label', 'type', 'content'],
    },
  },
  {
    name: 'get_core_memory',
    description: 'Read the persistent core memory block — your long-term identity, user preferences, and key project context.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'update_core_memory',
    description: 'Update the persistent core memory block. Use sparingly — only for information that should persist forever.',
    input_schema: {
      type: 'object' as const,
      properties: { content: { type: 'string' } },
      required: ['content'],
    },
  },
  {
    name: 'list_episodes',
    description: 'List recent task history with outcomes. Use to check what was attempted before.',
    input_schema: {
      type: 'object' as const,
      properties: { limit: { type: 'number', default: 10 } },
    },
  },
  {
    name: 'dispatch_task',
    description: 'Dispatch a task to a specific CLI agent. Use for coding, research, debugging, or any work requiring an agent.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          enum: [
            'opencode', 'codex', 'vibe', 'agy', 'grok', 'cline', 'kilo', 'cursor',
            'hermes', 'deepseek', 'harness', 'kimocode', 'pi', 'researcher', 'debugger', 'jules',
          ],
        },
        prompt:   { type: 'string' },
        priority: { type: 'number', default: 5 },
      },
      required: ['agent_id', 'prompt'],
    },
  },
  {
    name: 'dispatch_pipeline',
    description: 'Dispatch a multi-agent pipeline. Steps run sequentially. Use for complex work: research→code→review.',
    input_schema: {
      type: 'object' as const,
      properties: {
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              agent_id: {
                type: 'string',
                enum: [
                  'opencode', 'codex', 'vibe', 'agy', 'grok', 'cline', 'kilo', 'cursor',
                  'hermes', 'deepseek', 'harness', 'kimocode', 'pi', 'researcher', 'debugger', 'jules',
                ],
              },
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
    description: 'Get the current task queue status — running, pending, failed counts.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_agent_status',
    description: 'Get which CLI agents are idle or running.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_provider_health',
    description: 'Get the health and latency of all configured LLM providers.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'schedule_cron',
    description: 'Schedule a recurring task. Use standard 5-field cron syntax.',
    input_schema: {
      type: 'object' as const,
      properties: {
        cron:     { type: 'string', description: "5-field cron: '0 9 * * *' = daily 9am" },
        agent_id: { type: 'string' },
        prompt:   { type: 'string' },
      },
      required: ['cron', 'agent_id', 'prompt'],
    },
  },
  {
    name: 'update_routing_rule',
    description: 'Add or update a routing rule that determines how requests are directed to providers.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name:            { type: 'string' },
        condition:       { type: 'string', description: "e.g. 'task_type=research' or 'token_count>4000'" },
        target_provider: { type: 'string' },
        priority:        { type: 'number' },
      },
      required: ['name', 'condition', 'target_provider'],
    },
  },
  {
    name: 'record_feedback',
    description: 'Record feedback on a task outcome. Helps Ultron learn what works.',
    input_schema: {
      type: 'object' as const,
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
    input_schema: {
      type: 'object' as const,
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
    },
  },
  {
    name: 'retry_task',
    description: 'Retry a failed task by ID.',
    input_schema: {
      type: 'object' as const,
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
    },
  },
  {
    name: 'run_skill',
    description: 'Run a saved skill by name. Skills are reusable prompt templates that can dispatch tasks.',
    input_schema: {
      type: 'object' as const,
      properties: {
        skill_name: { type: 'string', description: 'Name of the skill to run' },
        input: { type: 'string', description: 'Input parameter for the skill template' },
      },
      required: ['skill_name'],
    },
  },
  {
    name: 'list_skills',
    description: 'List all available skills with their descriptions.',
    input_schema: { type: 'object' as const, properties: {} },
  },
];

// ─── Tool executor ─────────────────────────────────────────────────────────────

const BASE = 'http://localhost:8080';

async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  try {
    if (name.startsWith('mcp__')) {
      const parts = name.split('__');
      const serverName = parts[1];
      const toolName = parts.slice(2).join('__');
      const r = await fetch(`${BASE}/api/mcp/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server: serverName, tool: toolName, input }),
      });
      return JSON.stringify(await r.json());
    }

    switch (name) {
      case 'run_skill': {
        const skillName = (input['skill_name'] as string) ?? '';
        const r = await fetch(`${BASE}/api/skills`);
        const skillsList = await r.json();
        const skill = Array.isArray(skillsList)
          ? skillsList.find((s: { name: string; id: string }) => s.name === skillName)
          : null;
        if (!skill) {
          return JSON.stringify({ error: `skill not found: ${skillName}` });
        }
        const runRes = await fetch(`${BASE}/api/skills/${skill.id}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: (input['input'] as string) || '' }),
        });
        return JSON.stringify(await runRes.json());
      }
      case 'list_skills': {
        const r = await fetch(`${BASE}/api/skills`);
        return JSON.stringify(await r.json());
      }
      case 'search_memory': {
        const r = await fetch(`${BASE}/api/memory/search?q=${encodeURIComponent(input['query'] as string)}&limit=${input['limit'] ?? 5}`);
        return JSON.stringify(await r.json());
      }
      case 'upsert_memory': {
        const r = await fetch(`${BASE}/api/memory/upsert`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        return JSON.stringify(await r.json());
      }
      case 'get_core_memory': {
        const r = await fetch(`${BASE}/api/memory/core`);
        return JSON.stringify(await r.json());
      }
      case 'update_core_memory': {
        const r = await fetch(`${BASE}/api/memory/core`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        return JSON.stringify(await r.json());
      }
      case 'list_episodes': {
        const r = await fetch(`${BASE}/api/memory/episodes?limit=${input['limit'] ?? 10}`);
        return JSON.stringify(await r.json());
      }
      case 'dispatch_task': {
        const r = await fetch(`${BASE}/api/tasks/enqueue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId:  input['agent_id'],
            prompt:   input['prompt'],
            priority: input['priority'] ?? 5,
          }),
        });
        return JSON.stringify(await r.json());
      }
      case 'dispatch_pipeline': {
        const steps = input['steps'] as Array<{ agent_id: string; prompt: string }>;
        const results = [];
        for (const s of steps) {
          const r = await fetch(`${BASE}/api/tasks/enqueue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId: s.agent_id, prompt: s.prompt }),
          });
          results.push(await r.json());
        }
        return JSON.stringify(results);
      }
      case 'get_queue_status': {
        const r = await fetch(`${BASE}/api/tasks`);
        return JSON.stringify(await r.json());
      }
      case 'get_agent_status': {
        const r = await fetch(`${BASE}/api/agents/status`);
        return JSON.stringify(await r.json());
      }
      case 'get_provider_health': {
        const r = await fetch(`${BASE}/health`);
        return JSON.stringify(await r.json());
      }
      case 'schedule_cron': {
        const r = await fetch(`${BASE}/api/cron/schedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        return JSON.stringify(await r.json());
      }
      case 'update_routing_rule': {
        const r = await fetch(`${BASE}/api/routing/rules`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        return JSON.stringify(await r.json());
      }
      case 'record_feedback': {
        const r = await fetch(`${BASE}/api/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        return JSON.stringify(await r.json());
      }
      case 'cancel_task': {
        const r = await fetch(`${BASE}/api/tasks/${input['task_id'] as string}/cancel`, { method: 'POST' });
        return JSON.stringify(await r.json());
      }
      case 'retry_task': {
        const r = await fetch(`${BASE}/api/tasks/${input['task_id'] as string}/retry`, { method: 'POST' });
        return JSON.stringify(await r.json());
      }
      default:
        return JSON.stringify({ error: `unknown tool: ${name}` });
    }
  } catch (e) {
    return JSON.stringify({ error: String(e), note: 'backend may not be running or endpoint not wired yet' });
  }
}

// ─── ID generator ─────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseOrchestatorChatReturn {
  messages: ChatMessage[];
  sessions: ChatSession[];
  activeSessionId: string | null;
  isLoading: boolean;
  sendMessage: (text: string, attachments?: FileAttachment[]) => Promise<void>;
  startNewSession: () => void;
  selectSession: (id: string) => void;
  deleteSession: (id: string) => void;
  renameSession: (id: string, newTitle: string) => void;
  stopGeneration: () => void;
  regenerate: (messageId?: string) => Promise<void>;
  recordFeedback: (messageId: string, rating: 'up' | 'down') => Promise<void>;
}

export function useOrchestatorChat(): UseOrchestatorChatReturn {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messagesBySession, setMessagesBySession] = useState<Record<string, ChatMessage[]>>({});
  const [isLoading, setIsLoading] = useState(false);

  // Per-session Anthropic API conversation history
  const conversationsBySession = useRef<Record<string, ApiMessage[]>>({});
  // Task IDs dispatched from this chat so we can listen for WS updates
  const dispatchedTaskIds = useRef<Set<string>>(new Set());
  // AbortController for stopping generation
  const abortControllerRef = useRef<AbortController | null>(null);

  // Active messages derived from current session
  const messages = activeSessionId ? messagesBySession[activeSessionId] || [] : [];

  // ── Subscribe to store tasks for dispatched task updates ──
  const storeTasks = useSwarmStore((s) => s.tasks);

  useEffect(() => {
    if (dispatchedTaskIds.current.size === 0) return;
    setMessagesBySession((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [sessId, sessMsgs] of Object.entries(next)) {
        const updatedMsgs: ChatMessage[] = sessMsgs.map((m: ChatMessage): ChatMessage => {
          if (m.role !== 'task_card' || !m.taskId) return m;
          const live = storeTasks.find((t) => t.id === m.taskId);
          if (!live) return m;
          const newStatus: 'done' | 'error' | 'streaming' =
            live.status === 'completed' ? 'done' : live.status === 'failed' ? 'error' : 'streaming';
          if (m.status !== newStatus) {
            changed = true;
            const content =
              live.status === 'completed'
                ? m.content.replace(/^ULTRON dispatched →/, 'ULTRON completed →')
                : live.status === 'failed'
                  ? m.content.replace(/^ULTRON dispatched →/, 'ULTRON failed →')
                  : m.content;
            return { ...m, content, status: newStatus };
          }
          return m;
        });
        if (changed) next[sessId] = updatedMsgs;
      }
      return changed ? next : prev;
    });
  }, [storeTasks]);

  // ── Session management ──
  const startNewSession = useCallback(() => {
    const id = uid();
    const session: ChatSession = {
      id,
      title: 'New conversation',
      agentId: 'ultron',
      status: 'idle',
      lastMessage: '',
      updatedAt: Date.now(),
    };
    setSessions((prev) => [session, ...prev]);
    setActiveSessionId(id);
    setMessagesBySession((prev) => ({ ...prev, [id]: [] }));
    conversationsBySession.current[id] = [];
  }, []);

  // ── Initialize first session on mount ──
  useEffect(() => {
    startNewSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectSession = useCallback((id: string) => {
    setActiveSessionId(id);
  }, []);

  const deleteSession = useCallback((id: string) => {
    setSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== id);
      if (remaining.length === 0) {
        setTimeout(() => startNewSession(), 0);
      }
      return remaining;
    });
    setMessagesBySession((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    delete conversationsBySession.current[id];
    setActiveSessionId((curr) => {
      if (curr === id) {
        const remaining = sessions.filter((s) => s.id !== id);
        return remaining[0]?.id || null;
      }
      return curr;
    });
  }, [sessions, startNewSession]);

  const renameSession = useCallback((id: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, title: trimmed, updatedAt: Date.now() } : s)),
    );
  }, []);

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
  }, []);

  const recordFeedback = useCallback(
    async (messageId: string, rating: 'up' | 'down') => {
      if (!activeSessionId) return;
      // Toggle if already set
      setMessagesBySession((prev) => {
        const currentMsgs = prev[activeSessionId] || [];
        return {
          ...prev,
          [activeSessionId]: currentMsgs.map((m) =>
            m.id === messageId ? { ...m, feedback: m.feedback === rating ? undefined : rating } : m,
          ),
        };
      });

      try {
        await fetch(`${BASE}/api/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task_id: '',
            outcome: rating === 'up' ? 'success' : 'failure',
            notes: `message:${messageId} session:${activeSessionId}`,
            agent_id: '',
          }),
        });
      } catch {
        // Backend endpoint may not be active; UI feedback is preserved
      }
    },
    [activeSessionId],
  );

  // ── Main agentic loop ──
  const sendMessage = useCallback(
    async (text: string, attachments?: FileAttachment[]) => {
      const currentSessionId = activeSessionId;
      if (!currentSessionId) return;

      const trimmedText = text.trim();
      const hasAttachments = Boolean(attachments && attachments.length > 0);
      if ((!trimmedText && !hasAttachments) || isLoading) return;

      // Abort any existing generation
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // Format context about attached files
      let promptForLLM = trimmedText;
      if (hasAttachments && attachments) {
        const attachmentContext = attachments
          .map((a) => `[Attached ${a.category}: ${a.name} (${a.url})]`)
          .join('\n');
        promptForLLM = trimmedText ? `${trimmedText}\n\n${attachmentContext}` : attachmentContext;
      }

      // 1. Add user message
      const userMsgId = uid();
      const userMsg: ChatMessage = {
        id:          userMsgId,
        key:         userMsgId,
        role:        'user',
        content:     trimmedText,
        attachments: hasAttachments ? attachments : undefined,
        timestamp:   Date.now(),
        status:      'done',
      };

      setMessagesBySession((prev) => ({
        ...prev,
        [currentSessionId]: [...(prev[currentSessionId] || []), userMsg],
      }));

      // 2. Add to conversation history
      if (!conversationsBySession.current[currentSessionId]) {
        conversationsBySession.current[currentSessionId] = [];
      }
      conversationsBySession.current[currentSessionId].push({
        role: 'user',
        content: promptForLLM,
      });

      // Auto-title session from first user message
      const titleCandidate =
        trimmedText || (hasAttachments && attachments ? attachments[0].name : 'New conversation');
      setSessions((prev) =>
        prev.map((s) =>
          s.id === currentSessionId && (s.title === 'New conversation' || !s.title)
            ? { ...s, title: titleCandidate.slice(0, 45) + (titleCandidate.length > 45 ? '…' : ''), updatedAt: Date.now() }
            : s,
        ),
      );

      setIsLoading(true);

      try {
        // Fetch active MCP tools
        const activeTools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }> = [
          ...ULTRON_TOOLS,
        ];
        try {
          const mcpRes = await fetch(`${BASE}/api/mcp/servers`, { signal: abortController.signal });
          if (mcpRes.ok) {
            const servers = await mcpRes.json();
            if (Array.isArray(servers)) {
              for (const server of servers) {
                let tools = server.tools;
                if (!tools && (server.tool_count ?? 0) > 0) {
                  try {
                    const tr = await fetch(`${BASE}/api/mcp/servers/${encodeURIComponent(server.name)}/tools`, {
                      signal: abortController.signal,
                    });
                    if (tr.ok) tools = await tr.json();
                  } catch {
                    // ignore tool fetch errors
                  }
                }
                if (Array.isArray(tools)) {
                  for (const tool of tools) {
                    activeTools.push({
                      name: `mcp__${server.name}__${tool.name}`,
                      description: tool.description || `MCP tool ${tool.name} from server ${server.name}`,
                      input_schema: tool.input_schema || { type: 'object', properties: {} },
                    });
                  }
                }
              }
            }
          }
        } catch {
          // Gracefully continue with standard ULTRON_TOOLS
        }

        let continueLoop = true;
        const MAX_TURNS = 10;
        let turns = 0;

        while (continueLoop && turns < MAX_TURNS) {
          if (abortController.signal.aborted) break;
          turns++;

          const dynamicPrompt = buildUltronSystemPrompt({
            date: new Date().toISOString().split('T')[0],
            activeToolsCount: activeTools.length,
          });

          const payload = {
            model:      'us.anthropic.claude-sonnet-4-6',
            max_tokens: 4096,
            system:     dynamicPrompt,
            tools:      activeTools,
            messages:   conversationsBySession.current[currentSessionId],
          };

          const callStartMs = Date.now();
          let response: ApiResponse;
          try {
            const res = await fetch(`${BASE}/v1/messages`, {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify(payload),
              signal:  abortController.signal,
            });
            if (!res.ok) {
              const errText = await res.text();
              throw new Error(`HTTP ${res.status}: ${errText}`);
            }
            response = (await res.json()) as ApiResponse;
          } catch (fetchErr: unknown) {
            if (abortController.signal.aborted) break;
            const errMsgId = uid();
            const errMsg: ChatMessage = {
              id:        errMsgId,
              key:       errMsgId,
              role:      'assistant',
              content:   `Connection error: ${String(fetchErr)}. Is the backend running on :8080?`,
              timestamp: Date.now(),
              status:    'error',
            };
            setMessagesBySession((prev) => ({
              ...prev,
              [currentSessionId]: [...(prev[currentSessionId] || []), errMsg],
            }));
            break;
          }

          const latencyMs = Date.now() - callStartMs;

          // 4. Add assistant turn to conversation history
          conversationsBySession.current[currentSessionId].push({
            role: 'assistant',
            content: response.content,
          });

          // 5. Extract text blocks
          const textBlocks = response.content.filter((b): b is ApiTextBlock => b.type === 'text');
          if (textBlocks.length > 0) {
            const combinedText = textBlocks.map((b) => b.text).join('\n\n');
            const assistantMsgId = uid();
            const assistantMsg: ChatMessage = {
              id:        assistantMsgId,
              key:       assistantMsgId,
              role:      'assistant',
              content:   combinedText,
              timestamp: Date.now(),
              status:    'done',
              usage:     response.usage,
              latencyMs,
              model:     'claude-sonnet-4-6',
            };
            setMessagesBySession((prev) => ({
              ...prev,
              [currentSessionId]: [...(prev[currentSessionId] || []), assistantMsg],
            }));

            // Update session title & preview
            setSessions((prev) =>
              prev.map((s) =>
                s.id === currentSessionId
                  ? { ...s, lastMessage: combinedText.slice(0, 80), updatedAt: Date.now(), status: 'idle' }
                  : s,
              ),
            );
          }

          // 6. Handle tool use
          if (response.stop_reason === 'tool_use') {
            const toolUseBlocks = response.content.filter((b): b is ApiToolUse => b.type === 'tool_use');
            const toolResultBlocks: ApiToolResult[] = [];

            for (const toolBlock of toolUseBlocks) {
              if (abortController.signal.aborted) break;
              const startMs = Date.now();

              // Show tool call card
              const toolCallMsgId = uid();
              const toolCallMsg: ChatMessage = {
                id:        toolCallMsgId,
                key:       toolCallMsgId,
                role:      'tool_call',
                content:   `Executing ${toolBlock.name}`,
                toolUse:   { id: toolBlock.id, name: toolBlock.name, input: toolBlock.input },
                timestamp: Date.now(),
                status:    'streaming',
              };

              setMessagesBySession((prev) => ({
                ...prev,
                [currentSessionId]: [...(prev[currentSessionId] || []), toolCallMsg],
              }));

              // Execute tool
              const result = await executeTool(toolBlock.name, toolBlock.input);
              const durationMs = Date.now() - startMs;

              // Update tool call card
              setMessagesBySession((prev) => ({
                ...prev,
                [currentSessionId]: (prev[currentSessionId] || []).map((m) =>
                  m.id === toolCallMsg.id
                    ? { ...m, toolResult: result, toolDurationMs: durationMs, status: 'done' }
                    : m,
                ),
              }));

              // Check if task ID returned
              if (
                toolBlock.name === 'dispatch_task' ||
                toolBlock.name === 'dispatch_pipeline' ||
                toolBlock.name === 'run_skill'
              ) {
                try {
                  const parsed = JSON.parse(result) as unknown;
                  const extractIds = (obj: unknown): void => {
                    if (Array.isArray(obj)) {
                      obj.forEach(extractIds);
                    } else if (obj && typeof obj === 'object') {
                      const rec = obj as Record<string, unknown>;
                      const idVal = rec['id'] ?? rec['task_id'];
                      if (typeof idVal === 'string') {
                        const taskId = idVal;
                        dispatchedTaskIds.current.add(taskId);
                        const agentIdVal =
                          (toolBlock.input['agent_id'] as string) ??
                          (toolBlock.name === 'run_skill'
                            ? (toolBlock.input['skill_name'] as string)
                            : 'unknown');
                        const promptVal =
                          (toolBlock.input['prompt'] as string) ??
                          (toolBlock.input['input'] as string) ??
                          '';
                        const taskCardId = uid();
                        const taskCard: ChatMessage = {
                          id:        taskCardId,
                          key:       taskCardId,
                          role:      'task_card',
                          content:   `ULTRON dispatched → ${agentIdVal}: ${promptVal.slice(0, 60)}${promptVal.length > 60 ? '…' : ''}`,
                          agentId:   agentIdVal,
                          taskId,
                          timestamp: Date.now(),
                          status:    'streaming',
                        };
                        setMessagesBySession((prev) => ({
                          ...prev,
                          [currentSessionId]: [...(prev[currentSessionId] || []), taskCard],
                        }));
                      }
                    }
                  };
                  extractIds(parsed);
                } catch {
                  // ignore parse error
                }
              }

              toolResultBlocks.push({
                type:        'tool_result',
                tool_use_id: toolBlock.id,
                content:     result,
              });
            }

            // Append tool results to history
            conversationsBySession.current[currentSessionId].push({
              role: 'user',
              content: toolResultBlocks,
            });
          } else {
            continueLoop = false;
          }
        }
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [activeSessionId, isLoading],
  );

  const regenerate = useCallback(
    async (messageId?: string) => {
      if (!activeSessionId || isLoading) return;
      const currentMsgs = messagesBySession[activeSessionId] || [];
      // Find the last user message
      let targetUserMsg: ChatMessage | null = null;
      if (messageId) {
        const targetIndex = currentMsgs.findIndex((m) => m.id === messageId);
        if (targetIndex !== -1) {
          for (let i = targetIndex - 1; i >= 0; i--) {
            if (currentMsgs[i].role === 'user') {
              targetUserMsg = currentMsgs[i];
              break;
            }
          }
        }
      }
      if (!targetUserMsg) {
        for (let i = currentMsgs.length - 1; i >= 0; i--) {
          if (currentMsgs[i].role === 'user') {
            targetUserMsg = currentMsgs[i];
            break;
          }
        }
      }

      if (targetUserMsg) {
        await sendMessage(targetUserMsg.content, targetUserMsg.attachments);
      }
    },
    [activeSessionId, isLoading, messagesBySession, sendMessage],
  );

  return {
    messages,
    sessions,
    activeSessionId,
    isLoading,
    sendMessage,
    startNewSession,
    selectSession,
    deleteSession,
    renameSession,
    stopGeneration,
    regenerate,
    recordFeedback,
  };
}
