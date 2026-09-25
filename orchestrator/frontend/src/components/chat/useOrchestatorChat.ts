/**
 * useOrchestatorChat — Ultron's agentic chat hook.
 *
 * Manages conversation state, runs the full Anthropic tool-use loop via the
 * local proxy at http://localhost:8080/v1/messages, and surfaces WS task
 * events from the shared Zustand store as inline task cards.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useSwarmStore } from '../../store/useSwarmStore';
import { ULTRON_SYSTEM_PROMPT } from './ultronPrompt';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ToolUseBlock {
  id: string;
  name: string;
  input: Record<string, unknown>;
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
          enum: ['opencode', 'codex', 'vibe', 'agy', 'grok', 'cline', 'kilo', 'cursor', 'researcher', 'debugger', 'jules'],
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
];

// ─── Tool executor ─────────────────────────────────────────────────────────────

const BASE = 'http://localhost:8080';

async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
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
        const results = await Promise.all(
          steps.map((s) =>
            fetch(`${BASE}/api/tasks/enqueue`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ agentId: s.agent_id, prompt: s.prompt }),
            }).then((r) => r.json()),
          ),
        );
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
  selectedAgentId: string;
  setSelectedAgentId: (id: string) => void;
  sendMessage: (text: string) => Promise<void>;
  startNewSession: () => void;
  selectSession: (id: string) => void;
}

export function useOrchestatorChat(): UseOrchestatorChatReturn {
  const [messages, setMessages]             = useState<ChatMessage[]>([]);
  const [sessions, setSessions]             = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading]           = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState('opencode');

  // Anthropic API conversation history — mutated in-place inside sendMessage
  const conversationRef = useRef<ApiMessage[]>([]);

  // Task IDs dispatched from this chat so we can listen for WS updates
  const dispatchedTaskIds = useRef<Set<string>>(new Set());

  // ── Subscribe to store tasks for dispatched task updates ──
  const storeTasks = useSwarmStore((s) => s.tasks);

  useEffect(() => {
    if (dispatchedTaskIds.current.size === 0) return;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.role !== 'task_card' || !m.taskId) return m;
        const live = storeTasks.find((t) => t.id === m.taskId);
        if (!live) return m;
        const content =
          live.status === 'completed'
            ? `Task #${m.taskId} completed`
            : live.status === 'failed'
              ? `Task #${m.taskId} failed`
              : m.content;
        return { ...m, content, status: live.status === 'completed' ? 'done' : live.status === 'failed' ? 'error' : 'streaming' };
      }),
    );
  }, [storeTasks]);

  // ── Initialize first session on mount ──
  useEffect(() => {
    startNewSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Session management ──
  const startNewSession = useCallback(() => {
    const id = uid();
    const session: ChatSession = {
      id,
      title: `Session ${new Date().toLocaleTimeString()}`,
      agentId: 'opencode',
      status: 'idle',
      lastMessage: '',
      updatedAt: Date.now(),
    };
    setSessions((prev) => [session, ...prev]);
    setActiveSessionId(id);
    setMessages([]);
    conversationRef.current = [];
    dispatchedTaskIds.current = new Set();
  }, []);

  const selectSession = useCallback((id: string) => {
    // For now sessions are in-memory only; selecting switches context
    setActiveSessionId(id);
  }, []);

  // ── Main agentic loop ──
  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      // 1. Add user message to display
      const userMsgId = uid();
      const userMsg: ChatMessage = {
        id:        userMsgId,
        key:       userMsgId,
        role:      'user',
        content:   text.trim(),
        timestamp: Date.now(),
        status:    'done',
      };
      setMessages((prev) => [...prev, userMsg]);

      // 2. Add to conversation history
      conversationRef.current = [
        ...conversationRef.current,
        { role: 'user', content: text.trim() },
      ];

      setIsLoading(true);

      try {
        let continueLoop = true;
        const MAX_TURNS = 10; // prevent runaway loops
        let turns = 0;

        while (continueLoop && turns < MAX_TURNS) {
          turns++;

          // 3. POST to proxy
          const payload = {
            model:      'us.anthropic.claude-sonnet-4-6',
            max_tokens: 4096,
            system:     ULTRON_SYSTEM_PROMPT,
            tools:      ULTRON_TOOLS,
            messages:   conversationRef.current,
          };

          let response: ApiResponse;
          try {
            const res = await fetch(`${BASE}/v1/messages`, {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify(payload),
            });
            if (!res.ok) {
              const errText = await res.text();
              throw new Error(`HTTP ${res.status}: ${errText}`);
            }
            response = (await res.json()) as ApiResponse;
          } catch (fetchErr) {
            const errMsgId = uid();
            const errMsg: ChatMessage = {
              id:        errMsgId,
              key:       errMsgId,
              role:      'assistant',
              content:   `Connection error: ${String(fetchErr)}. Is the backend running on :8080?`,
              timestamp: Date.now(),
              status:    'error',
            };
            setMessages((prev) => [...prev, errMsg]);
            break;
          }

          // 4. Add assistant turn to conversation history
          conversationRef.current = [
            ...conversationRef.current,
            { role: 'assistant', content: response.content },
          ];

          // 5. Extract and display text blocks
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
            };
            setMessages((prev) => [...prev, assistantMsg]);

            // Update session title from first assistant message
            setSessions((prev) =>
              prev.map((s) =>
                s.id === activeSessionId
                  ? { ...s, lastMessage: combinedText.slice(0, 80), updatedAt: Date.now(), status: 'idle' }
                  : s,
              ),
            );
          }

          // 6. If stop_reason is tool_use — execute all tools and loop
          if (response.stop_reason === 'tool_use') {
            const toolUseBlocks = response.content.filter((b): b is ApiToolUse => b.type === 'tool_use');
            const toolResultBlocks: ApiToolResult[] = [];

            for (const toolBlock of toolUseBlocks) {
              const startMs = Date.now();

              // Show tool call card
              const toolCallMsgId = uid();
              const toolCallMsg: ChatMessage = {
                id:        toolCallMsgId,
                key:       toolCallMsgId,
                role:      'tool_call',
                content:   `Calling ${toolBlock.name}`,
                toolUse:   { id: toolBlock.id, name: toolBlock.name, input: toolBlock.input },
                timestamp: Date.now(),
                status:    'streaming',
              };
              setMessages((prev) => [...prev, toolCallMsg]);

              // Execute tool
              const result = await executeTool(toolBlock.name, toolBlock.input);
              const durationMs = Date.now() - startMs;

              // Update tool call card with result + duration
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === toolCallMsg.id
                    ? { ...m, toolResult: result, toolDurationMs: durationMs, status: 'done' }
                    : m,
                ),
              );

              // Check if dispatch_task returned a task ID — register for WS tracking
              if (toolBlock.name === 'dispatch_task' || toolBlock.name === 'dispatch_pipeline') {
                try {
                  const parsed = JSON.parse(result) as unknown;
                  const extractIds = (obj: unknown): void => {
                    if (Array.isArray(obj)) {
                      obj.forEach(extractIds);
                    } else if (obj && typeof obj === 'object') {
                      const rec = obj as Record<string, unknown>;
                      if (typeof rec['id'] === 'string') {
                        const taskId = rec['id'] as string;
                        dispatchedTaskIds.current.add(taskId);
                        // Add inline task card
                        const agentIdVal = (toolBlock.input['agent_id'] as string) ?? 'unknown';
                        const promptVal  = (toolBlock.input['prompt'] as string) ?? '';
                        const taskCardId = uid();
                        const taskCard: ChatMessage = {
                          id:        taskCardId,
                          key:       taskCardId,
                          role:      'task_card',
                          content:   `Dispatched task #${taskId} to ${agentIdVal}: ${promptVal.slice(0, 60)}${promptVal.length > 60 ? '…' : ''}`,
                          agentId:   agentIdVal,
                          taskId,
                          timestamp: Date.now(),
                          status:    'streaming',
                        };
                        setMessages((prev) => [...prev, taskCard]);
                      }
                    }
                  };
                  extractIds(parsed);
                } catch {
                  // ignore parse errors
                }
              }

              toolResultBlocks.push({
                type:        'tool_result',
                tool_use_id: toolBlock.id,
                content:     result,
              });
            }

            // Add tool results to conversation and loop
            conversationRef.current = [
              ...conversationRef.current,
              { role: 'user', content: toolResultBlocks },
            ];
            // continue loop
          } else {
            // end_turn or max_tokens — stop
            continueLoop = false;
          }
        }
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, activeSessionId],
  );

  return {
    messages,
    sessions,
    activeSessionId,
    isLoading,
    selectedAgentId,
    setSelectedAgentId,
    sendMessage,
    startNewSession,
    selectSession,
  };
}
