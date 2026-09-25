import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { 
  Search, ChevronDown, ArrowDown, Check, 
  Copy, AlertTriangle, X 
} from 'lucide-react';
import { useSwarmStore, LogEntry, LogLevel } from '../store/useSwarmStore';
import { MonochromeSparkline } from './MonochromeSparkline';

export interface LogStreamViewerProps {
  className?: string;
  height?: number | string;
}

const SEVERITIES: Array<{ label: string; value: LogLevel | 'FAILED'; color: string }> = [
  { label: 'DEBUG', value: 'DEBUG', color: 'text-cyan-400 border-cyan-500/50 bg-cyan-950/30' },
  { label: 'INFO', value: 'INFO', color: 'text-sky-400 border-sky-500/50 bg-sky-950/30' },
  { label: 'WARN', value: 'WARN', color: 'text-amber-400 border-amber-500/50 bg-amber-950/30' },
  { label: 'FAILED', value: 'FAILED', color: 'text-rose-400 border-rose-500/50 bg-rose-950/30' },
];

const TIME_RANGES = [
  'Time - 15m',
  'Time - 1h',
  'Time - 6h',
  'Time - 24h',
  'Time - 30h',
  'All Time',
];

export const LogStreamViewer: React.FC<LogStreamViewerProps> = ({
  className = '',
  height = '100%',
}) => {
  // Store connection
  const { logs, telemetry, agents } = useSwarmStore();

  // Local component state
  const [activeSeverities, setActiveSeverities] = useState<string[]>(['DEBUG', 'INFO', 'WARN', 'FAILED']);
  const [selectedAgent, setSelectedAgent] = useState<string>('All');
  const [isAgentMenuOpen, setIsAgentMenuOpen] = useState(false);
  const [selectedTimeRange, setSelectedTimeRange] = useState<string>('Time - 30h');
  const [isTimeMenuOpen, setIsTimeMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isFollowingLive, setIsFollowingLive] = useState(true);
  const [showPausedBanner, setShowPausedBanner] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // ── Live sparkline state ──────────────────────────────────────────────────
  const [liveEventsHistory, setLiveEventsHistory] = useState<number[]>(() =>
    telemetry?.eventsHistory?.length
      ? [...telemetry.eventsHistory]
      : [18, 24, 20, 36, 52, 38, 29, 22, 45, 34, 40, 58, 48, 62, 55, 68]
  );
  const [liveEventsPerSec, setLiveEventsPerSec] = useState<string>(
    telemetry?.eventsPerSec || '6.1k'
  );
  const [liveErrorHistory, setLiveErrorHistory] = useState<number[]>(() =>
    telemetry?.errorRateHistory?.length
      ? [...telemetry.errorRateHistory]
      : [1.6, 1.2, 0.5, 0.4, 0.3, 0.8, 0.4, 0.3, 0.3, 0.6, 0.3]
  );
  const [liveErrorRate, setLiveErrorRate] = useState<string>(
    telemetry?.errorRate || '0.3%'
  );

  useEffect(() => {
    const t = setInterval(() => {
      setLiveEventsHistory(prev => {
        const last = prev[prev.length - 1];
        const next = Math.max(4, Math.min(85, last + (Math.random() - 0.45) * 14));
        return [...prev.slice(1), next];
      });
      const raw = 3800 + Math.floor(Math.random() * 4200);
      setLiveEventsPerSec(`${(raw / 1000).toFixed(1)}k`);
    }, 1300);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setLiveErrorHistory(prev => {
        const last = prev[prev.length - 1];
        const next = Math.max(0.05, Math.min(3.8, last + (Math.random() - 0.48) * 0.45));
        return [...prev.slice(1), next];
      });
      setLiveErrorRate(prev => {
        const v = parseFloat(prev) + (Math.random() - 0.48) * 0.28;
        return `${Math.max(0.05, Math.min(3.8, v)).toFixed(1)}%`;
      });
    }, 2000);
    return () => clearInterval(t);
  }, []);
  // ─────────────────────────────────────────────────────────────────────────

  const parentRef = useRef<HTMLDivElement>(null);
  const agentMenuRef = useRef<HTMLDivElement>(null);
  const timeMenuRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click or Escape key
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (agentMenuRef.current && !agentMenuRef.current.contains(target)) {
        setIsAgentMenuOpen(false);
      }
      if (timeMenuRef.current && !timeMenuRef.current.contains(target)) {
        setIsTimeMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsAgentMenuOpen(false);
        setIsTimeMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Compute severity counts dynamically
  const severityCounts = useMemo(() => {
    let debug = 0;
    let info = 0;
    let warn = 0;
    let failed = 0;
    logs.forEach((l) => {
      if (l.level === 'DEBUG') debug++;
      else if (l.level === 'INFO') info++;
      else if (l.level === 'WARN') warn++;
      else if (l.level === 'ERROR' || l.level === 'FAILED') failed++;
    });
    return {
      ALL: logs.length,
      DEBUG: debug,
      INFO: info,
      WARN: warn,
      FAILED: failed,
    };
  }, [logs]);

  // Distinct agent list derived from current logs + store agents
  const availableAgents = useMemo(() => {
    const set = new Set<string>();
    agents.forEach((a) => set.add(a.name || a.id));
    logs.forEach((l) => set.add(l.agent.replace(/^@/, '')));
    return ['All', ...Array.from(set)];
  }, [agents, logs]);

  // Filter logs based on severity, agent, and regex query
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // 1. Severity filter
      const matchesSeverity = activeSeverities.some((sev) => {
        if (sev === 'FAILED') return log.level === 'ERROR' || log.level === 'FAILED';
        return log.level === sev;
      });
      if (!matchesSeverity) return false;

      // 2. Agent filter
      if (selectedAgent !== 'All') {
        const cleanSelected = selectedAgent.replace(/^@/, '').toLowerCase();
        const cleanLogAgent = log.agent.replace(/^@/, '').toLowerCase();
        if (cleanLogAgent !== cleanSelected) return false;
      }

      // 3. Search query / Regex
      if (searchQuery.trim()) {
        try {
          const rx = new RegExp(searchQuery.trim(), 'i');
          const combined = `${log.timestamp} ${log.level} ${log.agent} ${log.message}`;
          return rx.test(combined);
        } catch {
          // Fallback to substring match if regex is invalid
          const term = searchQuery.toLowerCase();
          return (
            log.message.toLowerCase().includes(term) ||
            log.agent.toLowerCase().includes(term) ||
            log.level.toLowerCase().includes(term) ||
            log.timestamp.toLowerCase().includes(term)
          );
        }
      }

      return true;
    });
  }, [logs, activeSeverities, selectedAgent, searchQuery]);

  // Virtualizer for smooth 60fps rendering of large log streams
  const rowVirtualizer = useVirtualizer({
    count: filteredLogs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 14,
  });

  // Keep following latest logs when isFollowingLive is active
  useEffect(() => {
    if (isFollowingLive && filteredLogs.length > 0) {
      rowVirtualizer.scrollToIndex(filteredLogs.length - 1, { align: 'end' });
      setShowPausedBanner(false);
    }
  }, [filteredLogs.length, isFollowingLive, rowVirtualizer]);

  // Detect scroll offset to toggle paused banner
  const handleScroll = () => {
    if (!parentRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
    const isAtBottom = scrollHeight - (scrollTop + clientHeight) < 45;

    if (!isAtBottom && isFollowingLive) {
      setIsFollowingLive(false);
      setShowPausedBanner(true);
    } else if (isAtBottom && !isFollowingLive) {
      setIsFollowingLive(true);
      setShowPausedBanner(false);
    }
  };

  const jumpToLatest = () => {
    setIsFollowingLive(true);
    setShowPausedBanner(false);
    if (filteredLogs.length > 0) {
      rowVirtualizer.scrollToIndex(filteredLogs.length - 1, { align: 'end', behavior: 'smooth' });
    }
  };

  const toggleAllSeverities = () => {
    if (activeSeverities.length === SEVERITIES.length) {
      setActiveSeverities([]);
    } else {
      setActiveSeverities(SEVERITIES.map((s) => s.label));
    }
  };

  const toggleSeverity = (sev: string) => {
    setActiveSeverities((prev) => {
      if (prev.includes(sev)) {
        return prev.filter((s) => s !== sev);
      } else {
        return [...prev, sev];
      }
    });
  };

  const copyRow = (log: LogEntry) => {
    const text = `${log.timestamp} | ${log.level} | ${log.agent} | ${log.message}`;
    navigator.clipboard?.writeText(text);
    setCopiedId(log.id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  // Telemetry stats
  const eventsPerSec = telemetry?.eventsPerSec || '6.1k';
  const eventsHistory = telemetry?.eventsHistory?.length 
    ? telemetry.eventsHistory 
    : [18, 24, 20, 36, 52, 38, 29, 22, 45, 34, 40, 58, 48, 62, 55, 68];

  const errorRate = telemetry?.errorRate || '0.3%';
  const errorRateHistory = telemetry?.errorRateHistory?.length 
    ? telemetry.errorRateHistory 
    : [1.6, 1.2, 0.5, 0.4, 0.3, 0.8, 0.4, 0.3, 0.3, 0.6, 0.3];

  const topAgents = telemetry?.topAgents || [
    { name: 'opencode', percentage: '33%' },
    { name: 'opencode', percentage: '35%' },
  ];

  const topErrors = telemetry?.topErrors || [
    { name: 'opencode', count: 444 },
  ];

  return (
    <div
      className={`w-full bg-[#0d0d10] border border-[#27272a] rounded-lg shadow-2xl flex flex-col md:flex-row overflow-hidden ${
        height === '100%' || height === 'auto' ? 'h-full' : ''
      } ${className}`}
      style={height !== '100%' && height !== 'auto' ? { height: typeof height === 'number' ? `${height}px` : height } : undefined}
    >
      {/* ============================================================== */}
      {/* LEFT SECTION: Monospace Virtual Log Stream                     */}
      {/* ============================================================== */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 h-full border-b md:border-b-0 md:border-r border-[#27272a]">
        {/* Top Control Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 bg-[#09090b] border-b border-[#27272a] select-none z-20 shrink-0">
          {/* Severity filter toggle pills with smooth transitions */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* ALL Pill */}
            <button
              type="button"
              onClick={toggleAllSeverities}
              className={`px-2.5 py-1 rounded text-xs font-mono font-semibold transition-all duration-150 active:scale-95 flex items-center gap-1.5 border ${
                activeSeverities.length === SEVERITIES.length
                  ? 'bg-white text-black border-white shadow-sm'
                  : 'bg-[#18181b]/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border-zinc-800'
              }`}
            >
              <span>ALL</span>
              <span
                className={`text-[10px] px-1 rounded font-mono ${
                  activeSeverities.length === SEVERITIES.length
                    ? 'bg-zinc-200 text-black'
                    : 'bg-zinc-900 text-zinc-500'
                }`}
              >
                {severityCounts.ALL}
              </span>
            </button>

            {SEVERITIES.map((sev) => {
              const isActive = activeSeverities.includes(sev.label);
              const count = severityCounts[sev.label as keyof typeof severityCounts] || 0;
              return (
                <button
                  key={sev.label}
                  type="button"
                  onClick={() => toggleSeverity(sev.label)}
                  className={`px-2.5 py-1 rounded text-xs font-mono font-semibold transition-all duration-150 active:scale-95 flex items-center gap-1.5 border ${
                    isActive
                      ? `${sev.color} shadow-sm`
                      : 'bg-[#18181b]/80 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/80 border-zinc-800/80'
                  }`}
                >
                  <span>{sev.label}</span>
                  <span
                    className={`text-[10px] px-1 rounded font-mono ${
                      isActive ? 'bg-black/30' : 'bg-zinc-900 text-zinc-600'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Right Filter Controls: Agent dropdown, Time range, Regex search */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Live Streaming Status Pill */}
            {isFollowingLive && (
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 shadow-[0_0_8px_rgba(52,211,153,0.15)] animate-in fade-in duration-200">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="animate-pulse absolute inline-flex h-1 w-1 rounded-full bg-white opacity-90" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                </span>
                LIVE
              </span>
            )}

            {/* Agent filter dropdown */}
            <div className="relative" ref={agentMenuRef}>
              <button
                type="button"
                onClick={() => setIsAgentMenuOpen(!isAgentMenuOpen)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-mono transition-all duration-150 ${
                  selectedAgent !== 'All'
                    ? 'bg-emerald-950/30 border-emerald-700/60 text-emerald-300 font-medium'
                    : 'bg-[#141418] hover:bg-[#1c1c22] border-[#27272a] text-zinc-300'
                }`}
              >
                <span>{selectedAgent === 'All' ? 'Agent filter' : `@${selectedAgent}`}</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${isAgentMenuOpen ? 'rotate-180 text-zinc-300' : 'text-zinc-500'}`} />
              </button>

              {isAgentMenuOpen && (
                <div className="absolute left-0 mt-1 w-48 bg-[#121215] border border-[#27272a] rounded-lg shadow-2xl py-1 z-50 font-mono text-xs max-h-60 overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-3 py-1 text-[10px] text-zinc-500 uppercase tracking-wider border-b border-zinc-800/80">
                    Filter by Agent
                  </div>
                  {availableAgents.map((ag) => (
                    <button
                      key={ag}
                      type="button"
                      onClick={() => {
                        setSelectedAgent(ag);
                        setIsAgentMenuOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-1.5 text-left transition-colors ${
                        selectedAgent === ag
                          ? 'bg-zinc-800 text-white font-semibold'
                          : 'text-zinc-400 hover:bg-zinc-900 hover:text-white'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {ag !== 'All' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                        <span>{ag === 'All' ? 'All Agents' : `@${ag}`}</span>
                      </span>
                      {selectedAgent === ag && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Time range selector */}
            <div className="relative flex items-center gap-1.5" ref={timeMenuRef}>
              <span className="text-zinc-500 text-xs font-mono hidden sm:inline">Time range</span>
              <button
                type="button"
                onClick={() => setIsTimeMenuOpen(!isTimeMenuOpen)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#141418] hover:bg-[#1c1c22] border border-[#27272a] text-xs font-mono text-zinc-300 transition-colors"
              >
                <span>{selectedTimeRange}</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${isTimeMenuOpen ? 'rotate-180 text-zinc-300' : 'text-zinc-500'}`} />
              </button>

              {isTimeMenuOpen && (
                <div className="absolute right-0 mt-1 top-full w-36 bg-[#121215] border border-[#27272a] rounded-lg shadow-2xl py-1 z-50 font-mono text-xs animate-in fade-in zoom-in-95 duration-150">
                  {TIME_RANGES.map((tr) => (
                    <button
                      key={tr}
                      type="button"
                      onClick={() => {
                        setSelectedTimeRange(tr);
                        setIsTimeMenuOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-1.5 text-left transition-colors ${
                        selectedTimeRange === tr ? 'bg-zinc-800 text-white font-semibold' : 'text-zinc-400 hover:bg-zinc-900 hover:text-white'
                      }`}
                    >
                      <span>{tr}</span>
                      {selectedTimeRange === tr && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Regex search input */}
            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter regex..."
                className="pl-8 pr-6 py-1 bg-[#141418] border border-[#27272a] focus:border-zinc-500 focus:outline-none rounded text-xs font-mono text-zinc-200 placeholder:text-zinc-600 w-32 sm:w-40 transition-all"
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
          </div>
        </div>

        {/* Monospace Virtualized Terminal Stream Viewport */}
        <div className="relative flex-1 min-h-0 bg-[#070709]">
          <div
            ref={parentRef}
            onScroll={handleScroll}
            className="absolute inset-0 overflow-y-auto overflow-x-auto select-text font-mono text-[12px] leading-6 py-1 scrollbar-thin scrollbar-thumb-zinc-800"
          >
            {filteredLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-zinc-600 font-mono text-xs gap-2">
                <AlertTriangle className="w-5 h-5 text-zinc-700" />
                <span>No logs match current filter criteria</span>
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
                  const log = filteredLogs[virtualRow.index];
                  const isError = log.level === 'ERROR' || log.level === 'FAILED';
                  const isWarn = log.level === 'WARN';
                  const isDebug = log.level === 'DEBUG';

                  return (
                    <div
                      key={virtualRow.key}
                      onClick={() => copyRow(log)}
                      title="Click to copy log line"
                      className={`group absolute top-0 left-0 w-full px-3 py-0.5 flex items-center gap-2 whitespace-nowrap cursor-pointer hover:bg-zinc-900/60 transition-colors ${
                        isError ? 'bg-red-950/10' : ''
                      }`}
                      style={{
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      {/* Timestamp with mono tag */}
                      <span className="text-zinc-400 tabular-nums shrink-0">
                        {log.timestamp.includes('mono') ? log.timestamp : `${log.timestamp} mono`}
                      </span>

                      <span className="text-zinc-700 select-none shrink-0">|</span>

                      {/* Severity Badge */}
                      <span className="shrink-0">
                        {isDebug && (
                          <span className="inline-block w-14 text-center px-1.5 py-0.2 rounded border border-teal-500/40 text-teal-400 bg-teal-950/20 text-[10px] font-semibold tracking-wider">
                            DEBUG
                          </span>
                        )}
                        {log.level === 'INFO' && (
                          <span className="inline-block w-14 text-center px-1.5 py-0.2 rounded border border-sky-500/40 text-sky-400 bg-sky-950/20 text-[10px] font-semibold tracking-wider">
                            INFO
                          </span>
                        )}
                        {isWarn && (
                          <span className="inline-block w-14 text-center px-1.5 py-0.2 rounded border border-amber-500/40 text-amber-400 bg-amber-950/20 text-[10px] font-semibold tracking-wider">
                            WARN
                          </span>
                        )}
                        {isError && (
                          <span className="inline-block w-14 text-center px-1.5 py-0.2 rounded border border-rose-500/50 text-rose-400 bg-rose-950/30 text-[10px] font-semibold tracking-wider">
                            ERROR
                          </span>
                        )}
                      </span>

                      <span className="text-zinc-700 select-none shrink-0">|</span>

                      {/* Agent Tag Badge */}
                      <span className="shrink-0">
                        <span className={`inline-block px-1.5 py-0.2 rounded text-[10px] tracking-wide border ${
                          isError 
                            ? 'border-rose-900/60 bg-rose-950/30 text-rose-300' 
                            : isWarn
                            ? 'border-amber-900/60 bg-amber-950/30 text-amber-300'
                            : 'border-zinc-800 bg-[#141418] text-zinc-300'
                        }`}>
                          {log.agent.startsWith('@') ? log.agent : `@${log.agent}`}
                        </span>
                      </span>

                      <span className="text-zinc-700 select-none shrink-0">|</span>

                      {/* Log Message Payload */}
                      <span
                        className={`truncate flex-1 tracking-tight ${
                          isError
                            ? 'text-rose-400 font-medium'
                            : isWarn
                            ? 'text-amber-200/90'
                            : 'text-zinc-200'
                        }`}
                      >
                        {log.message}
                      </span>

                      {/* Copy row hint icon on hover */}
                      <span className="opacity-0 group-hover:opacity-100 transition-opacity ml-auto text-zinc-500 shrink-0">
                        {copiedId === log.id ? (
                          <span className="text-emerald-400 text-[10px]">Copied!</span>
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

          {/* Floating Jump to Latest / Paused Banner */}
          {showPausedBanner && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30">
              <button
                type="button"
                onClick={jumpToLatest}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#18181b] border border-zinc-700 text-zinc-200 hover:text-white hover:border-zinc-500 shadow-xl text-xs font-mono transition-all animate-bounce"
              >
                <ArrowDown className="w-3.5 h-3.5 text-cyan-400" />
                <span>Auto-scroll paused (Jump to Latest)</span>
              </button>
            </div>
          )}
        </div>

        {/* Stream Status Footer with Following Live Toggle */}
        <div className="flex items-center justify-between px-4 py-2 bg-[#09090b] border-t border-[#27272a] select-none text-xs font-mono shrink-0">
          <div className="text-zinc-500 flex items-center gap-2 text-[11px]">
            <span>{filteredLogs.length} events loaded</span>
            <span>•</span>
            <span>Buffer: 300</span>
          </div>

          {/* Auto-scroll lock toggle switch: Following Live */}
          <div className="flex items-center gap-2.5">
            <span className="text-zinc-300 text-xs font-medium font-mono">Following Live</span>
            <button
              type="button"
              role="switch"
              aria-checked={isFollowingLive}
              onClick={() => {
                const next = !isFollowingLive;
                setIsFollowingLive(next);
                if (next) jumpToLatest();
              }}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                isFollowingLive ? 'bg-emerald-500' : 'bg-zinc-800'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-black shadow-lg ring-0 transition duration-200 ease-in-out ${
                  isFollowingLive ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>

            {/* Enhanced Live Streaming Animation: Pulsing Emerald/White Dot */}
            <div className="relative flex items-center justify-center w-3 h-3">
              {isFollowingLive ? (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 duration-1000" />
                  <span className="animate-pulse absolute inline-flex h-2.5 w-2.5 rounded-full bg-white opacity-70 duration-700" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.9)]" />
                </>
              ) : (
                <span className="relative inline-flex rounded-full h-2 w-2 bg-zinc-600" />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* RIGHT TELEMETRY SUB-PANEL                                      */}
      {/* ============================================================== */}
      <div className="w-full md:w-[280px] lg:w-[310px] shrink-0 bg-[#09090b]/95 flex flex-col justify-between overflow-y-auto">
        <div className="divide-y divide-[#27272a]">
          {/* Telemetry Metric 1: events/sec */}
          <div className="p-4">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-xs font-mono text-zinc-400 tracking-wider">events/sec</span>
              <span className="text-lg font-mono font-bold text-white tabular-nums tracking-tight transition-all duration-200">
                {liveEventsPerSec}
              </span>
            </div>
            <div className="h-[52px] w-full pt-1">
              <MonochromeSparkline
                data={liveEventsHistory}
                height={48}
                strokeColor="#ffffff"
                fillColor="#ffffff"
                strokeWidth={1.75}
                showDot={true}
                glow={true}
              />
            </div>
          </div>

          {/* Telemetry Metric 2: error rate % */}
          <div className="p-4">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-xs font-mono text-zinc-400 tracking-wider">error rate %</span>
              <span className="text-lg font-mono font-bold text-white tabular-nums tracking-tight transition-all duration-200">
                {liveErrorRate}
              </span>
            </div>
            <div className="h-[52px] w-full pt-1">
              <MonochromeSparkline
                data={liveErrorHistory}
                height={48}
                strokeColor="#fb7185"
                fillColor="#fb7185"
                strokeWidth={1.75}
                showDot={true}
                glow={true}
              />
            </div>
          </div>

          {/* Telemetry Metric 3: Top agents by activity & error count */}
          <div className="p-4">
            <div className="text-xs font-mono text-zinc-400 tracking-wider mb-3">
              Top agents by activity
            </div>

            <div className="space-y-2.5">
              {/* Row 1: opencode 33% */}
              <div className="flex items-center justify-between font-mono text-xs">
                <span className="px-2 py-0.5 rounded border border-zinc-700/80 bg-zinc-900 text-zinc-300">
                  {topAgents[0]?.name || 'opencode'}
                </span>
                <span className="text-zinc-200 tabular-nums font-semibold">
                  {topAgents[0]?.percentage || '33%'}
                </span>
              </div>

              {/* Row 2: opencode 35% */}
              <div className="flex items-center justify-between font-mono text-xs">
                <span className="px-2 py-0.5 rounded border border-zinc-700/80 bg-zinc-900 text-zinc-300">
                  {topAgents[1]?.name || 'opencode'}
                </span>
                <span className="text-zinc-200 tabular-nums font-semibold">
                  {topAgents[1]?.percentage || '35%'}
                </span>
              </div>

              {/* Row 3: Top agents label 35% */}
              <div className="flex items-center justify-between font-mono text-xs pt-1">
                <span className="text-zinc-400">Top agents</span>
                <span className="text-zinc-200 tabular-nums font-semibold">35%</span>
              </div>

              {/* Row 4: opencode 444 */}
              <div className="flex items-center justify-between font-mono text-xs pt-1">
                <span className="px-2 py-0.5 rounded border border-zinc-700/80 bg-zinc-900 text-zinc-300">
                  {topErrors[0]?.name || 'opencode'}
                </span>
                <span className="text-zinc-300 tabular-nums font-semibold">
                  {topErrors[0]?.count || 444}
                </span>
              </div>

              {/* Row 5: Top errors label 444 */}
              <div className="flex items-center justify-between font-mono text-xs">
                <span className="text-zinc-400">Top errors</span>
                <span className="text-rose-400 tabular-nums font-semibold">
                  {topErrors[0]?.count || 444}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Ambient Bottom Telemetry Snapshot Teaser */}
        <div className="p-3 m-3 bg-[#0d0d10] border border-zinc-800/80 rounded font-mono text-[10px] space-y-1 select-none opacity-85">
          <div className="flex items-center justify-between text-zinc-500">
            <span className="text-zinc-400">CLUSTER CONSENSUS</span>
            <span className="text-emerald-400">9/9 HEALTHY</span>
          </div>
          <div className="text-zinc-600 truncate">
            Epoch #492 verified • 0 dropped packets
          </div>
        </div>
      </div>
    </div>
  );
};

export default LogStreamViewer;
