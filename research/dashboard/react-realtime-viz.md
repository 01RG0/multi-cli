# Real-Time AI Agent Orchestrator Dashboard

*Source: Claude deep-research agent (web)*

## Recommended Core Stack

| Role | Library | Stars |
|---|---|---|
| Task flow graph | React Flow (@xyflow/react) | 38,500 |
| Neural network overlay | Cosmos.gl | 1,300 |
| Force graph (simpler alt) | react-force-graph | 3,300 |
| Dashboard components | Tremor | 15,000 |
| UI primitives | shadcn/ui | ~80,000 |
| State management | Zustand | 58,700 |
| WebSocket hook | react-use-websocket | — |
| Drag-and-drop queue | dnd-kit | ~12,000 |

---

## Reference AI Agent Dashboards

| Repo | Stars | Notes |
|---|---|---|
| [openclaw-mission-control](https://github.com/abhi1693/openclaw-mission-control) | 4,100 | Most architecturally relevant — AI agent orchestration dashboard |
| [Hermes-Studio](https://github.com/JPeetz/Hermes-Studio) | 356 | React + TanStack, SSE streaming, force-directed knowledge graph (pure SVG) |
| [Agentglass](https://github.com/SirAllap/agentglass) | 327 | Multi-provider monitoring, "Cockpit" view, React + Bun + SQLite + Electron |
| [Agentlytics](https://github.com/f/agentlytics) | 581 | Cost/token/tool-call analytics across providers |

---

## React Flow (@xyflow/react)

**GitHub:** https://github.com/xyflow/xyflow — 38,500 stars, MIT

- SVG/HTML rendering → CSS applies directly → glow via `box-shadow`
- Custom node components (full React, local state, WS-driven updates)
- Animated edges via SVG `stroke-dashoffset` keyframes
- Layout algorithms: dagre (DAG), D3-force (organic), ELK
- Dark mode: `colorMode="dark"` prop
- Limit: ~500–2,000 nodes (irrelevant for agent flows)

**Glow CSS:**
```css
.agent-node[data-active="true"] {
  box-shadow: 0 0 8px #00f5ff, 0 0 20px #00f5ff, 0 0 40px #0080ff;
  animation: pulse 2s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { box-shadow: 0 0 8px #00f5ff, 0 0 20px #00f5ff; }
  50% { box-shadow: 0 0 16px #00f5ff, 0 0 40px #00f5ff, 0 0 60px #0080ff; }
}
```

**Animated edge:**
```jsx
<path style={{
  stroke: '#00f5ff', strokeWidth: 2,
  strokeDasharray: '8 4',
  animation: 'dash 0.5s linear infinite',
  filter: 'drop-shadow(0 0 4px #00f5ff)'
}} />
```

---

## Cosmos.gl (GPU Neural Network Overlay)

**GitHub:** https://github.com/cosmograph-org/cosmos — 1,300 stars, MIT

- Pure WebGL2 (luma.gl) — all simulation and rendering on GPU
- 100,000+ nodes at 60fps, 800ms GPU position transitions
- Glow halos + additive edge blending at GPU level
- `start()` / `stop()` / `pause()` simulation control
- **Use as background layer** behind React Flow task view
- Drive node states from WebSocket events (pulsing active agents)

---

## react-force-graph (Simpler Alternative)

**GitHub:** https://github.com/vasturiano/react-force-graph — 3,300 stars, MIT

- `react-force-graph-2d` (Canvas), `-3d` (Three.js WebGL), `-vr`, `-ar`
- `nodeCanvasObject` callback: draw glow with `ctx.shadowColor`/`ctx.shadowBlur`
- **Built-in link particles:** `linkDirectionalParticles` → animated particles along edges (zero code)
- Uses d3-force under the hood

```js
// Glow node in nodeCanvasObject callback
ctx.shadowColor = node.active ? '#00f5ff' : '#6366f1';
ctx.shadowBlur = node.active ? 30 : 12;
ctx.beginPath();
ctx.arc(node.x, node.y, 6, 0, 2 * Math.PI);
ctx.fillStyle = node.active ? '#00f5ff' : '#4f46e5';
ctx.fill();
```

**Recommendation:** Use react-force-graph if Cosmos.gl feels like over-engineering.

---

## State Architecture

```ts
// Zustand store with subscribeWithSelector
const useOrchestratorStore = create(
  subscribeWithSelector((set) => ({
    tasks: {} as Record<string, Task>,
    agents: {} as Record<string, Agent>,
    queue: [] as QueueItem[],
    providers: {} as Record<string, ProviderStatus>,
    handleEvent: (event: WSEvent) => set((state) => {
      switch (event.type) {
        case 'task.started': return { tasks: { ...state.tasks, [event.taskId]: event } };
        case 'queue.reorder': return { queue: event.items };
      }
    }),
  }))
);
```

**Why Zustand over Redux:** Direct `set()` calls — no action/reducer overhead at 10–100 events/sec.
**`subscribeWithSelector`:** Each panel subscribes only to its relevant slice → no cross-panel re-renders.

### WebSocket (react-use-websocket)
```ts
const { lastMessage } = useWebSocket(wsUrl, {
  share: true,  // single connection shared across all panels
  filter: (msg) => JSON.parse(msg.data).type === 'task.started',
  shouldReconnect: () => true,
});
```

### Go → React Event Types
```json
{ "type": "task.started",   "taskId": "...", "agentId": "...", "ts": 1234567890 }
{ "type": "task.completed", "taskId": "...", "duration": 1200 }
{ "type": "agent.status",   "agentId": "...", "status": "running|idle|error" }
{ "type": "queue.reorder",  "items": [...] }
{ "type": "provider.health","provider": "openai", "latency": 42, "status": "ok" }
```

---

## Priority Queue: dnd-kit

**GitHub:** https://github.com/dnd-kit/dnd-kit — ~12,000 stars, MIT

- `@dnd-kit/sortable` → `SortableContext` + `useSortable` hook
- Vertical list reorder in ~30 lines
- Full keyboard accessibility, pointer events (not HTML5 DnD API)
- **DO NOT USE react-beautiful-dnd** — archived/deprecated by Atlassian

```tsx
<DndContext collisionDetection={closestCenter} onDragEnd={onReorder}>
  <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
    {tasks.map(task => <SortableTaskItem key={task.id} task={task} />)}
  </SortableContext>
</DndContext>
```

After drag: emit `{ "type": "queue.reorder", "items": newOrder }` back to Go server.

---

## Complete Architecture

```
Dashboard Shell (shadcn/ui layout)
├── Tremor (KPI cards, provider status, spark charts)
│
├── Panel: Task Flow (React Flow)
│   ├── Custom agent nodes with CSS glow
│   ├── Animated SVG edges
│   └── dagre layout / D3-force toggle
│
├── Panel: Neural Network (Cosmos.gl WebGL2)
│   └── Driven by WebSocket agent-state events
│
├── Panel: Provider Status (Tremor Tracker)
│
└── Panel: Priority Queue (dnd-kit)
    └── shadcn/ui card per task

State: Zustand (subscribeWithSelector)
  └── Single WebSocket (react-use-websocket, share: true)
        └── Go WebSocket server (gorilla/websocket or nhooyr.io/websocket)
```

**Go WebSocket:** gorilla/websocket (22k stars) or nhooyr.io/websocket (context-aware). Send heartbeat ping every 30s, close idle after 60s.
