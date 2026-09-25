import React, { useState } from 'react';
import { Group as PanelGroup, Panel as ResizablePanel, Separator } from 'react-resizable-panels';
import CockpitHeader from './components/CockpitHeader';
import SwarmRadialTopology from './components/SwarmRadialTopology';
import AgentDeepInspector from './components/AgentDeepInspector';
import TaskExecutionChat from './components/TaskExecutionChat';
import TaskQueueTable from './components/TaskQueueTable';
import LogStreamViewer from './components/LogStreamViewer';
import ProviderChain from './components/ProviderChain';
import RoutingRulesBuilder from './components/RoutingRulesBuilder';
import TerminalCommandPalette from './components/TerminalCommandPalette';
import MemoryNeuralGraph from './components/MemoryNeuralGraph';
import { ChatWidget } from './components/chat/ChatWidget';
import { useSwarmStore } from './store/useSwarmStore';
import { LayoutGrid, Network, ListOrdered, Terminal, Cpu, Sliders, Brain, MessageSquare } from 'lucide-react';

const TABS = [
  { id: 'cockpit',   label: 'ALL PANELS',      icon: LayoutGrid    },
  { id: 'swarm',     label: 'SWARM TOPOLOGY',  icon: Network       },
  { id: 'tasks',     label: 'TASK QUEUE',      icon: ListOrdered   },
  { id: 'logs',      label: 'LIVE TELEMETRY',  icon: Terminal      },
  { id: 'agent',     label: 'AGENT INSPECTOR', icon: Cpu           },
  { id: 'providers', label: 'PROVIDER CHAIN',  icon: Sliders       },
  { id: 'memory',    label: 'MEMORY CORTEX',   icon: Brain         },
  { id: 'chat',      label: 'CHAT',            icon: MessageSquare },
] as const;

type TabId = typeof TABS[number]['id'];

// Shared card wrapper so each panel fills its grid cell exactly
function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col border border-zinc-800 rounded-xl overflow-hidden shadow-[0_4px_20px_rgba(0,0,0,0.5)] bg-zinc-950 hover:border-zinc-700 transition-colors duration-300 min-h-0 h-full ${className}`}>
      {children}
    </div>
  );
}

// Drag handle between left/right panels (vertical divider, horizontal resize)
function HResizeHandle() {
  return (
    <Separator className="group relative flex items-center justify-center w-3 shrink-0 cursor-col-resize z-10 outline-none select-none">
      {/* thin track */}
      <div className="w-px h-full bg-zinc-800 group-hover:bg-cyan-500/60 group-active:bg-cyan-400 transition-colors duration-150" />
      {/* grip dots */}
      <div className="absolute flex flex-col gap-[3px] items-center pointer-events-none">
        <div className="w-[3px] h-[3px] rounded-full bg-zinc-700 group-hover:bg-cyan-400 group-active:bg-cyan-300 transition-colors duration-150" />
        <div className="w-[3px] h-[3px] rounded-full bg-zinc-700 group-hover:bg-cyan-400 group-active:bg-cyan-300 transition-colors duration-150" />
        <div className="w-[3px] h-[3px] rounded-full bg-zinc-700 group-hover:bg-cyan-400 group-active:bg-cyan-300 transition-colors duration-150" />
      </div>
    </Separator>
  );
}

// Drag handle between rows (horizontal divider, vertical resize)
function VResizeHandle() {
  return (
    <Separator className="group relative flex items-center justify-center h-3 shrink-0 cursor-row-resize z-10 outline-none select-none">
      {/* thin track */}
      <div className="h-px w-full bg-zinc-800 group-hover:bg-cyan-500/60 group-active:bg-cyan-400 transition-colors duration-150" />
      {/* grip dots */}
      <div className="absolute flex flex-row gap-[3px] items-center pointer-events-none">
        <div className="w-[3px] h-[3px] rounded-full bg-zinc-700 group-hover:bg-cyan-400 group-active:bg-cyan-300 transition-colors duration-150" />
        <div className="w-[3px] h-[3px] rounded-full bg-zinc-700 group-hover:bg-cyan-400 group-active:bg-cyan-300 transition-colors duration-150" />
        <div className="w-[3px] h-[3px] rounded-full bg-zinc-700 group-hover:bg-cyan-400 group-active:bg-cyan-300 transition-colors duration-150" />
      </div>
    </Separator>
  );
}

export function App() {
  const store = useSwarmStore();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const saved = localStorage.getItem('ultron_active_tab');
    return (TABS.some(t => t.id === saved) ? saved : 'cockpit') as TabId;
  });

  // New task dispatching now routes through the Ultron chat
  const handleNewTask = () => {
    setActiveTab('chat');
    localStorage.setItem('ultron_active_tab', 'chat');
  };

  return (
    <div className="h-screen flex flex-col bg-black text-white font-sans selection:bg-white selection:text-black overflow-hidden">

      {/* Top Global Cockpit Header */}
      <CockpitHeader
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        onNewTask={handleNewTask}
      />

      {/* View Switcher Ribbon */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-2 border-b border-zinc-900 bg-zinc-950/80 text-xs font-mono select-none shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); localStorage.setItem('ultron_active_tab', tab.id); }}
                className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded transition-all duration-300 z-10 shrink-0 ${
                  isActive ? 'text-black font-bold' : 'text-zinc-400 hover:text-white hover:bg-zinc-900/50'
                }`}
              >
                {isActive && (
                  <div className="absolute inset-0 bg-white rounded-md z-[-1] shadow-[0_0_10px_rgba(255,255,255,0.3)]" />
                )}
                <tab.icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>
        <div className="hidden lg:flex items-center gap-3 text-zinc-500 text-[10px] shrink-0 ml-4">
          <span>MONOCHROME HIGH-CONTRAST DARK</span>
          <span>•</span>
          <span className="text-zinc-400">60 FPS FRAME-BATCHED</span>
        </div>
      </div>

      {/* Main Workspace — fills remaining height, never grows past screen */}
      <main className="flex-1 min-h-0 overflow-hidden flex flex-col">

        {/* ── Cockpit: 3 resizable rows sharing available height ── */}
        {activeTab === 'cockpit' && (
          <div className="flex-1 min-h-0 p-3 lg:p-4 overflow-y-auto">
            <PanelGroup orientation="vertical" className="h-full" style={{ minHeight: 'max(900px, 200vh)' }}>

              {/* Row 1: Topology + Inspector */}
              <ResizablePanel defaultSize={36} minSize={15}>
                <PanelGroup orientation="horizontal" className="h-full">
                  <ResizablePanel defaultSize={50} minSize={15}>
                    <Panel><SwarmRadialTopology /></Panel>
                  </ResizablePanel>
                  <HResizeHandle />
                  <ResizablePanel defaultSize={50} minSize={15}>
                    <Panel><AgentDeepInspector isEmbedded={true} /></Panel>
                  </ResizablePanel>
                </PanelGroup>
              </ResizablePanel>

              <VResizeHandle />

              {/* Row 2: Task Queue + Chat */}
              <ResizablePanel defaultSize={32} minSize={12}>
                <PanelGroup orientation="horizontal" className="h-full">
                  <ResizablePanel defaultSize={50} minSize={15}>
                    <Panel><TaskQueueTable /></Panel>
                  </ResizablePanel>
                  <HResizeHandle />
                  <ResizablePanel defaultSize={50} minSize={15}>
                    <Panel><TaskExecutionChat /></Panel>
                  </ResizablePanel>
                </PanelGroup>
              </ResizablePanel>

              <VResizeHandle />

              {/* Row 3: Logs + Providers + Memory Cortex */}
              <ResizablePanel defaultSize={32} minSize={12}>
                <PanelGroup orientation="horizontal" className="h-full">
                  <ResizablePanel defaultSize={33} minSize={12}>
                    <Panel><LogStreamViewer /></Panel>
                  </ResizablePanel>
                  <HResizeHandle />
                  <ResizablePanel defaultSize={34} minSize={12}>
                    <Panel><MemoryNeuralGraph /></Panel>
                  </ResizablePanel>
                  <HResizeHandle />
                  <ResizablePanel defaultSize={33} minSize={12}>
                    <Panel className="overflow-y-auto p-4 gap-4 flex flex-col">
                      <ProviderChain />
                      <RoutingRulesBuilder />
                    </Panel>
                  </ResizablePanel>
                </PanelGroup>
              </ResizablePanel>

            </PanelGroup>
          </div>
        )}

        {/* ── Single focus tabs — fill remaining viewport ── */}
        {activeTab === 'swarm' && (
          <div className="flex-1 min-h-0 animate-in fade-in zoom-in-95 duration-500">
            <SwarmRadialTopology />
          </div>
        )}

        {activeTab === 'tasks' && (
          <div className="flex-1 min-h-0 p-3 lg:p-4 animate-in fade-in zoom-in-95 duration-500">
            <Panel className="h-full"><TaskQueueTable /></Panel>
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="flex-1 min-h-0 p-3 lg:p-4 animate-in fade-in zoom-in-95 duration-500">
            <Panel className="h-full"><LogStreamViewer /></Panel>
          </div>
        )}

        {activeTab === 'agent' && (
          <div className="flex-1 min-h-0 p-3 lg:p-4 animate-in fade-in zoom-in-95 duration-500">
            <Panel className="h-full max-w-6xl mx-auto w-full"><AgentDeepInspector isEmbedded={true} /></Panel>
          </div>
        )}

        {activeTab === 'providers' && (
          <div className="flex-1 min-h-0 p-3 lg:p-4 overflow-y-auto animate-in fade-in zoom-in-95 duration-500">
            <div className="max-w-6xl mx-auto w-full space-y-4">
              <ProviderChain />
              <RoutingRulesBuilder />
            </div>
          </div>
        )}

        {activeTab === 'memory' && (
          <div className="flex-1 min-h-0 animate-in fade-in zoom-in-95 duration-500">
            <MemoryNeuralGraph />
          </div>
        )}

        {/* ── CHAT: Ultron agentic interface — primary task entry point ── */}
        {activeTab === 'chat' && (
          <div className="flex-1 min-h-0 animate-in fade-in zoom-in-95 duration-500">
            <ChatWidget />
          </div>
        )}

      </main>

      {/* Floating Terminal Command Palette Modal */}
      <TerminalCommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
      />
    </div>
  );
}

export default App;
