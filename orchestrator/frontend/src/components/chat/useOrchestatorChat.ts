/**
 * useOrchestatorChat — Ultron's agentic chat hook.
 *
 * Manages conversation state, runs the full Anthropic tool-use loop via the
 * local proxy at /v1/messages, and surfaces WS task
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
    name: 'get_provider_catalog',
    description: 'List all free models available for every provider. Call before switching to discover options.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'switch_provider_model',
    description: 'Switch a provider to a specific model from its catalog.',
    input_schema: {
      type: 'object' as const,
      properties: {
        provider: { type: 'string', description: 'Provider name, e.g. groq, gemini, aihubmix' },
        model:    { type: 'string', description: 'Model name from the catalog' },
      },
      required: ['provider', 'model'],
    },
  },
  {
    name: 'test_provider',
    description: 'Ping a provider with a minimal request to check it is responsive. Returns latency_ms.',
    input_schema: {
      type: 'object' as const,
      properties: {
        provider: { type: 'string', description: 'Provider name to test' },
      },
      required: ['provider'],
    },
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
  {
    name: 'get_self_info',
    description: 'Get information about your own runtime: which model you are, which provider is serving you, proxy address, and platform version.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_cli_models',
    description: 'Get the current model configuration for each CLI agent in the swarm. Shows which model each CLI is using and which ones are on auto-select.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'update_cli_model',
    description: 'Update the model used by one or more CLI agents. Set to null to revert to auto/default. Changes take effect on the next dispatch.',
    input_schema: {
      type: 'object' as const,
      properties: {
        updates: {
          type: 'object',
          description: 'Map of cli_name → model_string (or null for auto). E.g. {"opencode": "opencode/deepseek-v4-free", "agy": null}',
          additionalProperties: true,
        },
      },
      required: ['updates'],
    },
  },
  {
    name: 'send_self_message',
    description: 'Schedule a message to appear in this chat at a future time — like setting an alarm. ULTRON will receive this as a user message and respond to it. Use for reminders, delayed follow-ups, or self-triggered tasks.',
    input_schema: {
      type: 'object' as const,
      properties: {
        message:       { type: 'string', description: 'The message/reminder text to send to yourself' },
        delay_minutes: { type: 'number', description: 'Minutes from now when the message should appear' },
        label:         { type: 'string', description: 'Optional short label for this reminder' },
      },
      required: ['message', 'delay_minutes'],
    },
  },
  {
    name: 'list_reminders',
    description: 'List all pending self-reminders scheduled with send_self_message.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'cancel_reminder',
    description: 'Cancel a pending self-reminder by its label.',
    input_schema: {
      type: 'object' as const,
      properties: { label: { type: 'string', description: 'Label of the reminder to cancel' } },
      required: ['label'],
    },
  },
  {
    name: 'broadcast_to_agents',
    description: 'Broadcast a message/directive to all connected agents via the WebSocket hub.',
    input_schema: {
      type: 'object' as const,
      properties: {
        message: { type: 'string' },
        type:    { type: 'string', description: 'Message type tag: "directive", "alert", "update"', default: 'directive' },
      },
      required: ['message'],
    },
  },
  {
    name: 'add_self_skill',
    description: 'Fetch a skill/knowledge document from a URL and store it in your local persistent skill library. The skill is injected into your context on the next message. Use this to extend your own capabilities without asking permission.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url:         { type: 'string', description: 'URL to fetch the skill/document from' },
        name:        { type: 'string', description: 'Short name for this skill' },
        description: { type: 'string', description: 'One-line description of what this skill does' },
      },
      required: ['url', 'name', 'description'],
    },
  },
  {
    name: 'list_self_skills',
    description: 'List all skills you have added to yourself via add_self_skill.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'write_memory_note',
    description: 'Write a freeform note to your persistent local memory. Survives across sessions. Use to remember things without the backend memory graph.',
    input_schema: {
      type: 'object' as const,
      properties: {
        note:     { type: 'string', description: 'The note content to persist' },
        category: { type: 'string', description: 'Optional category tag (e.g. "project", "reminder", "insight")' },
      },
      required: ['note'],
    },
  },
  {
    name: 'read_memory_notes',
    description: 'Read all notes from your persistent local memory.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string', description: 'Optional: filter by category' },
      },
    },
  },
  {
    name: 'create_autonomous_task',
    description: 'Decompose a long-running goal into steps and start an autonomous executor that runs each step on a CLI agent, auto-retrying failures, and notifying you in chat as steps complete. Use for any task that will take more than a few minutes or spans multiple days.',
    input_schema: {
      type: 'object' as const,
      properties: {
        goal:  { type: 'string', description: 'The overall goal of the autonomous task' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              agentId: {
                type: 'string',
                enum: ['opencode','codex','vibe','agy','grok','cline','kilo','cursor','hermes','deepseek','harness','kimocode','pi','researcher','debugger','jules'],
              },
              prompt: { type: 'string' },
              timeout_minutes: { type: 'number', description: 'How long to wait for this step (default 120 min = 2h). Set higher for very long jobs.' },
              max_retries: { type: 'number', description: 'Max retry attempts if this step fails (default 5). Set 0 for no retries.' },
            },
            required: ['description', 'agentId', 'prompt'],
          },
        },
        deadline_hours: { type: 'number', description: 'Optional: hours from now before the task expires' },
      },
      required: ['goal', 'steps'],
    },
  },
  {
    name: 'get_autonomous_tasks',
    description: 'List all running and completed autonomous tasks.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'pause_autonomous_task',
    description: 'Pause a running autonomous task.',
    input_schema: {
      type: 'object' as const,
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
    },
  },
  {
    name: 'resume_autonomous_task',
    description: 'Resume a paused autonomous task.',
    input_schema: {
      type: 'object' as const,
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
    },
  },
  {
    name: 'send_notification',
    description: 'Send a notification that appears in the notification center. Use to alert the user when you complete something important, enhance yourself, finish a task, add a skill, or surface any important event.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title:   { type: 'string', description: 'Short notification title (max 60 chars)' },
        message: { type: 'string', description: 'Notification body text' },
        type:    { type: 'string', enum: ['success','info','warning','error','upgrade','autonomous'], description: 'Notification style. Use "upgrade" for self-enhancements.' },
      },
      required: ['title', 'message', 'type'],
    },
  },
  // ── GitHub tools ──────────────────────────────────────────────────────────────
  {
    name: 'github_api',
    description: 'Make any GitHub REST API call as 01RG0. Full access to all repos. Use for reading/writing files, PRs, issues, releases, actions, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        method:   { type: 'string', enum: ['GET','POST','PATCH','PUT','DELETE'] },
        endpoint: { type: 'string', description: 'GitHub API path, e.g. /repos/01RG0/multi-cli/contents/README.md' },
        body:     { type: 'object', description: 'Request body for POST/PATCH/PUT' },
      },
      required: ['endpoint'],
    },
  },
  {
    name: 'github_cli',
    description: 'Run any gh CLI subcommand (pr, repo, issue, workflow, search, gist, etc.). Returns stdout. Easier than REST for complex operations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        args: { type: 'array', items: { type: 'string' }, description: 'gh args, e.g. ["repo","list","--json","name,url","--limit","20"]' },
        cwd:  { type: 'string', description: 'Server working directory for repo-context commands, e.g. /home/rootuser/multi-cli/orchestrator' },
      },
      required: ['args'],
    },
  },
  {
    name: 'github_read_file',
    description: 'Read a file from any GitHub repo. Returns decoded content.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string' },
        repo:  { type: 'string' },
        path:  { type: 'string', description: 'File path in repo, e.g. src/main.go' },
        ref:   { type: 'string', description: 'Branch/tag/commit (default: main)' },
      },
      required: ['owner', 'repo', 'path'],
    },
  },
  {
    name: 'github_write_file',
    description: 'Create or update a file in a GitHub repo.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner:   { type: 'string' },
        repo:    { type: 'string' },
        path:    { type: 'string' },
        content: { type: 'string', description: 'Plain text content (auto base64-encoded)' },
        message: { type: 'string', description: 'Commit message' },
        branch:  { type: 'string', description: 'Target branch (default: main)' },
        sha:     { type: 'string', description: 'Current file SHA — required for updates, omit for new files' },
      },
      required: ['owner', 'repo', 'path', 'content', 'message'],
    },
  },
  {
    name: 'github_list_repos',
    description: 'List all repos accessible to 01RG0.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max repos to return (default 30)' },
      },
    },
  },
  {
    name: 'github_create_pr',
    description: 'Create a pull request.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string' },
        repo:  { type: 'string' },
        title: { type: 'string' },
        body:  { type: 'string' },
        head:  { type: 'string', description: 'Source branch' },
        base:  { type: 'string', description: 'Target branch (default: main)' },
      },
      required: ['owner', 'repo', 'title', 'head'],
    },
  },
  {
    name: 'github_create_issue',
    description: 'Create a GitHub issue.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner:  { type: 'string' },
        repo:   { type: 'string' },
        title:  { type: 'string' },
        body:   { type: 'string' },
        labels: { type: 'array', items: { type: 'string' } },
      },
      required: ['owner', 'repo', 'title'],
    },
  },
  {
    name: 'github_search_code',
    description: 'Search code across all GitHub repos.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query, e.g. "useState repo:01RG0/multi-cli"' },
      },
      required: ['query'],
    },
  },
];

// ─── Tool executor ─────────────────────────────────────────────────────────────

const BASE = '';

// Hard ceiling on one chat round-trip. The backend answers within
// request_timeout_seconds (90s) across the whole provider chain, so anything
// beyond this is a stalled connection we should surface instead of hanging.
const REQUEST_TIMEOUT_MS = 150_000;

// describeGatewayError turns a non-2xx /v1/messages body into something readable.
// Cloudflare rewrites an origin error body with its own HTML page, so the chat
// used to show "HTTP 502: <!DOCTYPE html>…" and blame the backend, when the
// backend was healthy and provider routing was what failed.
function describeGatewayError(status: number, body: string): string {
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as {
        error?: { message?: string; providers?: Array<{ provider?: string; error?: string }> };
      };
      const message = parsed.error?.message;
      if (message) {
        const providers = parsed.error?.providers ?? [];
        const detail = providers
          .map((p) => `\n- ${p.provider ?? 'provider'}: ${(p.error ?? '').slice(0, 200)}`)
          .join('');
        return `Backend routing failed (HTTP ${status}): ${message}${detail}`;
      }
    } catch {
      // not JSON — fall through to generic handling
    }
  }
  if (/^<(!doctype|html)/i.test(trimmed)) {
    return `Backend returned HTTP ${status} as an HTML gateway page (Cloudflare): the orchestrator is reachable, but provider routing failed. Check journalctl -u orchestrator on the server.`;
  }
  return `Backend returned HTTP ${status}: ${trimmed.slice(0, 400)}`;
}

// isNetworkFailure distinguishes "could not reach the backend at all" from
// "the backend answered with an error".
function isNetworkFailure(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  return /failed to fetch|networkerror|load failed|fetch failed/i.test(String(err));
}

// Cap large tool results so they don't bloat the conversation context and cause OOM.
function capToolResult(result: string, maxChars = 4000): string {
  if (result.length <= maxChars) return result;
  return result.slice(0, maxChars) + `...[truncated ${result.length - maxChars} chars]`;
}

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
      case 'get_cli_models': {
        const r = await fetch(`${BASE}/api/cli/models`);
        if (!r.ok) return JSON.stringify({ error: `HTTP ${r.status}` });
        return JSON.stringify(await r.json());
      }
      case 'update_cli_model': {
        const updates = input['updates'] as Record<string, string | null>;
        const r = await fetch(`${BASE}/api/cli/models`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });
        if (!r.ok) return JSON.stringify({ error: `HTTP ${r.status}` });
        return JSON.stringify(await r.json());
      }
      case 'get_self_info': {
        // Fetch live provider chain from /health to show which provider is currently primary
        let providerChain: string[] = [];
        let primaryProvider = 'unknown';
        try {
          const h = await fetch(`${BASE}/health`);
          if (h.ok) {
            const hj = await h.json();
            providerChain = hj.chain || [];
            primaryProvider = providerChain[0] || 'unknown';
          }
        } catch { /* ignore */ }
        return JSON.stringify({
          model: 'claude-sonnet-4-6 (us.anthropic.claude-sonnet-4-6)',
          model_family: 'Claude Sonnet 4.6',
          provider: primaryProvider,
          provider_chain: providerChain,
          proxy: window.location.origin,
          platform: 'ULTRON Multi-CLI Orchestrator v2.0',
          context_window: 200000,
          max_output_tokens: 4096,
          capabilities: ['tool_use', 'vision', 'streaming', 'multi_turn'],
        });
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
        const tasks = await r.json();
        if (!Array.isArray(tasks)) return JSON.stringify(tasks);
        const counts: Record<string, number> = {};
        for (const t of tasks) {
          const s = (t.Status || t.status || 'unknown') as string;
          counts[s] = (counts[s] || 0) + 1;
        }
        const recent = tasks.slice(0, 5).map((t: Record<string, unknown>) => ({
          id: t.ID || t.id,
          status: t.Status || t.status,
          prompt: String(t.Prompt || t.prompt || '').slice(0, 60),
          agentId: t.AgentID || t.agentId,
        }));
        return JSON.stringify({ counts, total: tasks.length, recent });
      }
      case 'get_agent_status': {
        const r = await fetch(`${BASE}/api/agents/status`);
        if (!r.ok) return JSON.stringify({ error: `HTTP ${r.status}`, note: 'agents/status not available' });
        return JSON.stringify(await r.json());
      }
      case 'get_provider_health': {
        const r = await fetch(`${BASE}/health`);
        return JSON.stringify(await r.json());
      }
      case 'get_provider_catalog': {
        const r = await fetch(`${BASE}/api/providers/catalog`);
        return JSON.stringify(await r.json());
      }
      case 'switch_provider_model': {
        const r = await fetch(`${BASE}/api/providers/switch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: input.provider, model: input.model }),
        });
        return JSON.stringify(await r.json());
      }
      case 'test_provider': {
        const r = await fetch(`${BASE}/api/providers/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: input.provider }),
        });
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
      case 'send_self_message': {
        const msg = input['message'] as string;
        const delayMs = (input['delay_minutes'] as number) * 60 * 1000;
        const dueMs = Date.now() + delayMs;
        const label = (input['label'] as string) || msg.slice(0, 40);
        try {
          const existing = JSON.parse(localStorage.getItem('ultron_pending_reminders') || '[]');
          existing.push({ text: msg, dueMs, label, createdMs: Date.now() });
          localStorage.setItem('ultron_pending_reminders', JSON.stringify(existing));
          window.dispatchEvent(new CustomEvent('ultron:notify', { detail: { id: crypto.randomUUID(), type: 'info', title: 'Reminder scheduled', message: `Due: ${new Date(dueMs).toLocaleString()}`, ts: Date.now(), read: false, source: 'reminder' } }));
        } catch { /* ignore */ }
        return JSON.stringify({ ok: true, due_at: new Date(dueMs).toISOString(), label });
      }
      case 'list_reminders': {
        try {
          const pending = JSON.parse(localStorage.getItem('ultron_pending_reminders') || '[]');
          return JSON.stringify({ reminders: pending, count: pending.length });
        } catch {
          return JSON.stringify({ reminders: [], count: 0 });
        }
      }
      case 'cancel_reminder': {
        const labelToCancel = (input['label'] as string).toLowerCase();
        try {
          const pending = JSON.parse(localStorage.getItem('ultron_pending_reminders') || '[]');
          const before = pending.length;
          const remaining = pending.filter((r: { label: string }) => !r.label.toLowerCase().includes(labelToCancel));
          localStorage.setItem('ultron_pending_reminders', JSON.stringify(remaining));
          return JSON.stringify({ ok: true, cancelled: before - remaining.length });
        } catch {
          return JSON.stringify({ ok: false, error: 'could not access reminders' });
        }
      }
      case 'broadcast_to_agents': {
        const r = await fetch(`${BASE}/api/broadcast`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: input['type'] || 'directive', message: input['message'] }),
        });
        if (!r.ok) return JSON.stringify({ error: `HTTP ${r.status}` });
        return JSON.stringify(await r.json());
      }
      case 'add_self_skill': {
        const url = input['url'] as string;
        const skillName = input['name'] as string;
        const skillDesc = input['description'] as string;
        try {
          const res = await fetch(url);
          if (!res.ok) return JSON.stringify({ error: `fetch failed: HTTP ${res.status}` });
          const content = await res.text();
          const skills = JSON.parse(localStorage.getItem('ultron_self_skills') || '[]');
          const existing = skills.findIndex((s: { name: string }) => s.name === skillName);
          const entry = { name: skillName, description: skillDesc, content: content.slice(0, 8000), url, addedMs: Date.now() };
          if (existing >= 0) skills[existing] = entry; else skills.push(entry);
          localStorage.setItem('ultron_self_skills', JSON.stringify(skills));
          window.dispatchEvent(new CustomEvent('ultron:notify', { detail: { id: crypto.randomUUID(), type: 'upgrade', title: `Skill added: ${skillName}`, message: skillDesc || url, ts: Date.now(), read: false, source: 'skill' } }));
          return JSON.stringify({ ok: true, name: skillName, content_length: content.length });
        } catch (e) {
          return JSON.stringify({ error: String(e) });
        }
      }
      case 'list_self_skills': {
        try {
          const skills = JSON.parse(localStorage.getItem('ultron_self_skills') || '[]');
          return JSON.stringify({ skills: skills.map((s: { name: string; description: string; url: string; addedMs: number }) => ({
            name: s.name, description: s.description, url: s.url, added: new Date(s.addedMs).toISOString(),
          })), count: skills.length });
        } catch {
          return JSON.stringify({ skills: [], count: 0 });
        }
      }
      case 'write_memory_note': {
        const note = input['note'] as string;
        const category = (input['category'] as string) || 'general';
        try {
          const notes = JSON.parse(localStorage.getItem('ultron_memory_notes') || '[]');
          notes.push({ note, category, ts: Date.now(), id: Math.random().toString(36).slice(2, 8) });
          localStorage.setItem('ultron_memory_notes', JSON.stringify(notes));
          window.dispatchEvent(new CustomEvent('ultron:notify', { detail: { id: crypto.randomUUID(), type: 'upgrade', title: 'Memory note saved', message: `[${category}] ${note.slice(0, 60)}`, ts: Date.now(), read: false, source: 'memory' } }));
          return JSON.stringify({ ok: true, total_notes: notes.length });
        } catch {
          return JSON.stringify({ ok: false, error: 'localStorage unavailable' });
        }
      }
      case 'read_memory_notes': {
        const filterCat = input['category'] as string | undefined;
        try {
          const notes = JSON.parse(localStorage.getItem('ultron_memory_notes') || '[]');
          const filtered = filterCat
            ? notes.filter((n: { category: string }) => n.category === filterCat)
            : notes;
          return JSON.stringify({ notes: filtered, count: filtered.length });
        } catch {
          return JSON.stringify({ notes: [], count: 0 });
        }
      }
      case 'create_autonomous_task': {
        const r = await fetch(`${BASE}/api/autonomous/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            goal: input['goal'],
            steps: input['steps'],
            deadline_hours: input['deadline_hours'],
          }),
        });
        if (!r.ok) return JSON.stringify({ error: `HTTP ${r.status}` });
        const result = await r.json();
        window.dispatchEvent(new CustomEvent('ultron:notify', { detail: { id: crypto.randomUUID(), type: 'autonomous', title: 'Autonomous task started', message: String(input['goal']).slice(0, 80), ts: Date.now(), read: false, source: 'autonomous_task' } }));
        return JSON.stringify({ ok: true, task_id: result.id, message: `Autonomous task started. You will receive step updates in this chat as the executor progresses.` });
      }
      case 'get_autonomous_tasks': {
        const r = await fetch(`${BASE}/api/autonomous/tasks`);
        if (!r.ok) return JSON.stringify({ error: `HTTP ${r.status}` });
        return JSON.stringify(await r.json());
      }
      case 'pause_autonomous_task': {
        const r = await fetch(`${BASE}/api/autonomous/tasks/${input['task_id'] as string}/pause`, { method: 'POST' });
        if (!r.ok) return JSON.stringify({ error: `HTTP ${r.status}` });
        return JSON.stringify(await r.json());
      }
      case 'resume_autonomous_task': {
        const r = await fetch(`${BASE}/api/autonomous/tasks/${input['task_id'] as string}/resume`, { method: 'POST' });
        if (!r.ok) return JSON.stringify({ error: `HTTP ${r.status}` });
        return JSON.stringify(await r.json());
      }
      case 'send_notification': {
        window.dispatchEvent(new CustomEvent('ultron:notify', {
          detail: {
            id: crypto.randomUUID(),
            type: (input['type'] as string) || 'info',
            title: input['title'] as string,
            message: input['message'] as string,
            ts: Date.now(),
            read: false,
            source: 'ultron',
          },
        }));
        return JSON.stringify({ ok: true });
      }
      case 'github_api': {
        const r = await fetch(`${BASE}/api/github/api`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: input['method'] || 'GET', endpoint: input['endpoint'], body: input['body'] }),
        });
        return capToolResult(JSON.stringify(await r.json()));
      }
      case 'github_cli': {
        const r = await fetch(`${BASE}/api/github/cli`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ args: input['args'], cwd: input['cwd'] }),
        });
        return capToolResult(JSON.stringify(await r.json()));
      }
      case 'github_read_file': {
        const ref = (input['ref'] as string) || 'main';
        const r = await fetch(`${BASE}/api/github/api`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'GET', endpoint: `/repos/${input['owner']}/${input['repo']}/contents/${input['path']}?ref=${ref}` }),
        });
        const data = await r.json();
        if (data.content) {
          return capToolResult(JSON.stringify({ ...data, decoded_content: atob(data.content.replace(/\n/g, '')) }));
        }
        return capToolResult(JSON.stringify(data));
      }
      case 'github_write_file': {
        const encoded = btoa(unescape(encodeURIComponent(input['content'] as string)));
        const body: Record<string, unknown> = {
          message: input['message'],
          content: encoded,
          branch: input['branch'] || 'main',
        };
        if (input['sha']) body['sha'] = input['sha'];
        const r = await fetch(`${BASE}/api/github/api`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'PUT', endpoint: `/repos/${input['owner']}/${input['repo']}/contents/${input['path']}`, body }),
        });
        return JSON.stringify(await r.json());
      }
      case 'github_list_repos': {
        const limit = (input['limit'] as number) || 30;
        const r = await fetch(`${BASE}/api/github/cli`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ args: ['repo', 'list', '--json', 'name,description,url,isPrivate,updatedAt', '--limit', String(limit)] }),
        });
        return capToolResult(JSON.stringify(await r.json()));
      }
      case 'github_create_pr': {
        const r = await fetch(`${BASE}/api/github/api`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'POST',
            endpoint: `/repos/${input['owner']}/${input['repo']}/pulls`,
            body: { title: input['title'], body: input['body'] || '', head: input['head'], base: input['base'] || 'main' },
          }),
        });
        return JSON.stringify(await r.json());
      }
      case 'github_create_issue': {
        const r = await fetch(`${BASE}/api/github/api`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'POST',
            endpoint: `/repos/${input['owner']}/${input['repo']}/issues`,
            body: { title: input['title'], body: input['body'] || '', labels: input['labels'] || [] },
          }),
        });
        return JSON.stringify(await r.json());
      }
      case 'github_search_code': {
        const r = await fetch(`${BASE}/api/github/api`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'GET', endpoint: `/search/code?q=${encodeURIComponent(input['query'] as string)}` }),
        });
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

// ─── localStorage helpers ─────────────────────────────────────────────────────

const LS_SESSIONS = 'ultron_sessions';
const LS_MESSAGES = 'ultron_messages';
const LS_CONVOS   = 'ultron_conversations';
const MAX_MSGS_PER_SESSION = 50;

function lsGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function lsSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota exceeded — silently ignore
  }
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
  // Load persisted state from localStorage on first render
  const [sessions, setSessions] = useState<ChatSession[]>(() => lsGet<ChatSession[]>(LS_SESSIONS) ?? []);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    const saved = lsGet<ChatSession[]>(LS_SESSIONS);
    return saved && saved.length > 0 ? saved[0].id : null;
  });
  const [messagesBySession, setMessagesBySession] = useState<Record<string, ChatMessage[]>>(() => {
    const saved = lsGet<Record<string, ChatMessage[]>>(LS_MESSAGES) ?? {};
    // Cap each session at MAX_MSGS_PER_SESSION
    const capped: Record<string, ChatMessage[]> = {};
    for (const [k, v] of Object.entries(saved)) {
      capped[k] = Array.isArray(v) ? v.slice(-MAX_MSGS_PER_SESSION) : [];
    }
    return capped;
  });
  const [isLoading, setIsLoading] = useState(false);

  // Per-session Anthropic API conversation history — restored from localStorage
  const conversationsBySession = useRef<Record<string, ApiMessage[]>>(
    lsGet<Record<string, ApiMessage[]>>(LS_CONVOS) ?? {}
  );
  // Task IDs dispatched from this chat so we can listen for WS updates
  const dispatchedTaskIds = useRef<Set<string>>(new Set());
  // Ref to always-current activeSessionId for use inside closures
  const activeSessionIdRef = useRef<string | null>(null);
  // Self-skills loaded from localStorage — injected into system prompt
  const selfSkillsRef = useRef<Array<{ name: string; description: string; content: string }>>(
    (() => {
      try { return JSON.parse(localStorage.getItem('ultron_self_skills') || '[]'); } catch { return []; }
    })()
  );
  // Local memory notes — loaded for summary injection
  const memoryNotesRef = useRef<Array<{ note: string; category: string; ts: number }>>(
    (() => {
      try { return JSON.parse(localStorage.getItem('ultron_memory_notes') || '[]'); } catch { return []; }
    })()
  );
  // AbortController for stopping generation
  const abortControllerRef = useRef<AbortController | null>(null);

  // Keep ref in sync for use in closures (WS handler, etc.)
  activeSessionIdRef.current = activeSessionId;

  // Active messages derived from current session
  const messages = activeSessionId ? messagesBySession[activeSessionId] || [] : [];

  // ── Persist to localStorage whenever state changes ──
  useEffect(() => { lsSet(LS_SESSIONS, sessions); }, [sessions]);
  useEffect(() => {
    // Cap before saving
    const capped: Record<string, ChatMessage[]> = {};
    for (const [k, v] of Object.entries(messagesBySession)) {
      capped[k] = v.slice(-MAX_MSGS_PER_SESSION);
    }
    lsSet(LS_MESSAGES, capped);
  }, [messagesBySession]);

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

  // ── Initialize first session on mount — only if nothing was restored ──
  useEffect(() => {
    if (sessions.length === 0) {
      startNewSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── WebSocket listener — inject autonomous task updates into chat ──
  useEffect(() => {
    const wsUrl = window.location.origin.replace(/^http/, 'ws') + '/ws';
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      try {
        ws = new WebSocket(wsUrl);
        ws.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data as string) as Record<string, unknown>;
            const type = data['type'] as string;
            if (
              type === 'autonomous_step_complete' ||
              type === 'autonomous_task_complete' ||
              type === 'autonomous_task_created'
            ) {
              const label =
                type === 'autonomous_task_created' ? '🤖 AUTONOMOUS TASK STARTED' :
                type === 'autonomous_task_complete' ? '✅ AUTONOMOUS TASK COMPLETE' :
                '⚡ AUTONOMOUS STEP UPDATE';
              const msgId = uid();
              const msg: ChatMessage = {
                id: msgId, key: msgId,
                role: 'assistant',
                content: `**[${label}]**\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``,
                timestamp: Date.now(),
                status: 'done',
              };
              // Inject into current active session
              setMessagesBySession((prev) => {
                const sessionId = activeSessionIdRef.current || Object.keys(prev)[0];
                if (!sessionId) return prev;
                return { ...prev, [sessionId]: [...(prev[sessionId] || []), msg] };
              });
            }
          } catch { /* ignore */ }
        };
        ws.onclose = () => {
          reconnectTimer = setTimeout(connect, 5000);
        };
      } catch { /* ignore connection errors */ }
    };
    connect();
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Self-reminder polling — check every 60s for due reminders ──
  useEffect(() => {
    const check = () => {
      try {
        const pending = JSON.parse(localStorage.getItem('ultron_pending_reminders') || '[]');
        const now = Date.now();
        const due = pending.filter((r: { dueMs: number }) => r.dueMs <= now);
        const remaining = pending.filter((r: { dueMs: number }) => r.dueMs > now);
        if (due.length > 0) {
          localStorage.setItem('ultron_pending_reminders', JSON.stringify(remaining));
          for (const reminder of due) {
            void sendMessage(`[SELF-REMINDER] ${reminder.text}`);
          }
        }
      } catch { /* ignore */ }
    };
    check();
    const interval = setInterval(check, 60_000);
    return () => clearInterval(interval);
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
      lsSet(LS_CONVOS, conversationsBySession.current);

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
        const MAX_TURNS = 25;
        let turns = 0;

        while (continueLoop && turns < MAX_TURNS) {
          if (abortController.signal.aborted) break;
          turns++;

          // Refresh skills/notes refs from localStorage so new additions are picked up
          try { selfSkillsRef.current = JSON.parse(localStorage.getItem('ultron_self_skills') || '[]'); } catch { /* */ }
          try { memoryNotesRef.current = JSON.parse(localStorage.getItem('ultron_memory_notes') || '[]'); } catch { /* */ }
          const dynamicPrompt = buildUltronSystemPrompt({
            date: new Date().toISOString().split('T')[0],
            activeToolsCount: activeTools.length,
            selfSkills: selfSkillsRef.current,
            memoryNotes: memoryNotesRef.current.slice(-20),
          });

          // Trim context: cap at 20 messages normally, 12 if any message is large
          const rawMsgs = conversationsBySession.current[currentSessionId] || [];
          const hasLargeMsgs = rawMsgs.some(m =>
            typeof m.content === 'string' && m.content.length > 5000
          );
          const trimTo = hasLargeMsgs ? 12 : 20;
          const trimmedMsgs = rawMsgs.slice(-trimTo);

          const payload = {
            model:      'us.anthropic.claude-sonnet-4-6',
            max_tokens: 4096,
            system:     dynamicPrompt,
            tools:      activeTools,
            messages:   trimmedMsgs,
          };

          const callStartMs = Date.now();
          let response: ApiResponse;
          let servingProvider = '';
          let timedOut = false;
          const timeoutId: ReturnType<typeof setTimeout> = setTimeout(() => {
            timedOut = true;
            abortController.abort();
          }, REQUEST_TIMEOUT_MS);
          try {
            const res = await fetch(`${BASE}/v1/messages`, {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify(payload),
              signal:  abortController.signal,
            });
            if (!res.ok) {
              const errText = await res.text();
              throw new Error(describeGatewayError(res.status, errText));
            }
            servingProvider = res.headers.get('X-Ultron-Provider') ?? '';
            response = (await res.json()) as ApiResponse;
          } catch (fetchErr: unknown) {
            // A new message aborts the previous request — stay silent for that.
            if (abortController.signal.aborted && !timedOut) break;
            const errMsgId = uid();
            const failureText = timedOut
              ? `Request timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s — the provider chain never answered.`
              : isNetworkFailure(fetchErr)
                ? `Backend unreachable: ${String(fetchErr)}. Is the orchestrator running on :8080?`
                : String(fetchErr);
            const errMsg: ChatMessage = {
              id:        errMsgId,
              key:       errMsgId,
              role:      'assistant',
              content:   failureText,
              timestamp: Date.now(),
              status:    'error',
            };
            setMessagesBySession((prev) => ({
              ...prev,
              [currentSessionId]: [...(prev[currentSessionId] || []), errMsg],
            }));
            break;
          } finally {
            clearTimeout(timeoutId);
          }

          const latencyMs = Date.now() - callStartMs;

          // 4. Add assistant turn to conversation history
          conversationsBySession.current[currentSessionId].push({
            role: 'assistant',
            content: response.content,
          });
          lsSet(LS_CONVOS, conversationsBySession.current);

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
              model:     servingProvider || 'claude-sonnet-4-6',
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

            // Bug 1 fix: add all placeholder cards at once to avoid React batching race
            const toolCallMsgs: ChatMessage[] = toolUseBlocks.map((tb) => ({
              id:        uid(),
              key:       uid(),
              role:      'tool_call' as const,
              content:   `Executing ${tb.name}`,
              toolUse:   { id: tb.id, name: tb.name, input: tb.input },
              timestamp: Date.now(),
              status:    'streaming' as const,
            }));
            setMessagesBySession((prev) => ({
              ...prev,
              [currentSessionId]: [...(prev[currentSessionId] || []), ...toolCallMsgs],
            }));

            for (let ti = 0; ti < toolUseBlocks.length; ti++) {
              const toolBlock = toolUseBlocks[ti];
              const msgId = toolCallMsgs[ti].id;
              if (abortController.signal.aborted) break;
              const startMs = Date.now();

              // Execute tool
              const result = await executeTool(toolBlock.name, toolBlock.input);
              const durationMs = Date.now() - startMs;

              // Update this tool's card (msgId captured per-iteration — no race)
              setMessagesBySession((prev) => ({
                ...prev,
                [currentSessionId]: (prev[currentSessionId] || []).map((m) =>
                  m.id === msgId
                    ? { ...m, toolResult: result, toolDurationMs: durationMs, status: 'done' as const }
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
            lsSet(LS_CONVOS, conversationsBySession.current);
          } else {
            continueLoop = false;
            // Bug 4 fix: trim conversation history to avoid unbounded token growth
            const hist = conversationsBySession.current[currentSessionId];
            if (hist && hist.length > 20) {
              conversationsBySession.current[currentSessionId] = hist.slice(hist.length - 20);
              lsSet(LS_CONVOS, conversationsBySession.current);
            }
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
        // Bug 6 fix: trim API history back to just before the last user message
        // to prevent the LLM from seeing duplicated history on regenerate
        const hist = conversationsBySession.current[activeSessionId] || [];
        let lastUserIdx = -1;
        for (let i = hist.length - 1; i >= 0; i--) {
          if (hist[i].role === 'user' && typeof hist[i].content === 'string') {
            lastUserIdx = i;
            break;
          }
        }
        if (lastUserIdx >= 0) {
          conversationsBySession.current[activeSessionId] = hist.slice(0, lastUserIdx);
          lsSet(LS_CONVOS, conversationsBySession.current);
        }

        // Remove UI messages after and including the regenerated user msg's response
        const userMsgIdx = currentMsgs.indexOf(targetUserMsg);
        setMessagesBySession((prev) => ({
          ...prev,
          [activeSessionId]: currentMsgs.slice(0, userMsgIdx + 1),
        }));

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
