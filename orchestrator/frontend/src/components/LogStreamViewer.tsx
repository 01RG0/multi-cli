import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Search,
  ChevronDown,
  ArrowDown,
  Check,
  Copy,
  AlertTriangle,
  X,
  Terminal,
  Activity,
} from 'lucide-react';
import { useSwarmStore, LogLine } from '../store/useSwarmStore';

export interface LogStreamViewerProps {
  className?: string;
  height?: number | string;
}

type StreamFilter = 'ALL' | 'STDOUT' | 'STDERR';

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number, z = 2) => String(n).padStart(z, '0');
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  const ms = pad(d.getMilliseconds(), 3);
  return `${hh}:${mm}:${ss}.${ms}`;
}

export const LogStreamViewer: React.FC<LogStreamViewerProps> = ({
  className = '',
  height = '100%',
}) => {
  // Wire to real streaming data from useSwarmStore
  const {
    logsByTask,
    selectedLogTaskId,
    setSelectedLogTaskId,
    tasks,
    agents,
    addLogLine,
  } = useSwarmStore();

  // Local state
  const [streamFilter, setStreamFilter] = useState<StreamFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [showPausedBanner, setShowPausedBanner] = useState(false);
  const [isTaskDropdownOpen, setIsTaskDropdownOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  const parentRef = useRef<HTMLDivElement>(null);
  const taskDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click or Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        taskDropdownRef.current &&
        !taskDropdownRef.current.contains(e.target as Node)
      ) {
        setIsTaskDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsTaskDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Hydrate with GET http://localhost:8080/api/logs?task_id=...&limit=200 on task selection or mount
  useEffect(() => {
    const queryParam = selectedLogTaskId
      ? `?task_id=${encodeURIComponent(selectedLogTaskId)}&limit=200`
      : `?limit=200`;
    const url = `http://localhost:8080/api/logs${queryParam}`;

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(
        (
          entries: Array<{
            agent_id: string;
            task_id: string;
            stream: string;
            line: string;
            ts: number;
          }>
        ) => {
          if (!Array.isArray(entries) || entries.length === 0) return;
          entries.forEach((e) => {
            const tId = e.task_id || selectedLogTaskId || 'task-default';
            const existing = logsByTask[tId] || [];
            const exists = existing.some(
              (l) => l.ts === e.ts && l.line === e.line && l.stream === e.stream
            );
            if (!exists) {
              const line: LogLine = {
                agentId: e.agent_id || '',
                stream: e.stream === 'stderr' ? 'stderr' : 'stdout',
                line: e.line || '',
                ts: e.ts || Date.now(),
              };
              addLogLine(tId, line);
            }
          });
        }
      )
      .catch(() => {
        // Server might be in test mode or not running — fail gracefully
      });
  }, [selectedLogTaskId]);

  // Combine tasks from store + any task IDs present in logsByTask
  const taskOptions = useMemo(() => {
    const map = new Map<
      string,
      { id: string; agentId: string; status: string; prompt: string }
    >();

    // 1. From store tasks
    tasks.forEach((t) => {
      map.set(t.id, {
        id: t.id,
        agentId: t.agentId || 'opencode',
        status: t.status || 'pending',
        prompt: t.prompt || `Task ${t.id}`,
      });
    });

    // 2. From logsByTask
    Object.entries(logsByTask).forEach(([taskId, lines]) => {
      if (!map.has(taskId)) {
        const first = lines[0];
        map.set(taskId, {
          id: taskId,
          agentId: first?.agentId || 'opencode',
          status: 'completed',
          prompt: `Task ${taskId}`,
        });
      }
    });

    return Array.from(map.values());
  }, [tasks, logsByTask]);

  // Auto-select first available task if selectedLogTaskId is null
  useEffect(() => {
    if (!selectedLogTaskId && taskOptions.length > 0) {
      setSelectedLogTaskId(taskOptions[0].id);
    }
  }, [selectedLogTaskId, taskOptions, setSelectedLogTaskId]);

  // Selected task details
  const activeTask = useMemo(() => {
    if (!selectedLogTaskId) return null;
    return (
      taskOptions.find((t) => t.id === selectedLogTaskId) || {
        id: selectedLogTaskId,
        agentId: 'opencode',
        status: 'running',
        prompt: `Task ${selectedLogTaskId}`,
      }
    );
  }, [selectedLogTaskId, taskOptions]);

  // Current task's log lines
  const currentTaskLines = useMemo(() => {
    if (!selectedLogTaskId) return [];
    return logsByTask[selectedLogTaskId] || [];
  }, [logsByTask, selectedLogTaskId]);

  // Counts for STDOUT, STDERR, ALL
  const counts = useMemo(() => {
    let stdout = 0;
    let stderr = 0;
    currentTaskLines.forEach((l) => {
      if (l.stream === 'stderr') stderr++;
      else stdout++;
    });
    return {
      ALL: currentTaskLines.length,
      STDOUT: stdout,
      STDERR: stderr,
    };
  }, [currentTaskLines]);

  // Filtered log lines
  const filteredLines = useMemo(() => {
    return currentTaskLines.filter((l) => {
      // 1. Stream filter
      if (streamFilter === 'STDOUT' && l.stream !== 'stdout') return false;
      if (streamFilter === 'STDERR' && l.stream !== 'stderr') return false;

      // 2. Search query filter
      if (searchQuery.trim()) {
        const term = searchQuery.toLowerCase();
        return (
          l.line.toLowerCase().includes(term) ||
          l.agentId.toLowerCase().includes(term) ||
          l.stream.toLowerCase().includes(term)
        );
      }
      return true;
    });
  }, [currentTaskLines, streamFilter, searchQuery]);

  // TanStack Virtualizer for performant virtual scrolling
  const rowVirtualizer = useVirtualizer({
    count: filteredLines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 20,
  });

  // Keep following latest logs when autoScroll is active
  useEffect(() => {
    if (autoScroll && filteredLines.length > 0) {
      rowVirtualizer.scrollToIndex(filteredLines.length - 1, { align: 'end' });
      setShowPausedBanner(false);
    }
  }, [filteredLines.length, autoScroll, rowVirtualizer]);

  // Detect user scrolling away from bottom to pause auto-scroll
  const handleScroll = () => {
    if (!parentRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
    const isAtBottom = scrollHeight - (scrollTop + clientHeight) < 40;

    if (!isAtBottom && autoScroll) {
      setAutoScroll(false);
      setShowPausedBanner(true);
    } else if (isAtBottom && !autoScroll) {
      setAutoScroll(true);
      setShowPausedBanner(false);
    }
  };

  const jumpToLatest = () => {
    setAutoScroll(true);
    setShowPausedBanner(false);
    if (filteredLines.length > 0) {
      rowVirtualizer.scrollToIndex(filteredLines.length - 1, {
        align: 'end',
        behavior: 'smooth',
      });
    }
  };

  const copyLine = (idx: number, line: LogLine) => {
    const text = `[${formatTimestamp(line.ts)}] [${line.stream.toUpperCase()}] [@${line.agentId}] ${line.line}`;
    navigator.clipboard?.writeText(text);
    setCopiedId(String(idx));
    setTimeout(() => setCopiedId(null), 1800);
  };

  const copyAllLines = () => {
    const text = filteredLines
      .map(
        (l) =>
          `[${formatTimestamp(l.ts)}] [${l.stream.toUpperCase()}] [@${l.agentId}] ${l.line}`
      )
      .join('\n');
    navigator.clipboard?.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  return (
    <div
      className={`w-full bg-[#0d0d10] border border-[#27272a] rounded-lg shadow-2xl flex flex-col overflow-hidden ${
        height === '100%' || height === 'auto' ? 'h-full' : ''
      } ${className}`}
      style={
        height !== '100%' && height !== 'auto'
          ? { height: typeof height === 'number' ? `${height}px` : height }
          : undefined
      }
    >
      {/* ── HEADER ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 bg-[#09090b] border-b border-[#27272a] select-none z-20 shrink-0">
        {/* Title and total lines badge */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-mono font-bold tracking-wider text-white">
              LIVE TELEMETRY
            </span>
          </div>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-zinc-800 text-zinc-300 border border-zinc-700">
            {counts.ALL} lines
          </span>
          {autoScroll && (
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 shadow-[0_0_8px_rgba(52,211,153,0.15)]">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
              </span>
              STREAMING
            </span>
          )}
        </div>

        {/* Task selector dropdown & Auto-scroll toggle */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Task Selector Dropdown */}
          <div className="relative" ref={taskDropdownRef}>
            <button
              type="button"
              onClick={() => setIsTaskDropdownOpen(!isTaskDropdownOpen)}
              className="flex items-center gap-2 px-2.5 py-1 rounded bg-[#141418] hover:bg-[#1c1c22] border border-[#27272a] hover:border-zinc-600 text-xs font-mono text-zinc-200 transition-all"
            >
              <Activity className="w-3.5 h-3.5 text-zinc-400" />
              <span className="font-semibold text-zinc-100">
                {activeTask ? `Task ${activeTask.id}` : 'Select Task'}
              </span>
              {activeTask && (
                <span className="text-[10px] px-1.5 py-0.2 rounded border border-zinc-700 bg-zinc-900 text-zinc-400">
                  @{activeTask.agentId}
                </span>
              )}
              {activeTask?.status && (
                <span
                  className={`text-[9px] uppercase px-1.5 py-0.2 rounded font-bold ${
                    activeTask.status === 'running'
                      ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60'
                      : activeTask.status === 'completed'
                      ? 'bg-blue-950/60 text-blue-400 border border-blue-800/60'
                      : activeTask.status === 'failed'
                      ? 'bg-rose-950/60 text-rose-400 border border-rose-800/60'
                      : 'bg-amber-950/60 text-amber-400 border border-amber-800/60'
                  }`}
                >
                  {activeTask.status}
                </span>
              )}
              <ChevronDown
                className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-150 ${
                  isTaskDropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {isTaskDropdownOpen && (
              <div className="absolute right-0 mt-1.5 w-72 bg-[#121215] border border-[#27272a] rounded-lg shadow-2xl py-1 z-50 font-mono text-xs max-h-72 overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
                <div className="px-3 py-1.5 text-[10px] text-zinc-500 uppercase tracking-wider border-b border-zinc-800/80 flex items-center justify-between">
                  <span>SELECT TASK STREAM</span>
                  <span>{taskOptions.length} TASKS</span>
                </div>
                {taskOptions.length === 0 ? (
                  <div className="px-3 py-3 text-center text-zinc-500 text-xs">
                    No active tasks
                  </div>
                ) : (
                  taskOptions.map((task) => {
                    const isSelected = selectedLogTaskId === task.id;
                    const lineCount = (logsByTask[task.id] || []).length;
                    return (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => {
                          setSelectedLogTaskId(task.id);
                          setIsTaskDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors border-b border-zinc-900/50 ${
                          isSelected
                            ? 'bg-zinc-800/90 text-white'
                            : 'text-zinc-300 hover:bg-zinc-900 hover:text-white'
                        }`}
                      >
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-white">
                              Task {task.id}
                            </span>
                            <span className="text-[10px] text-zinc-400">
                              @{task.agentId}
                            </span>
                            <span
                              className={`text-[8px] uppercase px-1 rounded ${
                                task.status === 'running'
                                  ? 'bg-emerald-950 text-emerald-400'
                                  : task.status === 'completed'
                                  ? 'bg-blue-950 text-blue-400'
                                  : task.status === 'failed'
                                  ? 'bg-rose-950 text-rose-400'
                                  : 'bg-zinc-800 text-zinc-400'
                              }`}
                            >
                              {task.status}
                            </span>
                          </div>
                          <span className="text-[10px] text-zinc-500 truncate max-w-[200px]">
                            {task.prompt}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] text-zinc-500">
                            {lineCount} lines
                          </span>
                          {isSelected && (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Auto-scroll Toggle */}
          <div className="flex items-center gap-2 bg-[#141418] px-2 py-1 rounded border border-[#27272a]">
            <span className="text-zinc-300 text-xs font-mono font-medium">
              Auto-scroll
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={autoScroll}
              onClick={() => {
                const next = !autoScroll;
                setAutoScroll(next);
                if (next) jumpToLatest();
              }}
              className={`relative inline-flex h-4 w-8 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                autoScroll ? 'bg-emerald-500' : 'bg-zinc-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-black shadow ring-0 transition duration-200 ease-in-out ${
                  autoScroll ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* ── FILTER BAR ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[#09090b]/80 border-b border-[#27272a] select-none text-xs font-mono shrink-0">
        {/* ALL | STDOUT | STDERR Buttons */}
        <div className="flex items-center gap-1.5">
          {/* ALL Button */}
          <button
            type="button"
            onClick={() => setStreamFilter('ALL')}
            className={`px-2.5 py-1 rounded text-xs font-mono font-semibold transition-all duration-150 flex items-center gap-1.5 border ${
              streamFilter === 'ALL'
                ? 'bg-zinc-200 text-black border-zinc-200 shadow-sm'
                : 'bg-[#18181b] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border-zinc-800'
            }`}
          >
            <span>ALL</span>
            <span
              className={`text-[10px] px-1 rounded ${
                streamFilter === 'ALL'
                  ? 'bg-black/20 text-black'
                  : 'bg-zinc-900 text-zinc-500'
              }`}
            >
              {counts.ALL}
            </span>
          </button>

          {/* STDOUT Button */}
          <button
            type="button"
            onClick={() => setStreamFilter('STDOUT')}
            className={`px-2.5 py-1 rounded text-xs font-mono font-semibold transition-all duration-150 flex items-center gap-1.5 border ${
              streamFilter === 'STDOUT'
                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500 shadow-sm'
                : 'bg-[#18181b] text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800 border-zinc-800'
            }`}
          >
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              STDOUT
            </span>
            <span
              className={`text-[10px] px-1 rounded ${
                streamFilter === 'STDOUT'
                  ? 'bg-emerald-900/50 text-emerald-200'
                  : 'bg-zinc-900 text-zinc-500'
              }`}
            >
              {counts.STDOUT}
            </span>
          </button>

          {/* STDERR Button */}
          <button
            type="button"
            onClick={() => setStreamFilter('STDERR')}
            className={`px-2.5 py-1 rounded text-xs font-mono font-semibold transition-all duration-150 flex items-center gap-1.5 border ${
              streamFilter === 'STDERR'
                ? 'bg-rose-950/60 text-rose-300 border-rose-500 shadow-sm'
                : 'bg-[#18181b] text-zinc-400 hover:text-rose-400 hover:bg-zinc-800 border-zinc-800'
            }`}
          >
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
              STDERR
            </span>
            <span
              className={`text-[10px] px-1 rounded ${
                streamFilter === 'STDERR'
                  ? 'bg-rose-900/50 text-rose-200'
                  : 'bg-zinc-900 text-zinc-500'
              }`}
            >
              {counts.STDERR}
            </span>
          </button>
        </div>

        {/* Text Search Input and Copy All */}
        <div className="flex items-center gap-2">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search output..."
              className="pl-8 pr-6 py-1 bg-[#141418] border border-[#27272a] focus:border-zinc-500 focus:outline-none rounded text-xs font-mono text-zinc-200 placeholder:text-zinc-600 w-36 sm:w-48 transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 text-zinc-500 hover:text-zinc-300"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {filteredLines.length > 0 && (
            <button
              type="button"
              onClick={copyAllLines}
              title="Copy filtered logs"
              className="px-2 py-1 rounded bg-[#141418] hover:bg-zinc-800 border border-[#27272a] text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1 text-xs"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{copiedAll ? 'Copied!' : 'Copy'}</span>
            </button>
          )}
        </div>
      </div>

      {/* ── TERMINAL LOG STREAM VIEWPORT ── */}
      <div className="relative flex-1 min-h-0 bg-[#070709]">
        <div
          ref={parentRef}
          onScroll={handleScroll}
          className="absolute inset-0 overflow-y-auto overflow-x-auto select-text font-mono text-[12px] leading-6 py-1 scrollbar-thin scrollbar-thumb-zinc-800"
        >
          {filteredLines.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-600 font-mono text-xs gap-2 py-8">
              {currentTaskLines.length === 0 ? (
                <>
                  <Terminal className="w-6 h-6 text-zinc-700 animate-pulse" />
                  <span className="text-zinc-500">
                    Waiting for CLI agent stream output...
                  </span>
                  <span className="text-[11px] text-zinc-600 font-mono">
                    Task {selectedLogTaskId || 'none'}
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-5 h-5 text-zinc-700" />
                  <span>No logs match current filter criteria</span>
                </>
              )}
            </div>
          ) : (
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const line = filteredLines[virtualRow.index];
                const isStderr = line.stream === 'stderr';
                const isCopied = copiedId === String(virtualRow.index);

                return (
                  <div
                    key={virtualRow.key}
                    onClick={() => copyLine(virtualRow.index, line)}
                    title="Click to copy line"
                    className={`group absolute top-0 left-0 w-full px-3 py-0.5 flex items-baseline gap-2.5 whitespace-pre font-mono cursor-pointer hover:bg-zinc-900/60 transition-colors ${
                      isStderr ? 'bg-red-950/15' : ''
                    }`}
                    style={{
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    {/* Timestamp */}
                    <span className="text-zinc-500 text-[11px] tabular-nums shrink-0 select-none">
                      {formatTimestamp(line.ts)}
                    </span>

                    <span className="text-zinc-700 select-none shrink-0">|</span>

                    {/* Stream Badge */}
                    <span className="shrink-0 select-none">
                      {isStderr ? (
                        <span className="inline-block w-14 text-center px-1.5 py-0.2 rounded border border-rose-500/50 text-rose-400 bg-rose-950/30 text-[10px] font-semibold tracking-wider">
                          STDERR
                        </span>
                      ) : (
                        <span className="inline-block w-14 text-center px-1.5 py-0.2 rounded border border-emerald-500/40 text-emerald-400 bg-emerald-950/20 text-[10px] font-semibold tracking-wider">
                          STDOUT
                        </span>
                      )}
                    </span>

                    <span className="text-zinc-700 select-none shrink-0">|</span>

                    {/* Agent Badge */}
                    <span className="shrink-0 select-none">
                      <span className="inline-block px-1.5 py-0.2 rounded text-[10px] tracking-wide border border-zinc-800 bg-[#141418] text-zinc-300">
                        @{line.agentId || 'agent'}
                      </span>
                    </span>

                    <span className="text-zinc-700 select-none shrink-0">|</span>

                    {/* Log Text */}
                    <span
                      className={`flex-1 select-text ${
                        isStderr
                          ? 'text-rose-300 font-medium'
                          : 'text-zinc-200'
                      }`}
                    >
                      {line.line}
                    </span>

                    {/* Hover copy feedback */}
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity ml-auto text-zinc-500 shrink-0 select-none pl-2">
                      {isCopied ? (
                        <span className="text-emerald-400 text-[10px]">
                          Copied!
                        </span>
                      ) : (
                        <Copy className="w-3 h-3 hover:text-zinc-300" />
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Floating Jump to Latest Button */}
        {showPausedBanner && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30">
            <button
              type="button"
              onClick={jumpToLatest}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#18181b] border border-zinc-700 text-zinc-200 hover:text-white hover:border-zinc-500 shadow-xl text-xs font-mono transition-all animate-bounce"
            >
              <ArrowDown className="w-3.5 h-3.5 text-emerald-400" />
              <span>Auto-scroll paused (Jump to Latest)</span>
            </button>
          </div>
        )}
      </div>

      {/* ── FOOTER STATUS ── */}
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#09090b] border-t border-[#27272a] select-none text-[11px] font-mono text-zinc-500 shrink-0">
        <div className="flex items-center gap-2">
          <span>{filteredLines.length} lines rendered</span>
          <span>•</span>
          <span>Buffer cap: 500/task</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${
              autoScroll ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' : 'bg-zinc-600'
            }`}
          />
          <span className="text-zinc-400">
            {autoScroll ? 'Live Follow' : 'Scroll Locked'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default LogStreamViewer;
