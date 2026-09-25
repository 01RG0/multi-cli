import { create } from 'zustand';

// ============================================================================
// Types & Domain Interfaces
// ============================================================================

export type AgentStatus = 'idle' | 'running' | 'waiting' | 'error';
export type TaskStatus = 'running' | 'pending' | 'completed' | 'failed';
export type ViewFilter = 'ALL' | 'RUNNING' | 'PENDING' | 'DONE' | 'FAILED';
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FAILED';
export type ProviderHealth = 'green' | 'amber' | 'red';
export type WsConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'simulated';

// LogLine represents one streamed stdout/stderr line from a CLI agent task.
export interface LogLine {
  agentId: string;
  stream: 'stdout' | 'stderr';
  line: string;
  ts: number; // Unix milliseconds
}

export interface AgentMetrics {
  tasksCompleted: number;
  successRate: number; // e.g. 98
  avgLatency: number;  // in ms
  tokensUsed: number;
}

export interface BeamConnection {
  active: boolean;
  target?: string;
  intensity?: number;
  lastPing?: number;
}

export interface Agent {
  id: string;
  name: string;
  badge: string;
  status: AgentStatus;
  currentTaskId: string | number | null;
  taskId?: string | number | null; // Compatibility alias
  tokensUsed: number;
  avgLatencyMs: number;
  avgLatency?: number; // Compatibility alias
  latency?: string;    // Compatibility alias (e.g. "131ms")
  successRate: number; // e.g. 97
  tasksCompleted: number;
  tasks?: number;      // Compatibility alias
  activeBeamConnection: boolean | BeamConnection;
  activeBeam?: boolean; // Compatibility alias
  metrics?: AgentMetrics; // Compatibility metrics object
  model?: string;
  role?: string;
  type?: string;
  provider?: string;
  icon?: string;
  load?: number;
  capabilities?: string[];
  tools?: string[];
}

export interface Task {
  id: string;
  agentId: string;
  agent?: { id: string; name: string }; // Compatibility alias
  prompt: string;
  preview?: string;                     // Compatibility alias
  icon?: 'terminal' | 'globe' | 'clock';
  status: TaskStatus;
  priority: number; // 1-10
  latencyMs: number;
  latency?: string; // Compatibility alias
  createdAt: string;
  completedAt?: string | null;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  agent: string;
  message: string;
}

export interface Provider {
  id: string;
  name: string;
  apiKeyMasked: string;
  apiKey: string;
  latencyMs: number;
  latency: number; // Compatibility alias
  health: ProviderHealth;
  enabled: boolean;
  cooldownUntil: number | null;
}

export interface RoutingRule {
  id: string;
  field: string;       // task_type | intent | language | priority | content | model_pref
  operator: string;    // contains | equals | starts_with | matches
  value: string;
  targetAgent: string; // CLI tool to dispatch to
  model: string;       // AI provider/model backing the agent
  priority: number;    // lower = higher priority (1–10)
  action?: string;
  actionTarget?: string;
  enabled?: boolean;
}

export interface SystemStats {
  agentsCount: number;
  runningCount: number;
  tasksToday: number;
  avgLatencyMs: number;
  cpuUsage: string;
  memory: string;
  uptime: string;
}

export interface AgentConfig {
  name: string;
  enabled: boolean;
  maxConcurrentTasks: number;
  preferredProviderOverride: boolean;
}

export interface TelemetryStats {
  eventsPerSec: string;
  eventsHistory: number[];
  errorRate: string;
  errorRateHistory: number[];
  topAgents: Array<{ name: string; percentage: string; count?: number }>;
  topErrors: Array<{ name: string; count: number }>;
}

export interface SwarmStore {
  // State
  agents: Agent[];
  tasks: Task[];
  logs: LogEntry[];
  providers: Provider[];
  routingRules: RoutingRule[];
  systemStats: SystemStats;
  telemetry: TelemetryStats;
  agentConfig: AgentConfig;
  selectedTaskId: string | null;
  selectedAgentId: string | null;
  activeViewFilter: ViewFilter;
  wsStatus: WsConnectionStatus;
  isSimulating: boolean;
  isConnected: boolean;

  // Streaming log state (per-task CLI output lines from RunStreaming)
  logsByTask: Record<string, LogLine[]>;
  selectedLogTaskId: string | null;

  // Memory Cortex events
  lastMemoryEvent: { type: string; action: string; node?: any; episode?: any; id?: string; timestamp: number } | null;
  memoryRevision: number;

  // Actions - Selection & Filtering
  setSelectedAgentId: (id: string | null) => void;
  setSelectedAgent: (id: string | null) => void;
  setSelectedTaskId: (id: string | null) => void;
  setActiveViewFilter: (filter: ViewFilter) => void;
  setFilter: (filter: ViewFilter) => void;

  // Actions - Logs (general system log)
  addLog: (entry: Omit<LogEntry, 'id' | 'timestamp'> & { timestamp?: string; id?: string }) => void;
  clearLogs: () => void;

  // Actions - Streaming logs (per-task CLI output)
  addLogLine: (taskId: string, line: LogLine) => void;
  getLogsForTask: (taskId: string) => LogLine[];
  setSelectedLogTaskId: (id: string | null) => void;

  // Actions - Tasks
  addTask: (task: Partial<Task> & { prompt: string }) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  removeTask: (id: string) => void;
  setTasks: (tasks: Task[]) => void;
  cancelTask: (id: string) => Promise<boolean>;
  retryTask: (id: string) => Promise<string | null>;

  // Actions - Agents
  updateAgent: (id: string, updates: Partial<Agent>) => void;
  setAgents: (agents: Agent[]) => void;
  triggerBeamPing: (agentId: string, intensity?: number) => void;
  fetchAgents: () => Promise<void>;

  // Actions - Providers
  updateProvider: (id: string, updates: Partial<Provider>) => void;
  setProviders: (providers: Provider[]) => void;

  // Actions - Config
  setAgentConfig: (config: Partial<AgentConfig>) => void;

  // Actions - Routing Rules
  addRoutingRule: (rule: RoutingRule) => void;
  updateRoutingRule: (id: string, rule: Partial<RoutingRule>) => void;
  deleteRoutingRule: (id: string) => void;
  setRoutingRules: (rules: RoutingRule[]) => void;
  fetchRoutingRules: () => Promise<void>;
  fetchLogs: (taskId?: string) => Promise<LogEntry[]>;

  // Actions - Stats & Telemetry
  updateSystemStats: (updates: Partial<SystemStats>) => void;
  updateTelemetry: (updates: Partial<TelemetryStats>) => void;

  // Actions - Simulation & WebSocket Engine
  toggleSimulation: (enabled?: boolean) => void;
  connectWebSocket: (url?: string) => void;
  disconnectWebSocket: () => void;
  sendWsMessage: (message: unknown) => boolean;
  setWsStatus: (status: WsConnectionStatus) => void;
}

// ============================================================================
// FrameBatcher (60Hz RAF State Coalescer)
// ============================================================================

export type StateUpdater<T> = (state: T) => Partial<T> | void;

/**
 * FrameBatcher coalesces high-frequency incoming updates (such as rapid WebSocket
 * events, streaming log chunks, and telemetry pings) into atomic state mutations
 * scheduled on the next requestAnimationFrame (60Hz / ~16.6ms).
 */
export class FrameBatcher<T = SwarmStore> {
  private queue: Array<StateUpdater<T>> = [];
  private rafId: number | null = null;
  private isFlushing = false;
  private applyFn: (updater: (state: T) => Partial<T>) => void;

  constructor(applyFn: (updater: (state: T) => Partial<T>) => void) {
    this.applyFn = applyFn;
  }

  public enqueue(updater: StateUpdater<T>): void {
    this.queue.push(updater);
    this.scheduleFlush();
  }

  public scheduleFlush(): void {
    if (this.rafId !== null) return;

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      this.rafId = window.requestAnimationFrame(() => this.flush());
    } else {
      // Fallback for non-browser or background environments
      this.rafId = setTimeout(() => this.flush(), 16) as unknown as number;
    }
  }

  public flush(): void {
    this.rafId = null;
    if (this.queue.length === 0 || this.isFlushing) return;

    this.isFlushing = true;
    const updaters = this.queue.splice(0, this.queue.length);

    try {
      this.applyFn((currentState: T) => {
        let hasChanges = false;
        let accumulator: Partial<T> = {};

        for (let i = 0; i < updaters.length; i++) {
          const fn = updaters[i];
          const result = fn({ ...currentState, ...accumulator });
          if (result && typeof result === 'object') {
            Object.assign(accumulator, result);
            hasChanges = true;
          }
        }

        return hasChanges ? accumulator : {};
      });
    } finally {
      this.isFlushing = false;
      if (this.queue.length > 0) {
        this.scheduleFlush();
      }
    }
  }

  public destroy(): void {
    if (this.rafId !== null) {
      if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(this.rafId);
      } else {
        clearTimeout(this.rafId);
      }
      this.rafId = null;
    }
    this.queue = [];
  }
}

// ============================================================================
// Helper Utilities & Factory Functions
// ============================================================================

function formatTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function generateId(prefix: string = 'id'): string {
  return `${prefix}-${Math.random().toString(36).substring(2, 9)}`;
}

export function createAgent(config: {
  id: string;
  name: string;
  badge?: string;
  status: AgentStatus;
  currentTaskId?: string | null;
  tokensUsed?: number;
  avgLatencyMs?: number;
  successRate?: number;
  tasksCompleted?: number;
  activeBeam?: boolean;
  model?: string;
  role?: string;
  type?: string;
  provider?: string;
  icon?: string;
  latency?: string;
  load?: number;
  capabilities?: string[];
  tools?: string[];
}): Agent {
  const avgLatencyMs = config.avgLatencyMs ?? (config.latency ? parseInt(config.latency, 10) || 34 : 100);
  const tasksCompleted = config.tasksCompleted ?? 0;
  const tokensUsed = config.tokensUsed ?? 0;
  const successRate = config.successRate ?? 98;
  const activeBeam = config.activeBeam ?? false;
  return {
    id: config.id,
    name: config.name,
    badge: config.badge ?? config.id.slice(0, 2).toUpperCase(),
    status: config.status,
    currentTaskId: config.currentTaskId ?? null,
    taskId: config.currentTaskId ?? null,
    tokensUsed,
    avgLatencyMs,
    avgLatency: avgLatencyMs,
    latency: config.latency ?? `${avgLatencyMs}ms`,
    successRate,
    tasksCompleted,
    tasks: tasksCompleted,
    activeBeamConnection: {
      active: activeBeam,
      target: 'orchestrator-core',
      intensity: activeBeam ? 0.9 : 0.0,
      lastPing: Date.now(),
    },
    activeBeam,
    metrics: {
      tasksCompleted,
      successRate,
      avgLatency: avgLatencyMs,
      tokensUsed,
    },
    model: config.model,
    role: config.role,
    type: config.type ?? config.id,
    provider: config.provider ?? config.id,
    icon: config.icon ?? config.id,
    load: config.load ?? 0,
    capabilities: config.capabilities,
    tools: config.tools,
  };
}

export function createTask(config: {
  id: string;
  agentId: string;
  agentName?: string;
  prompt: string;
  status: TaskStatus;
  priority: number;
  latencyMs: number;
  createdAt: string;
  icon?: 'terminal' | 'globe' | 'clock';
}): Task {
  return {
    id: config.id,
    agentId: config.agentId,
    agent: {
      id: config.agentId,
      name: config.agentName || config.agentId,
    },
    prompt: config.prompt,
    preview: config.prompt,
    status: config.status,
    priority: config.priority,
    latencyMs: config.latencyMs,
    latency: config.latencyMs > 0 ? `${config.latencyMs}ms` : '--',
    createdAt: config.createdAt,
    icon: config.icon || 'terminal',
  };
}

export function createProvider(config: {
  id: string;
  name: string;
  apiKeyMasked: string;
  apiKey: string;
  latencyMs: number;
  health: ProviderHealth;
  enabled: boolean;
  cooldownUntil: number | null;
}): Provider {
  return {
    id: config.id,
    name: config.name,
    apiKeyMasked: config.apiKeyMasked,
    apiKey: config.apiKey,
    latencyMs: config.latencyMs,
    latency: config.latencyMs,
    health: config.health,
    enabled: config.enabled,
    cooldownUntil: config.cooldownUntil,
  };
}

// ============================================================================
// Realistic Mock Initial Dataset
// ============================================================================

const initialAgents: Agent[] = [
  createAgent({
    id: 'opencode',
    name: 'opencode',
    badge: 'OC',
    status: 'running',
    currentTaskId: 'task-1024',
    tokensUsed: 342150,
    avgLatencyMs: 131,
    successRate: 98.4,
    tasksCompleted: 483,
    activeBeam: true,
    model: 'claude-3-5-sonnet',
    role: 'AST Synthesizer & Code Architect',
  }),
  createAgent({
    id: 'codex',
    name: 'codex',
    badge: 'CX',
    status: 'running',
    currentTaskId: 'task-1028',
    tokensUsed: 512900,
    avgLatencyMs: 210,
    successRate: 96.8,
    tasksCompleted: 612,
    activeBeam: true,
    model: 'gpt-4o',
    role: 'Sandboxed Code Execution Engine',
  }),
  createAgent({
    id: 'vibe',
    name: 'vibe',
    badge: 'VB',
    status: 'running',
    currentTaskId: 'task-1031',
    tokensUsed: 198400,
    avgLatencyMs: 85,
    successRate: 99.1,
    tasksCompleted: 340,
    activeBeam: true,
    model: 'claude-3-5-haiku',
    role: 'Rapid UI Prototyping & Hot-Fix',
  }),
  createAgent({
    id: 'agy',
    name: 'agy',
    badge: 'AG',
    status: 'running',
    currentTaskId: 'task-1033',
    tokensUsed: 620400,
    avgLatencyMs: 245,
    successRate: 97.5,
    tasksCompleted: 529,
    activeBeam: true,
    model: 'antigravity-2.0',
    role: 'Autonomous Swarm Orchestration Core',
  }),
  createAgent({
    id: 'grok',
    name: 'grok',
    badge: 'GK',
    status: 'idle',
    currentTaskId: null,
    tokensUsed: 441200,
    avgLatencyMs: 310,
    successRate: 95.2,
    tasksCompleted: 284,
    activeBeam: false,
    model: 'grok-2-1212',
    role: 'Formal Verification & Deep Reasoning',
  }),
  createAgent({
    id: 'kilo',
    name: 'kilo',
    badge: 'KL',
    status: 'waiting',
    currentTaskId: null,
    tokensUsed: 115000,
    avgLatencyMs: 42,
    successRate: 99.8,
    tasksCompleted: 890,
    activeBeam: false,
    model: 'qwen-2.5-coder',
    role: 'Micro-latency Token Optimizer',
  }),
  createAgent({
    id: 'cline',
    name: 'cline',
    badge: 'CL',
    status: 'idle',
    currentTaskId: null,
    tokensUsed: 278000,
    avgLatencyMs: 195,
    successRate: 94.6,
    tasksCompleted: 312,
    activeBeam: false,
    model: 'claude-3-5-sonnet',
    role: 'Tool & Terminal Dispatcher',
  }),
  createAgent({
    id: 'researcher',
    name: 'researcher',
    badge: 'R8',
    status: 'idle',
    currentTaskId: null,
    tokensUsed: 189000,
    avgLatencyMs: 140,
    successRate: 98.0,
    tasksCompleted: 156,
    activeBeam: false,
    model: 'deepseek-v3',
    role: 'Web & Documentation Extraction',
  }),
  createAgent({
    id: 'debugger',
    name: 'debugger',
    badge: 'DG',
    status: 'error',
    currentTaskId: null,
    tokensUsed: 84000,
    avgLatencyMs: 512,
    successRate: 88.5,
    tasksCompleted: 98,
    activeBeam: false,
    model: 'o3-mini',
    role: 'Stacktrace Analyzer & Fixer',
  }),
  createAgent({
    id: 'jules',
    name: 'jules',
    badge: 'JL',
    status: 'running',
    currentTaskId: 'task-1028',
    tokensUsed: 312000,
    avgLatencyMs: 175,
    successRate: 95.8,
    tasksCompleted: 347,
    activeBeam: true,
    model: 'gemini-2.0',
    role: 'Google Async Coding Agent',
  }),
  createAgent({
    id: 'cursor',
    name: 'cursor',
    badge: 'CR',
    status: 'running',
    currentTaskId: 'task-1033',
    tokensUsed: 193000,
    avgLatencyMs: 88,
    successRate: 97.2,
    tasksCompleted: 274,
    activeBeam: true,
    model: 'claude-3-5-sonnet',
    role: 'AI-Powered Code Editor Agent',
  }),
];

const initialTasks: Task[] = [
  createTask({
    id: '1024',
    agentId: 'opencode',
    agentName: 'opencode',
    prompt: 'npm run build --production (Compiling TypeScript AST & bundle chunks)',
    status: 'running',
    priority: 1,
    latencyMs: 460,
    createdAt: '10:24:01',
    icon: 'terminal',
  }),
  createTask({
    id: '1025',
    agentId: 'researcher',
    agentName: 'researcher',
    prompt: 'Fetch https://api.data.com/v1 schema & parse OpenAPI 3.1 definitions',
    status: 'completed',
    priority: 5,
    latencyMs: 120,
    createdAt: '10:23:45',
    icon: 'globe',
  }),
  createTask({
    id: '1026',
    agentId: 'debugger',
    agentName: 'debugger',
    prompt: 'Cron sync database: trace goroutine lock contention in graph cache',
    status: 'failed',
    priority: 2,
    latencyMs: 890,
    createdAt: '10:23:12',
    icon: 'clock',
  }),
  createTask({
    id: '1027',
    agentId: 'opencode',
    agentName: 'opencode',
    prompt: 'Compile assets/css & synthesize reactive state slice for Swarm WS',
    status: 'pending',
    priority: 3,
    latencyMs: 0,
    createdAt: '10:24:10',
    icon: 'terminal',
  }),
  createTask({
    id: '1028',
    agentId: 'codex',
    agentName: 'codex',
    prompt: 'Execute tests /e2e: integration failover for provider fallback chain',
    status: 'running',
    priority: 2,
    latencyMs: 2100,
    createdAt: '10:24:05',
    icon: 'terminal',
  }),
  createTask({
    id: '1031',
    agentId: 'vibe',
    agentName: 'vibe',
    prompt: 'Refactor tailwind aesthetic: deploy deep cyber-dark theme with glowing borders',
    status: 'running',
    priority: 4,
    latencyMs: 85,
    createdAt: '10:24:08',
    icon: 'terminal',
  }),
  createTask({
    id: '1032',
    agentId: 'kilo',
    agentName: 'kilo',
    prompt: 'Optimize token packing cache for context window sliding',
    status: 'pending',
    priority: 6,
    latencyMs: 0,
    createdAt: '10:24:14',
    icon: 'clock',
  }),
  createTask({
    id: '1033',
    agentId: 'agy',
    agentName: 'agy',
    prompt: 'Coordinate autonomous multi-agent consensus across Swarm network',
    status: 'running',
    priority: 1,
    latencyMs: 245,
    createdAt: '10:24:02',
    icon: 'terminal',
  }),
];

const initialLogs: LogEntry[] = [
  { id: 'l1', timestamp: '10:22:39 mono', level: 'ERROR', agent: '@opencode', message: 'Epsir: ##3333 connect ddn failure on websocket channel' },
  { id: 'l2', timestamp: '10:22:39 mono', level: 'ERROR', agent: '@opencode', message: 'Dreet message white mono upstream pipe failed' },
  { id: 'l3', timestamp: '10:22:39 mono', level: 'DEBUG', agent: '@opencode', message: 'Dret message white recore-ing log session' },
  { id: 'l4', timestamp: '10:22:59 mono', level: 'INFO', agent: '@opencode', message: 'Castaeation cap conna/comoon initialize handshake' },
  { id: 'l5', timestamp: '10:22:59 mono', level: 'INFO', agent: '@opencode', message: 'Dreet message white mono verified peer tokens' },
  { id: 'l6', timestamp: '10:23:39 mono', level: 'DEBUG', agent: '@opencode', message: 'Dreet message white mono cache invalidated' },
  { id: 'l7', timestamp: '10:23:39 mono', level: 'INFO', agent: '@opencode', message: 'Dreet message white mono broadcast event 48' },
  { id: 'l8', timestamp: '10:24:00 mono', level: 'INFO', agent: '@opencode', message: 'Initializing multi-agent consensus network v2.4.0...' },
  { id: 'l9', timestamp: '10:24:01 mono', level: 'DEBUG', agent: '@codex', message: 'AST parse complete: processed 48 modules in 14ms' },
  { id: 'l10', timestamp: '10:24:02 mono', level: 'INFO', agent: '@agy', message: 'Particle beam connection established with orchestrator core' },
  { id: 'l11', timestamp: '10:24:03 mono', level: 'INFO', agent: '@vibe', message: 'Hot reload trigger received, compiling updated CSS shaders' },
  { id: 'l12', timestamp: '10:24:04 mono', level: 'WARN', agent: '@kilo', message: 'High token throughput detected on stream proxy (14.2k tok/sec)' },
  { id: 'l13', timestamp: '10:24:05 mono', level: 'DEBUG', agent: '@researcher', message: 'Vector memory index: 18 new embeddings stored in memory graph' },
  { id: 'l14', timestamp: '10:24:06 mono', level: 'ERROR', agent: '@debugger', message: 'Upstream connection reset on task #1026: timeout after 890ms' },
  { id: 'l15', timestamp: '10:24:07 mono', level: 'INFO', agent: '@grok', message: 'Formal verification proof generated: 0 invariants violated' },
  { id: 'l16', timestamp: '10:24:08 mono', level: 'DEBUG', agent: '@cline', message: 'Executing tool dispatch: git status --porcelain' },
  { id: 'l17', timestamp: '10:24:09 mono', level: 'INFO', agent: '@codex', message: 'Stream chunk flushed to client channel' },
  { id: 'l18', timestamp: '10:24:10 mono', level: 'DEBUG', agent: '@opencode', message: 'Routing queue shifted: task #1027 placed in pending queue' },
  { id: 'l19', timestamp: '10:24:11 mono', level: 'INFO', agent: '@agy', message: 'Consensus heartbeat broadcasted; 9 nodes reporting healthy' },
  { id: 'l20', timestamp: '10:24:39 mono', level: 'DEBUG', agent: '@opencode', message: 'Dreet message white mono' },
  { id: 'l21', timestamp: '10:24:39 mono', level: 'DEBUG', agent: '@opencode', message: 'Dreet message white mono' },
  { id: 'l22', timestamp: '10:24:39 mono', level: 'DEBUG', agent: '@opencode', message: 'Dreet message white mono' },
  { id: 'l23', timestamp: '10:24:39 mono', level: 'INFO', agent: '@opencode', message: 'Dreet message white mono' },
  { id: 'l24', timestamp: '10:24:39 mono', level: 'WARN', agent: '@opencode', message: 'Dreet message white mono' },
  { id: 'l25', timestamp: '10:24:39 mono', level: 'WARN', agent: '@opencode', message: 'Dreet message white contract 8885' },
  { id: 'l26', timestamp: '10:24:39 mono', level: 'INFO', agent: '@opencode', message: 'Dreet message white mono' },
  { id: 'l27', timestamp: '12:25:39 mono', level: 'DEBUG', agent: '@opencode', message: 'Task message white mono' },
  { id: 'l28', timestamp: '12:25:39 mono', level: 'INFO', agent: '@opencode', message: 'Create task...' },
  { id: 'l29', timestamp: '17:15:59 mono', level: 'INFO', agent: '@opencode', message: 'Created a mase-strint continus task' },
  { id: 'l30', timestamp: '17:15:59 mono', level: 'INFO', agent: '@opencode', message: 'Nase-na-message white mono' },
];

const initialProviders: Provider[] = [
  createProvider({ id: 'p1',  name: 'Groq',              apiKeyMasked: 'gsk_••••••g4Ty',        apiKey: '', latencyMs: 45,  health: 'green', enabled: true,  cooldownUntil: null }),
  createProvider({ id: 'p2',  name: 'Cerebras',          apiKeyMasked: 'csk-••••••2thv',        apiKey: '', latencyMs: 52,  health: 'green', enabled: true,  cooldownUntil: null }),
  createProvider({ id: 'p3',  name: 'Token Harbor',      apiKeyMasked: 'thk_live_••••QNa',      apiKey: '', latencyMs: 130, health: 'green', enabled: true,  cooldownUntil: null }),
  createProvider({ id: 'p4',  name: 'CodeCraft',         apiKeyMasked: 'cc_••••••kRWQH',        apiKey: '', latencyMs: 150, health: 'green', enabled: true,  cooldownUntil: null }),
  createProvider({ id: 'p5',  name: 'Pooled',            apiKeyMasked: 'poold_••••••39b',       apiKey: '', latencyMs: 140, health: 'green', enabled: true,  cooldownUntil: null }),
  createProvider({ id: 'p6',  name: 'AiHubMix',          apiKeyMasked: 'sk-mb••••••3f12',       apiKey: '', latencyMs: 160, health: 'green', enabled: true,  cooldownUntil: null }),
  createProvider({ id: 'p7',  name: 'Apertis',           apiKeyMasked: 'sk-Rj••••••0fD7',       apiKey: '', latencyMs: 175, health: 'green', enabled: true,  cooldownUntil: null }),
  createProvider({ id: 'p8',  name: 'Gemini',            apiKeyMasked: 'AQ.Ab••••••_qs',        apiKey: '', latencyMs: 180, health: 'green', enabled: true,  cooldownUntil: null }),
  createProvider({ id: 'p9',  name: 'Atessa',            apiKeyMasked: 'sk-proxy-••••4YM',      apiKey: '', latencyMs: 200, health: 'green', enabled: true,  cooldownUntil: null }),
  createProvider({ id: 'p10', name: 'AWS Bedrock',       apiKeyMasked: 'AKIA••••••KG4',         apiKey: '', latencyMs: 195, health: 'green', enabled: true,  cooldownUntil: null }),
  createProvider({ id: 'p11', name: 'Anthropic',         apiKeyMasked: '(not configured)',      apiKey: '', latencyMs: 145, health: 'amber', enabled: false, cooldownUntil: null }),
  createProvider({ id: 'p12', name: 'Dahl',              apiKeyMasked: 'dahl_••••••LSnJ',       apiKey: '', latencyMs: 190, health: 'green', enabled: true,  cooldownUntil: null }),
  createProvider({ id: 'p13', name: 'AnyAPI',            apiKeyMasked: 'sk-N-••••••WiQ',        apiKey: '', latencyMs: 165, health: 'green', enabled: true,  cooldownUntil: null }),
  createProvider({ id: 'p14', name: 'OpenRouter',        apiKeyMasked: 'sk-or-v1-••••f44',      apiKey: '', latencyMs: 220, health: 'green', enabled: true,  cooldownUntil: null }),
  createProvider({ id: 'p15', name: 'APMix',             apiKeyMasked: 'apx_live_••••jnm',      apiKey: '', latencyMs: 210, health: 'green', enabled: true,  cooldownUntil: null }),
  createProvider({ id: 'p16', name: 'Cohere',            apiKeyMasked: 'jLcz••••••Loc',         apiKey: '', latencyMs: 240, health: 'green', enabled: true,  cooldownUntil: null }),
  createProvider({ id: 'p17', name: 'Mistral',           apiKeyMasked: 'Dh6U••••••IhU',         apiKey: '', latencyMs: 280, health: 'green', enabled: true,  cooldownUntil: null }),
  createProvider({ id: 'p18', name: 'Alibaba DashScope', apiKeyMasked: 'sk-ws-H.••••ZcA',       apiKey: '', latencyMs: 250, health: 'green', enabled: true,  cooldownUntil: null }),
  createProvider({ id: 'p19', name: 'OpenAI',            apiKeyMasked: '(not configured)',      apiKey: '', latencyMs: 210, health: 'amber', enabled: false, cooldownUntil: null }),
  createProvider({ id: 'p20', name: 'xAI / Grok',        apiKeyMasked: '(not configured)',      apiKey: '', latencyMs: 310, health: 'amber', enabled: false, cooldownUntil: null }),
  createProvider({ id: 'p21', name: 'AI Horde',          apiKeyMasked: '0000••••0000',          apiKey: '', latencyMs: 450, health: 'amber', enabled: true,  cooldownUntil: null }),
];

const initialRoutingRules: RoutingRule[] = [];

const initialSystemStats: SystemStats = {
  agentsCount: 9,
  runningCount: 4,
  tasksToday: 127,
  avgLatencyMs: 280,
  cpuUsage: '1,008',
  memory: '#5000beB',
  uptime: '1113x hax',
};

const initialTelemetryStats: TelemetryStats = {
  eventsPerSec: '6.1k',
  eventsHistory: [18, 24, 20, 36, 52, 38, 29, 22, 45, 34, 40, 58, 48, 62, 55, 68],
  errorRate: '0.3%',
  errorRateHistory: [1.6, 1.2, 0.5, 0.4, 0.3, 0.8, 0.4, 0.3, 0.3, 0.6, 0.3],
  topAgents: [
    { name: 'opencode', percentage: '33%' },
    { name: 'opencode', percentage: '35%' },
    { name: 'kilo', percentage: '18%' },
    { name: 'agy', percentage: '14%' },
  ],
  topErrors: [
    { name: 'opencode', count: 444 },
    { name: 'debugger', count: 32 },
  ],
};

const initialAgentConfig: AgentConfig = {
  name: 'Stark Industries — Ultron',
  enabled: true,
  maxConcurrentTasks: 8,
  preferredProviderOverride: false,
};

// ============================================================================
// Simulation Engine & WebSocket Client Implementations
// ============================================================================

const simulatedLogPool = [
  { agent: 'opencode', level: 'INFO' as LogLevel, message: 'AST transformer synthesized type definitions for schema' },
  { agent: 'codex', level: 'DEBUG' as LogLevel, message: 'Code sandbox execution: verified 24/24 unit test assertions' },
  { agent: 'vibe', level: 'INFO' as LogLevel, message: 'Component hot-reload compiled in 28ms; CSS styles injected' },
  { agent: 'agy', level: 'INFO' as LogLevel, message: 'Consensus broadcasted across swarm peers; epoch #492 verified' },
  { agent: 'grok', level: 'DEBUG' as LogLevel, message: 'Evaluating fallback branch conditions for high-traffic provider' },
  { agent: 'kilo', level: 'INFO' as LogLevel, message: 'Token optimizer reduced prompt context length by 18.4%' },
  { agent: 'cline', level: 'INFO' as LogLevel, message: 'Executing tool dispatch: /usr/local/bin/antigravity --status' },
  { agent: 'researcher', level: 'DEBUG' as LogLevel, message: 'Vector index updated: 14 new embeddings stored in memory graph' },
  { agent: 'debugger', level: 'WARN' as LogLevel, message: 'Network retry 1/3 on upstream proxy connection' },
  { agent: 'opencode', level: 'INFO' as LogLevel, message: 'Routing queue shifted: task placed in worker pipeline' },
  { agent: 'agy', level: 'DEBUG' as LogLevel, message: 'Beam ping acknowledge packet returned with 0.4ms RTT' },
  { agent: 'codex', level: 'INFO' as LogLevel, message: 'Stream chunk flushed to client channel' },
];

const newPromptPool = [
  'Validate zero-copy streaming buffers in proxy pipeline',
  'Compile WebAssembly runtime sandbox for isolated execution',
  'Index codebase symbol references for semantic code search',
  'Rebalance provider traffic weights based on SLA latency',
  'Verify cryptographic signatures on distributed agent payloads',
  'Auto-generate OpenAPI client SDK bindings for multi-cli',
  'Synthesize reactive state slice for Swarm WebSocket events',
  'Benchmark token throughput across Anthropic, Bedrock, and OpenAI',
];

class SwarmSimulator {
  private logTimer: ReturnType<typeof setInterval> | null = null;
  private taskTimer: ReturnType<typeof setInterval> | null = null;
  private beamTimer: ReturnType<typeof setInterval> | null = null;
  private isRunning: boolean = false;
  private batcher: FrameBatcher<SwarmStore>;

  constructor(batcher: FrameBatcher<SwarmStore>) {
    this.batcher = batcher;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // 1. Periodic log stream (every 2.2s)
    this.logTimer = setInterval(() => {
      if (!this.isRunning) return;
      const template = simulatedLogPool[Math.floor(Math.random() * simulatedLogPool.length)];
      const logEntry: LogEntry = {
        id: generateId('log'),
        timestamp: formatTimestamp(),
        level: template.level,
        agent: template.agent,
        message: template.message,
      };

      this.batcher.enqueue((state) => ({
        logs: [...state.logs, logEntry].slice(-300),
      }));
    }, 2200);

    // 2. Task lifecycle transitions (every 3.6s)
    this.taskTimer = setInterval(() => {
      if (!this.isRunning) return;

      this.batcher.enqueue((state) => {
        const tasks = [...state.tasks];
        const agents = [...state.agents];
        let runningCount = state.systemStats.runningCount;
        let tasksToday = state.systemStats.tasksToday;

        // Transition a running task to completed or failed
        const runningIdx = tasks.findIndex((t) => t.status === 'running');
        if (runningIdx !== -1) {
          const task = tasks[runningIdx];
          const isSuccess = Math.random() > 0.12; // 88% success rate
          const updatedStatus: TaskStatus = isSuccess ? 'completed' : 'failed';
          const latency = 160 + Math.floor(Math.random() * 340);

          tasks[runningIdx] = {
            ...task,
            status: updatedStatus,
            latencyMs: latency,
            latency: `${latency}ms`,
            completedAt: formatTimestamp(),
          };

          tasksToday += 1;

          // Update assigned agent stats
          const agentIdx = agents.findIndex((a) => a.id === task.agentId);
          if (agentIdx !== -1) {
            const ag = agents[agentIdx];
            const newTasksCompleted = ag.tasksCompleted + (isSuccess ? 1 : 0);
            const newTokensUsed = ag.tokensUsed + 420 + Math.floor(Math.random() * 650);
            agents[agentIdx] = createAgent({
              ...ag,
              status: 'idle',
              currentTaskId: null,
              tasksCompleted: newTasksCompleted,
              tokensUsed: newTokensUsed,
              activeBeam: false,
            });
          }
        }

        // Start a pending task
        const pendingIdx = tasks.findIndex((t) => t.status === 'pending');
        if (pendingIdx !== -1) {
          const task = tasks[pendingIdx];
          const idleAgent = agents.find((a) => a.status === 'idle') || agents[0];

          tasks[pendingIdx] = {
            ...task,
            agentId: idleAgent.id,
            agent: { id: idleAgent.id, name: idleAgent.name },
            status: 'running',
            latencyMs: 50,
            latency: '50ms',
          };

          const idleIdx = agents.findIndex((a) => a.id === idleAgent.id);
          if (idleIdx !== -1) {
            agents[idleIdx] = createAgent({
              ...idleAgent,
              status: 'running',
              currentTaskId: task.id,
              activeBeam: true,
            });
          }
        }

        // Maintain task queue depth
        const pendingCount = tasks.filter((t) => t.status === 'pending').length;
        if (pendingCount < 3) {
          const prompt = newPromptPool[Math.floor(Math.random() * newPromptPool.length)];
          const targetAgent = agents[Math.floor(Math.random() * agents.length)];
          const newTask = createTask({
            id: String(1040 + Math.floor(Math.random() * 9000)),
            agentId: targetAgent.id,
            agentName: targetAgent.name,
            prompt,
            status: 'pending',
            priority: 1 + Math.floor(Math.random() * 9),
            latencyMs: 0,
            createdAt: formatTimestamp(),
            icon: Math.random() > 0.5 ? 'terminal' : 'clock',
          });
          tasks.unshift(newTask);
        }

        runningCount = tasks.filter((t) => t.status === 'running').length;

        return {
          tasks,
          agents,
          systemStats: {
            ...state.systemStats,
            runningCount,
            tasksToday,
          },
        };
      });
    }, 3600);

    // 3. Particle beam pings & subtle latency jitter (every 2.4s)
    this.beamTimer = setInterval(() => {
      if (!this.isRunning) return;

      this.batcher.enqueue((state) => {
        const agents = [...state.agents];
        const runningAgents = agents.filter((a) => a.status === 'running');
        if (runningAgents.length === 0) return {};

        const targetAgent = runningAgents[Math.floor(Math.random() * runningAgents.length)];
        const agentIdx = agents.findIndex((a) => a.id === targetAgent.id);

        if (agentIdx !== -1) {
          agents[agentIdx] = {
            ...agents[agentIdx],
            activeBeamConnection: {
              active: true,
              target: 'orchestrator-core',
              intensity: 1.0,
              lastPing: Date.now(),
            },
            activeBeam: true,
          };
        }

        const jitter = Math.floor(Math.random() * 11) - 5; // ±5ms jitter
        const newLatency = Math.max(180, Math.min(380, state.systemStats.avgLatencyMs + jitter));

        return {
          agents,
          systemStats: {
            ...state.systemStats,
            avgLatencyMs: newLatency,
          },
        };
      });
    }, 2400);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.logTimer) {
      clearInterval(this.logTimer);
      this.logTimer = null;
    }
    if (this.taskTimer) {
      clearInterval(this.taskTimer);
      this.taskTimer = null;
    }
    if (this.beamTimer) {
      clearInterval(this.beamTimer);
      this.beamTimer = null;
    }
  }

  public isSimulating(): boolean {
    return this.isRunning;
  }
}

class SwarmWebSocketEngine {
  private ws: WebSocket | null = null;
  private url: string = 'ws://localhost:8080/ws';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay: number = 3000;
  private isExplicitlyClosed: boolean = false;
  private batcher: FrameBatcher<SwarmStore>;
  private simulator: SwarmSimulator;
  private setStoreStatus: (status: WsConnectionStatus) => void;

  constructor(
    batcher: FrameBatcher<SwarmStore>,
    simulator: SwarmSimulator,
    setStoreStatus: (status: WsConnectionStatus) => void
  ) {
    this.batcher = batcher;
    this.simulator = simulator;
    this.setStoreStatus = setStoreStatus;
  }

  public connect(url: string = 'ws://localhost:8080/ws'): void {
    this.url = url;
    this.isExplicitlyClosed = false;

    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') {
      this.setStoreStatus('simulated');
      this.simulator.start();
      return;
    }

    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.setStoreStatus('connecting');

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.reconnectDelay = 3000;
        this.setStoreStatus('connected');

        // Real backend connected: yield simulation
        this.simulator.stop();

        this.batcher.enqueue((state) => ({
          isSimulating: false,
          logs: [
            ...state.logs,
            {
              id: generateId('ws-log'),
              timestamp: formatTimestamp(),
              level: 'INFO' as LogLevel,
              agent: 'system',
              message: `WebSocket connected to Swarm Hub at ${this.url}`,
            },
          ].slice(-300),
        }));

        // Fetch real provider health from /health and update provider list.
        const baseURL = this.url.replace(/^ws/, 'http').replace('/ws', '');
        fetch(`${baseURL}/health`)
          .then((r) => r.ok ? r.json() : null)
          .then((data) => {
            if (!data || !Array.isArray(data.chain)) return;
            // Mark providers in the chain as green; others amber.
            const chain: string[] = data.chain as string[];
            this.batcher.enqueue((state) => ({
              providers: state.providers.map((p) => ({
                ...p,
                health: chain.some((name) =>
                    p.name.toLowerCase().includes(name.toLowerCase()) ||
                    name.toLowerCase().includes(p.name.toLowerCase())
                  ) ? 'green' as const : p.health,
              })),
              systemStats: {
                ...state.systemStats,
                agentsCount: data.providers ?? state.systemStats.agentsCount,
              },
            }));
          })
          .catch(() => {});

        // Fetch real provider list from /api/providers
        fetch(`${baseURL}/api/providers`)
          .then((r) => r.ok ? r.json() : null)
          .then((data) => {
            if (!data || !Array.isArray(data.providers)) return;
            const realProviders: Array<{ name: string; base_url: string; status: string }> = data.providers;
            this.batcher.enqueue((state) => ({
              providers: state.providers.map((p) => {
                const match = realProviders.find(
                  (rp) => p.name.toLowerCase().includes(rp.name.toLowerCase()) ||
                          rp.name.toLowerCase().includes(p.name.toLowerCase())
                );
                if (match) {
                  return { ...p, health: match.status === 'active' ? 'green' as const : 'amber' as const };
                }
                return p;
              }),
            }));
          })
          .catch(() => {});

        // Fetch real agent status from /api/agents/status
        fetch(`${baseURL}/api/agents/status`)
          .then((r) => r.ok ? r.json() : null)
          .then((data) => {
            if (!data) return;
            const agentList = Array.isArray(data) ? data : data.agents;
            if (Array.isArray(agentList)) {
              this.batcher.enqueue((state) => ({
                agents: state.agents.map((ag) => {
                  const match = agentList.find((a: any) => a.id === ag.id);
                  if (match && match.status) {
                    const status = match.status === 'running' ? 'running' as const : 'idle' as const;
                    return { ...ag, status };
                  }
                  return ag;
                }),
              }));
            }
          })
          .catch(() => {});

        // Fetch routing rules from /api/routing/rules
        fetch(`${baseURL}/api/routing/rules`)
          .then((r) => r.ok ? r.json() : null)
          .then((rules) => {
            if (Array.isArray(rules) && rules.length > 0) {
              const mapped: RoutingRule[] = rules.map((r: any) => {
                let field = 'task_type';
                let operator = 'contains';
                let val = r.condition || '';
                if (val.includes(':')) {
                  const parts = val.split(':');
                  field = parts[0] || 'task_type';
                  operator = parts[1] || 'contains';
                  val = parts.slice(2).join(':') || '';
                }
                return {
                  id: r.id,
                  field,
                  operator,
                  value: val,
                  targetAgent: r.target_provider || 'opencode',
                  model: 'claude-3-5-sonnet',
                  priority: r.priority || 5,
                  enabled: true,
                };
              });
              this.batcher.enqueue(() => ({ routingRules: mapped }));
            }
          })
          .catch(() => {});

        // Fetch real tasks from /api/tasks on connect
        fetch(`${baseURL}/api/tasks`)
          .then((r) => r.ok ? r.json() : null)
          .then((data) => {
            if (Array.isArray(data) && data.length > 0) {
              this.batcher.enqueue(() => ({ tasks: data }));
            }
          })
          .catch((e) => console.error('fetchInitialTasks:', e));
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          this.handleInboundMessage(data);
        } catch {
          // Plain text message stream fallback
          this.batcher.enqueue((state) => ({
            logs: [
              ...state.logs,
              {
                id: generateId('ws-text'),
                timestamp: formatTimestamp(),
                level: 'INFO' as LogLevel,
                agent: 'hub',
                message: String(event.data),
              },
            ].slice(-300),
          }));
        }
      };

      this.ws.onerror = () => {
        // Quiet fallback to simulation mode without throwing uncaught errors
        this.fallbackToSimulation();
      };

      this.ws.onclose = () => {
        this.ws = null;
        if (!this.isExplicitlyClosed) {
          this.fallbackToSimulation();
          this.scheduleReconnect();
        }
      };
    } catch {
      this.fallbackToSimulation();
      this.scheduleReconnect();
    }
  }

  private fallbackToSimulation(): void {
    this.setStoreStatus('simulated');
    this.simulator.start();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.isExplicitlyClosed) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isExplicitlyClosed) {
        this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 10000);
        this.connect(this.url);
      }
    }, this.reconnectDelay);
  }

  private handleInboundMessage(payload: Record<string, unknown>): void {
    if (!payload || typeof payload !== 'object') return;

    this.batcher.enqueue((state) => {
      const type = payload.type || payload.event;

      if (type === 'init' && payload.data && typeof payload.data === 'object') {
        const d = payload.data as Partial<SwarmStore>;
        return {
          agents: d.agents || state.agents,
          tasks: d.tasks || state.tasks,
          providers: d.providers || state.providers,
          systemStats: d.systemStats ? { ...state.systemStats, ...d.systemStats } : state.systemStats,
        };
      }

      if (type === 'agent_update') {
        const update = ((payload.agent || payload) as unknown) as Partial<Agent> & { id: string };
        if (update && update.id) {
          const agents = state.agents.map((a) => (a.id === update.id ? { ...a, ...update } : a));
          return { agents };
        }
      }

      if (type === 'task_update') {
        const raw = (payload.task || payload) as Record<string, unknown>;
        const id = (raw.id || payload.id) as string;
        if (id) {
          const rawStatus = (raw.status || payload.status) as string;
          const status: TaskStatus = rawStatus === 'cancelled' ? 'failed' : ((rawStatus as TaskStatus) || 'failed');
          const tasks = state.tasks.map((t) => (t.id === id ? { ...t, ...raw, status } : t));
          return { tasks };
        }
      }

      if (type === 'task_created') {
        const t = (payload.task || payload) as Record<string, unknown>;
        const id = String(t.id || (1050 + Math.floor(Math.random() * 8000)));
        const existing = state.tasks.find((task) => task.id === id);
        if (existing) {
          return {};
        }
        const newTask = createTask({
          id,
          agentId: (t.agentId as string) || 'opencode',
          agentName: (t.agentId as string) || 'opencode',
          prompt: (t.prompt as string) || '',
          status: ((t.status as TaskStatus) || 'pending'),
          priority: (t.priority as number) ?? 5,
          latencyMs: 0,
          createdAt: formatTimestamp(),
        });
        return { tasks: [newTask, ...state.tasks] };
      }

      if (type === 'log' && payload.log && typeof payload.log === 'object') {
        const entry = payload.log as LogEntry;
        return { logs: [...state.logs, entry].slice(-300) };
      }

      // Streaming CLI output from RunStreaming — keyed by task_id
      if (type === 'log' && payload.task_id !== undefined) {
        const taskId = payload.task_id as string;
        const logLine: LogLine = {
          agentId: (payload.agent_id as string) || '',
          stream: (payload.stream as 'stdout' | 'stderr') || 'stdout',
          line: (payload.line as string) || '',
          ts: (payload.ts as number) || Date.now(),
        };
        const prev = state.logsByTask[taskId] || [];
        return {
          logsByTask: {
            ...state.logsByTask,
            [taskId]: [...prev, logLine].slice(-500),
          },
          // Auto-select the first task that starts streaming
          selectedLogTaskId: state.selectedLogTaskId ?? taskId,
        };
      }

      if (type === 'stats' && payload.stats && typeof payload.stats === 'object') {
        const s = payload.stats as Partial<SystemStats>;
        return { systemStats: { ...state.systemStats, ...s } };
      }

      if (type === 'feedback_recorded') {
        const taskId = (payload.task_id as string) ?? '';
        return {
          logs: [
            ...state.logs,
            {
              id: generateId('feedback'),
              timestamp: formatTimestamp(),
              level: 'INFO' as LogLevel,
              agent: 'system',
              message: `Feedback recorded${taskId ? ` for task ${taskId}` : ''}`,
            },
          ].slice(-300),
        };
      }

      if (type === 'memory_updated') {
        return {
          lastMemoryEvent: {
            type: 'memory_updated',
            action: (payload.action as string) || 'upsert',
            node: payload.node,
            episode: payload.episode,
            id: (payload.id as string) || (payload.node as any)?.id,
            timestamp: Date.now(),
          },
          memoryRevision: (state.memoryRevision || 0) + 1,
        };
      }

      return {};
    });
  }

  public send(message: unknown): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(typeof message === 'string' ? message : JSON.stringify(message));
      return true;
    }
    return false;
  }

  public disconnect(): void {
    this.isExplicitlyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStoreStatus('disconnected');
  }
}

// ============================================================================
// Zustand Store Definition
// ============================================================================

export const useSwarmStore = create<SwarmStore>((set, get) => {
  // Initialize FrameBatcher (60Hz RAF state coalescing)
  const batcher = new FrameBatcher<SwarmStore>((updater) => set(updater));

  // Initialize Simulator and WebSocket engine
  const simulator = new SwarmSimulator(batcher);
  const wsEngine = new SwarmWebSocketEngine(
    batcher,
    simulator,
    (status: WsConnectionStatus) => set({ wsStatus: status })
  );

  // Automatically kick off initial live simulation and WS connection attempt
  if (typeof window !== 'undefined') {
    simulator.start();
    wsEngine.connect('ws://localhost:8080/ws');
  }

  return {
    // Initial State
    agents: initialAgents,
    tasks: initialTasks,
    logs: initialLogs,
    providers: initialProviders,
    routingRules: (() => {
      try {
        const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('ultron_routingRules') : null;
        return saved ? JSON.parse(saved) : initialRoutingRules;
      } catch { return initialRoutingRules; }
    })(),
    systemStats: initialSystemStats,
    telemetry: initialTelemetryStats,
    agentConfig: initialAgentConfig,
    selectedTaskId: '1024',
    selectedAgentId: (typeof localStorage !== 'undefined' ? localStorage.getItem('ultron_selectedAgent') : null) ?? 'opencode',
    activeViewFilter: 'ALL',
    wsStatus: 'simulated',
    isSimulating: true,
    isConnected: false,

    // Streaming log initial state
    logsByTask: {},
    selectedLogTaskId: null,

    // Memory Cortex initial state
    lastMemoryEvent: null,
    memoryRevision: 0,

    // Selection & Filter Actions
    setSelectedAgentId: (id: string | null) => {
      if (typeof localStorage !== 'undefined' && id) localStorage.setItem('ultron_selectedAgent', id);
      set({ selectedAgentId: id });
    },
    setSelectedAgent: (id: string | null) => {
      if (typeof localStorage !== 'undefined' && id) localStorage.setItem('ultron_selectedAgent', id);
      set({ selectedAgentId: id });
    },
    setSelectedTaskId: (id: string | null) => set({ selectedTaskId: id }),
    setActiveViewFilter: (filter: ViewFilter) => set({ activeViewFilter: filter }),
    setFilter: (filter: ViewFilter) => set({ activeViewFilter: filter }),

    // Log Actions
    addLog: (entry) =>
      set((state) => ({
        logs: [
          ...state.logs,
          {
            id: entry.id || generateId('log'),
            timestamp: entry.timestamp || formatTimestamp(),
            level: entry.level,
            agent: entry.agent,
            message: entry.message,
          },
        ].slice(-300),
      })),
    clearLogs: () => set({ logs: [] }),

    // Actions - Streaming logs (per-task CLI output)
    addLogLine: (taskId: string, line: LogLine) =>
      set((state) => {
        const prev = state.logsByTask[taskId] || [];
        return {
          logsByTask: {
            ...state.logsByTask,
            [taskId]: [...prev, line].slice(-500),
          },
          selectedLogTaskId: state.selectedLogTaskId ?? taskId,
        };
      }),
    getLogsForTask: (taskId: string) => {
      return get().logsByTask[taskId] || [];
    },
    setSelectedLogTaskId: (id: string | null) => set({ selectedLogTaskId: id }),

    // Task Actions
    addTask: (task) => {
      const id = task.id || String(1050 + Math.floor(Math.random() * 8000));
      const agentId = task.agentId || 'opencode';
      const fullTask = createTask({
        id,
        agentId,
        agentName: task.agent?.name || agentId,
        prompt: task.prompt,
        status: task.status || 'pending',
        priority: task.priority ?? 5,
        latencyMs: task.latencyMs ?? 0,
        createdAt: task.createdAt || formatTimestamp(),
        icon: task.icon || 'terminal',
      });
      set((state) => ({ tasks: [fullTask, ...state.tasks] }));

      // Persist task to backend queue
      fetch('http://localhost:8080/api/tasks/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          agentId,
          prompt: task.prompt,
          priority: task.priority ?? 5,
          type: 'prompt',
        }),
      }).catch(() => {});
    },

    updateTask: (id: string, updates: Partial<Task>) =>
      set((state) => ({
        tasks: state.tasks.map((t) => {
          if (t.id !== id) return t;
          const merged = { ...t, ...updates };
          if (updates.prompt && !updates.preview) merged.preview = updates.prompt;
          if (updates.latencyMs !== undefined && !updates.latency) {
            merged.latency = updates.latencyMs > 0 ? `${updates.latencyMs}ms` : '--';
          }
          return merged;
        }),
      })),

    removeTask: (id: string) =>
      set((state) => ({
        tasks: state.tasks.filter((t) => t.id !== id),
      })),

    setTasks: (tasks: Task[]) => set({ tasks }),

    cancelTask: async (id: string) => {
      // Optimistic local update
      get().updateTask(id, { status: 'failed' });
      get().addLog({
        level: 'WARN',
        agent: 'orchestrator',
        message: `Dispatched cancel signal for task #${id}`,
      });

      try {
        const res = await fetch(`http://localhost:8080/api/tasks/${encodeURIComponent(id)}/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (res.ok) {
          const data = await res.json();
          return !!data.ok;
        }
      } catch {
        // Backend unavailable; local cancellation remains
      }
      return false;
    },

    retryTask: async (id: string) => {
      const task = get().tasks.find((t) => t.id === id);
      if (!task) return null;

      get().addLog({
        level: 'INFO',
        agent: 'orchestrator',
        message: `Retrying task #${id}: "${task.prompt.slice(0, 30)}..."`,
      });

      try {
        const res = await fetch(`http://localhost:8080/api/tasks/${encodeURIComponent(id)}/retry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.new_task_id) {
            const newTask = createTask({
              id: data.new_task_id,
              agentId: task.agentId,
              agentName: task.agent?.name || task.agentId,
              prompt: task.prompt,
              status: 'pending',
              priority: task.priority,
              latencyMs: 0,
              createdAt: formatTimestamp(),
            });
            set((state) => ({ tasks: [newTask, ...state.tasks.filter((t) => t.id !== data.new_task_id)] }));
            return data.new_task_id;
          }
        }
      } catch {
        // Local fallback retry
      }

      const fallbackId = String(1050 + Math.floor(Math.random() * 8000));
      get().addTask({
        id: fallbackId,
        agentId: task.agentId,
        prompt: task.prompt,
        priority: task.priority,
        status: 'pending',
      });
      return fallbackId;
    },

    // Agent Actions
    updateAgent: (id: string, updates: Partial<Agent>) =>
      set((state) => ({
        agents: state.agents.map((a) => {
          if (a.id !== id) return a;
          const merged = { ...a, ...updates };
          if (updates.currentTaskId !== undefined) merged.taskId = updates.currentTaskId;
          if (updates.avgLatencyMs !== undefined) {
            merged.avgLatency = updates.avgLatencyMs;
            merged.latency = `${updates.avgLatencyMs}ms`;
          }
          if (updates.tasksCompleted !== undefined) merged.tasks = updates.tasksCompleted;
          if (updates.metrics) {
            merged.metrics = { ...a.metrics, ...updates.metrics } as AgentMetrics;
          }
          return merged;
        }),
      })),

    setAgents: (agents: Agent[]) => set({ agents }),

    triggerBeamPing: (agentId: string, intensity: number = 1.0) =>
      set((state) => ({
        agents: state.agents.map((a) =>
          a.id === agentId
            ? {
                ...a,
                activeBeamConnection: {
                  active: true,
                  target: 'orchestrator-core',
                  intensity,
                  lastPing: Date.now(),
                },
                activeBeam: true,
              }
            : a
        ),
      })),

    fetchAgents: async () => {
      try {
        const res = await fetch('http://localhost:8080/api/agents/status');
        if (res.ok) {
          const data = await res.json();
          const list = Array.isArray(data) ? data : data.agents;
          if (Array.isArray(list)) {
            set((state) => ({
              agents: state.agents.map((ag) => {
                const match = list.find((a: any) => a.id === ag.id);
                if (match && match.status) {
                  return {
                    ...ag,
                    status: match.status === 'running' ? 'running' : 'idle',
                  };
                }
                return ag;
              }),
            }));
          }
        }
      } catch {}
    },

    // Provider Actions
    updateProvider: (id: string, updates: Partial<Provider>) =>
      set((state) => ({
        providers: state.providers.map((p) => {
          if (p.id !== id) return p;
          const merged = { ...p, ...updates };
          if (updates.latencyMs !== undefined && updates.latency === undefined) {
            merged.latency = updates.latencyMs;
          }
          return merged;
        }),
      })),

    setProviders: (providers: Provider[]) => set({ providers }),

    // Config Actions
    setAgentConfig: (config: Partial<AgentConfig>) =>
      set((state) => ({
        agentConfig: { ...state.agentConfig, ...config },
      })),

    // Routing Rules Actions
    addRoutingRule: (rule: RoutingRule) =>
      set((state) => {
        const fullRule: RoutingRule = {
          ...rule,
          id: rule.id || generateId('rule'),
          action: rule.action || 'route_to',
          actionTarget: rule.actionTarget || rule.targetAgent || 'opencode',
          targetAgent: rule.targetAgent || rule.actionTarget || 'opencode',
          model: rule.model || 'claude-3-5-sonnet',
          priority: rule.priority ?? 5,
          enabled: rule.enabled ?? true,
        };
        const next = [...state.routingRules, fullRule];
        try { localStorage.setItem('ultron_routingRules', JSON.stringify(next)); } catch {}

        // Persist to backend routing rules API
        fetch('http://localhost:8080/api/routing/rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `${fullRule.field} ${fullRule.operator} ${fullRule.value}`,
            condition: `${fullRule.field}:${fullRule.operator}:${fullRule.value}`,
            target_provider: fullRule.targetAgent || fullRule.model,
            priority: fullRule.priority,
          }),
        }).catch(() => {});

        return { routingRules: next };
      }),

    updateRoutingRule: (id: string, rule: Partial<RoutingRule>) =>
      set((state) => {
        const next = state.routingRules.map((r) => {
          if (r.id !== id) return r;
          const merged = { ...r, ...rule };
          if (rule.targetAgent && !rule.actionTarget) merged.actionTarget = rule.targetAgent;
          if (rule.actionTarget && !rule.targetAgent) merged.targetAgent = rule.actionTarget;
          return merged;
        });
        try { localStorage.setItem('ultron_routingRules', JSON.stringify(next)); } catch {}
        return { routingRules: next };
      }),

    deleteRoutingRule: (id: string) =>
      set((state) => {
        const next = state.routingRules.filter((r) => r.id !== id);
        try { localStorage.setItem('ultron_routingRules', JSON.stringify(next)); } catch {}

        // Delete from backend routing rules API
        fetch(`http://localhost:8080/api/routing/rules/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        }).catch(() => {});

        return { routingRules: next };
      }),

    setRoutingRules: (rules: RoutingRule[]) => {
      try { localStorage.setItem('ultron_routingRules', JSON.stringify(rules)); } catch {}
      set({ routingRules: rules });
    },

    fetchRoutingRules: async () => {
      try {
        const res = await fetch('http://localhost:8080/api/routing/rules');
        if (res.ok) {
          const rules = await res.json();
          if (Array.isArray(rules) && rules.length > 0) {
            const mapped: RoutingRule[] = rules.map((r: any) => {
              let field = 'task_type';
              let operator = 'contains';
              let val = r.condition || '';
              if (val.includes(':')) {
                const parts = val.split(':');
                field = parts[0] || 'task_type';
                operator = parts[1] || 'contains';
                val = parts.slice(2).join(':') || '';
              }
              return {
                id: r.id,
                field,
                operator,
                value: val,
                targetAgent: r.target_provider || 'opencode',
                model: 'claude-3-5-sonnet',
                priority: r.priority || 5,
                enabled: true,
              };
            });
            set({ routingRules: mapped });
          }
        }
      } catch {}
    },

    fetchLogs: async (taskId?: string) => {
      try {
        const url = taskId
          ? `http://localhost:8080/api/logs?task_id=${encodeURIComponent(taskId)}&limit=100`
          : 'http://localhost:8080/api/logs?limit=100';
        const res = await fetch(url);
        if (res.ok) {
          const entries = await res.json();
          if (Array.isArray(entries)) {
            const mapped: LogEntry[] = entries.map((e: any, i: number) => ({
              id: `api-log-${e.ts || Date.now()}-${i}`,
              timestamp: formatTimestamp(new Date(e.ts || Date.now())),
              level: (e.stream === 'stderr' ? 'WARN' : 'INFO') as LogLevel,
              agent: e.agent_id || 'system',
              message: e.line || '',
            }));
            if (mapped.length > 0) {
              set((state) => ({ logs: [...state.logs, ...mapped].slice(-400) }));
            }
            return mapped;
          }
        }
      } catch {}
      return [];
    },

    // Telemetry & Stats Actions
    updateSystemStats: (updates: Partial<SystemStats>) =>
      set((state) => ({
        systemStats: { ...state.systemStats, ...updates },
      })),

    updateTelemetry: (updates: Partial<TelemetryStats>) =>
      set((state) => ({
        telemetry: { ...state.telemetry, ...updates },
      })),

    // Engine Controls
    toggleSimulation: (enabled?: boolean) => {
      const current = get().isSimulating;
      const target = enabled !== undefined ? enabled : !current;
      if (target) {
        simulator.start();
      } else {
        simulator.stop();
      }
      set({ isSimulating: target });
    },

    connectWebSocket: (url?: string) => {
      wsEngine.connect(url);
    },

    disconnectWebSocket: () => {
      wsEngine.disconnect();
    },

    sendWsMessage: (message: unknown) => {
      return wsEngine.send(message);
    },

    setWsStatus: (status: WsConnectionStatus) => set({
      wsStatus: status,
      isConnected: status === 'connected',
    }),
  };
});

export default useSwarmStore;
