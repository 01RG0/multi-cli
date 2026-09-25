import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Filter, Search, ChevronDown, Check, Minus,
  Terminal, Globe, Clock, MoreHorizontal,
  X, RefreshCw, Eye, ArrowUpCircle, Download,
  ChevronLeft, ChevronRight
} from 'lucide-react';
import { useSwarmStore, Task, TaskStatus, ViewFilter } from '../store/useSwarmStore';

const FILTER_OPTIONS: ViewFilter[] = ['ALL', 'RUNNING', 'PENDING', 'DONE', 'FAILED'];

const StatusBadge = ({ status }: { status: TaskStatus }) => {
  const styles: Record<TaskStatus, { badge: string; dot?: string }> = {
    running: {
      badge: 'bg-emerald-950/30 border-emerald-800/60 text-emerald-400',
      dot: 'bg-emerald-400 animate-pulse',
    },
    pending: {
      badge: 'bg-zinc-900 border-zinc-800 text-zinc-500',
      dot: 'bg-zinc-600',
    },
    completed: {
      badge: 'bg-zinc-800/70 border-zinc-700 text-zinc-200',
      dot: 'bg-zinc-400',
    },
    failed: {
      badge: 'bg-rose-950/30 border-rose-900/50 text-rose-400',
      dot: 'bg-rose-500',
    },
  };

  const style = styles[status] || styles.pending;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] uppercase font-mono font-semibold rounded-full border ${style.badge}`}>
      {style.dot && <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />}
      {status}
    </span>
  );
};

export const TaskQueueTable: React.FC = () => {
  const {
    tasks,
    agents,
    selectedTaskId,
    setSelectedTaskId,
    activeViewFilter,
    setActiveViewFilter,
    updateTask,
  } = useSwarmStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [menuOpenTaskId, setMenuOpenTaskId] = useState<string | null>(null);
  const [isBulkDropdownOpen, setIsBulkDropdownOpen] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const bulkDropdownRef = useRef<HTMLDivElement>(null);

  // Close context menu & dropdown when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) {
        setMenuOpenTaskId(null);
      }
      if (bulkDropdownRef.current && !bulkDropdownRef.current.contains(target)) {
        setIsBulkDropdownOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpenTaskId(null);
        setIsBulkDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Compute status counts dynamically
  const statusCounts = useMemo(() => {
    return {
      ALL: tasks.length,
      RUNNING: tasks.filter((t) => t.status === 'running').length,
      PENDING: tasks.filter((t) => t.status === 'pending').length,
      DONE: tasks.filter((t) => t.status === 'completed').length,
      FAILED: tasks.filter((t) => t.status === 'failed').length,
    };
  }, [tasks]);

  // Filter tasks by activeViewFilter and search query
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      // 1. Status Filter
      if (activeViewFilter === 'RUNNING' && task.status !== 'running') return false;
      if (activeViewFilter === 'PENDING' && task.status !== 'pending') return false;
      if (activeViewFilter === 'DONE' && task.status !== 'completed') return false;
      if (activeViewFilter === 'FAILED' && task.status !== 'failed') return false;

      // 2. Search Query Filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesId = task.id.toLowerCase().includes(query);
        const matchesPrompt = (task.prompt || task.preview || '').toLowerCase().includes(query);
        const matchesAgent = (task.agent?.name || task.agentId || '').toLowerCase().includes(query);
        const matchesStatus = task.status.toLowerCase().includes(query);
        if (!matchesId && !matchesPrompt && !matchesAgent && !matchesStatus) {
          return false;
        }
      }

      return true;
    });
  }, [tasks, activeViewFilter, searchQuery]);

  // Master selection helpers
  const allFilteredSelected =
    filteredTasks.length > 0 && filteredTasks.every((t) => selectedTasks.has(t.id));
  const someFilteredSelected =
    filteredTasks.some((t) => selectedTasks.has(t.id)) && !allFilteredSelected;

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      const next = new Set(selectedTasks);
      filteredTasks.forEach((t) => next.delete(t.id));
      setSelectedTasks(next);
    } else {
      const next = new Set(selectedTasks);
      filteredTasks.forEach((t) => next.add(t.id));
      setSelectedTasks(next);
    }
  };

  const toggleTaskSelection = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(selectedTasks);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedTasks(next);
  };

  // Context Menu Actions
  const handleActionView = (task: Task) => {
    setSelectedTaskId(task.id);
    setMenuOpenTaskId(null);
  };

  const handleActionReprioritize = (task: Task) => {
    const nextPriority = task.priority >= 10 ? 1 : task.priority + 1;
    updateTask(task.id, { priority: nextPriority });
    setMenuOpenTaskId(null);
  };

  const handleActionReassign = (task: Task) => {
    if (agents.length === 0) {
      setMenuOpenTaskId(null);
      return;
    }
    const currentIdx = agents.findIndex((a) => a.id === task.agentId);
    const nextAgent = agents[(currentIdx + 1) % agents.length] || agents[0];
    updateTask(task.id, {
      agentId: nextAgent.id,
      agent: { id: nextAgent.id, name: nextAgent.name },
    });
    setMenuOpenTaskId(null);
  };

  const handleActionCancel = (task: Task) => {
    updateTask(task.id, { status: 'failed' });
    setMenuOpenTaskId(null);
  };

  // Bulk Actions
  const handleBulkCancel = () => {
    selectedTasks.forEach((id) => {
      updateTask(id, { status: 'failed' });
    });
    setSelectedTasks(new Set());
    setIsBulkDropdownOpen(false);
  };

  const handleBulkReassign = () => {
    if (agents.length === 0) return;
    const taskIds = Array.from(selectedTasks);
    taskIds.forEach((id, index) => {
      const nextAgent = agents[index % agents.length];
      updateTask(id, {
        agentId: nextAgent.id,
        agent: { id: nextAgent.id, name: nextAgent.name },
      });
    });
    setSelectedTasks(new Set());
    setIsBulkDropdownOpen(false);
  };

  const handleBulkExport = () => {
    const selectedData = tasks.filter((t) => selectedTasks.has(t.id));
    const jsonStr = JSON.stringify(selectedData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `swarm-tasks-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setIsBulkDropdownOpen(false);
  };

  return (
    <div className="flex flex-col h-full w-full bg-black text-zinc-300 font-sans border border-zinc-800 rounded-lg overflow-hidden relative select-none">
      {/* ============================================================== */}
      {/* Top Bar Controls                                               */}
      {/* ============================================================== */}
      <div className="flex flex-wrap items-center justify-between p-3 border-b border-zinc-800 bg-[#09090b] gap-2 shrink-0">
        {/* Filter Pills with Counts */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
          {FILTER_OPTIONS.map((f) => {
            const isActive = activeViewFilter === f;
            const count = statusCounts[f];
            return (
              <button
                key={f}
                type="button"
                onClick={() => setActiveViewFilter(f)}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-mono font-medium rounded-full transition-all duration-150 border ${
                  isActive
                    ? 'bg-white text-black border-white shadow-sm font-semibold'
                    : 'bg-transparent text-zinc-400 border-zinc-800 hover:border-zinc-600 hover:text-zinc-200'
                }`}
              >
                <span>{f}</span>
                <span
                  className={`text-[10px] px-1 py-0.2 rounded font-mono ${
                    isActive ? 'bg-zinc-200 text-zinc-900' : 'bg-zinc-900 text-zinc-500'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
          <div className="w-px h-4 bg-zinc-800 mx-1 shrink-0" />
          <button
            type="button"
            onClick={() => setActiveViewFilter('ALL')}
            title="Reset Filters"
            className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-900 rounded transition-colors border border-transparent hover:border-zinc-800"
          >
            <Filter className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right Search & Bulk Actions Trigger */}
        <div className="flex items-center gap-2">
          {/* Search Input */}
          <div className="relative group">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-zinc-300 transition-colors pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tasks..."
              className="bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-200 placeholder:text-zinc-600 rounded-md pl-8 pr-7 py-1.5 focus:outline-none focus:border-zinc-500 focus:bg-zinc-900 w-36 sm:w-48 transition-all font-mono"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Bulk Actions Dropdown Anchor */}
          <div className="relative" ref={bulkDropdownRef}>
            <button
              type="button"
              onClick={() => setIsBulkDropdownOpen(!isBulkDropdownOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono font-medium bg-zinc-900 border border-zinc-800 hover:border-zinc-600 rounded-md transition-colors text-zinc-300"
            >
              <span>Bulk Actions</span>
              <ChevronDown className="w-3 h-3 text-zinc-400" />
            </button>

            {isBulkDropdownOpen && (
              <div className="absolute right-0 mt-1 w-44 bg-zinc-900 border border-zinc-700 rounded-md shadow-2xl py-1 z-30 font-mono text-xs animate-in fade-in zoom-in-95 duration-150">
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="w-full text-left px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 flex items-center justify-between"
                >
                  <span>{allFilteredSelected ? 'Deselect All' : 'Select All Filtered'}</span>
                </button>
                <button
                  type="button"
                  disabled={selectedTasks.size === 0}
                  onClick={handleBulkReassign}
                  className={`w-full text-left px-3 py-1.5 flex items-center gap-2 ${
                    selectedTasks.size === 0
                      ? 'text-zinc-600 cursor-not-allowed'
                      : 'text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Reassign Selected
                </button>
                <button
                  type="button"
                  disabled={selectedTasks.size === 0}
                  onClick={handleBulkExport}
                  className={`w-full text-left px-3 py-1.5 flex items-center gap-2 ${
                    selectedTasks.size === 0
                      ? 'text-zinc-600 cursor-not-allowed'
                      : 'text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  <Download className="w-3.5 h-3.5" /> Export Selected
                </button>
                <div className="h-px bg-zinc-800 my-1" />
                <button
                  type="button"
                  disabled={selectedTasks.size === 0}
                  onClick={handleBulkCancel}
                  className={`w-full text-left px-3 py-1.5 flex items-center gap-2 ${
                    selectedTasks.size === 0
                      ? 'text-zinc-600 cursor-not-allowed'
                      : 'text-rose-400 hover:bg-zinc-800'
                  }`}
                >
                  <X className="w-3.5 h-3.5" /> Cancel Selected
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* Table Area (Internal Smooth Scrolling)                         */}
      {/* ============================================================== */}
      <div className="flex-1 min-h-0 w-full overflow-auto bg-black relative scrollbar-thin scrollbar-thumb-zinc-800">
        <table className="w-full text-left text-sm whitespace-nowrap border-collapse">
          <thead className="sticky top-0 bg-[#09090b] border-b border-zinc-800 z-10 shadow-sm">
            <tr className="text-xs font-mono font-medium text-zinc-500">
              <th className="px-4 py-2.5 w-10 text-center">
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  title={allFilteredSelected ? 'Deselect all' : 'Select all'}
                  className={`w-4 h-4 rounded border flex items-center justify-center transition-colors mx-auto ${
                    allFilteredSelected
                      ? 'bg-white border-white text-black'
                      : someFilteredSelected
                      ? 'bg-zinc-800 border-zinc-500 text-white'
                      : 'border-zinc-700 hover:border-zinc-500 bg-transparent'
                  }`}
                >
                  {allFilteredSelected && <Check className="w-3 h-3 stroke-[3]" />}
                  {someFilteredSelected && <Minus className="w-3 h-3 stroke-[3]" />}
                </button>
              </th>
              <th className="px-4 py-2.5 w-16">#</th>
              <th className="px-4 py-2.5">TASK PREVIEW</th>
              <th className="px-4 py-2.5 w-44">AGENT</th>
              <th className="px-4 py-2.5 w-28">STATUS</th>
              <th className="px-4 py-2.5 w-20">PRIORITY</th>
              <th className="px-4 py-2.5 w-24">LATENCY</th>
              <th className="px-4 py-2.5 w-16 text-center">ACTIONS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-850">
            {filteredTasks.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-zinc-600 font-mono text-xs">
                  No tasks matching current filter or search criteria.
                </td>
              </tr>
            ) : (
              filteredTasks.map((task) => {
                const isSelected = selectedTasks.has(task.id);
                const isCurrentActive = selectedTaskId === task.id;
                const Icon =
                  task.icon === 'globe'
                    ? Globe
                    : task.icon === 'clock'
                    ? Clock
                    : Terminal;
                const agentBadge =
                  task.agent?.name?.slice(0, 2).toUpperCase() ||
                  task.agentId?.slice(0, 2).toUpperCase() ||
                  'AG';

                return (
                  <tr
                    key={task.id}
                    onClick={() => setSelectedTaskId(task.id)}
                    className={`group transition-colors duration-150 cursor-pointer relative ${
                      isCurrentActive
                        ? 'bg-zinc-850/80 hover:bg-zinc-800'
                        : isSelected
                        ? 'bg-zinc-900/60 hover:bg-zinc-850/60'
                        : 'hover:bg-zinc-900/50'
                    }`}
                  >
                    {/* Left Accent Indicator for selected active task */}
                    {isCurrentActive && (
                      <td className="absolute left-0 top-0 bottom-0 w-[3px] bg-white z-10 pointer-events-none" />
                    )}

                    {/* Checkbox Cell */}
                    <td
                      className="px-4 py-2.5 text-center"
                      onClick={(e) => toggleTaskSelection(task.id, e)}
                    >
                      <div
                        className={`w-4 h-4 rounded border mx-auto flex items-center justify-center transition-colors ${
                          isSelected
                            ? 'bg-white border-white text-black'
                            : 'border-zinc-700 group-hover:border-zinc-500 bg-transparent'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                    </td>

                    {/* Task ID */}
                    <td className="px-4 py-2.5 text-zinc-500 font-mono text-xs">
                      {task.id}
                    </td>

                    {/* Task Preview */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2 max-w-[280px] md:max-w-[340px]">
                        <Icon className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                        <span className="truncate font-mono text-xs text-zinc-200" title={task.prompt || task.preview}>
                          {task.preview || task.prompt}
                        </span>
                      </div>
                    </td>

                    {/* Assigned Agent */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[9px] font-mono font-bold text-zinc-300 shrink-0">
                          {agentBadge}
                        </div>
                        <span className="text-xs text-zinc-400 font-mono truncate max-w-[110px]">
                          {task.agent?.name || task.agentId}
                        </span>
                      </div>
                    </td>

                    {/* Status Badge */}
                    <td className="px-4 py-2.5">
                      <StatusBadge status={task.status} />
                    </td>

                    {/* Priority */}
                    <td className="px-4 py-2.5">
                      <span className="text-xs font-mono font-medium text-zinc-400 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded">
                        P{task.priority}
                      </span>
                    </td>

                    {/* Latency */}
                    <td className="px-4 py-2.5">
                      <span className="text-xs font-mono text-zinc-500">
                        {task.latency || (task.latencyMs > 0 ? `${task.latencyMs}ms` : '--')}
                      </span>
                    </td>

                    {/* Context Menu Actions Cell */}
                    <td className="px-4 py-2.5 text-center relative">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenTaskId(menuOpenTaskId === task.id ? null : task.id);
                        }}
                        className={`p-1.5 text-zinc-400 hover:text-white transition-colors rounded hover:bg-zinc-800 ${
                          menuOpenTaskId === task.id ? 'bg-zinc-800 text-white' : ''
                        }`}
                        title="Actions"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>

                      {/* Row Context Menu Popover */}
                      {menuOpenTaskId === task.id && (
                        <div
                          ref={menuRef}
                          onClick={(e) => e.stopPropagation()}
                          className="absolute right-8 top-1/2 -translate-y-1/2 w-36 bg-[#121215] border border-zinc-700 rounded-lg shadow-2xl z-50 py-1 overflow-hidden font-mono text-xs animate-in fade-in zoom-in-95 duration-150"
                        >
                          <button
                            type="button"
                            onClick={() => handleActionView(task)}
                            className="w-full text-left px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 hover:text-white flex items-center gap-2 transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5 text-zinc-400" />
                            <span>View</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleActionReprioritize(task)}
                            className="w-full text-left px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 hover:text-white flex items-center gap-2 transition-colors"
                          >
                            <ArrowUpCircle className="w-3.5 h-3.5 text-zinc-400" />
                            <span>Reprioritize</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleActionReassign(task)}
                            className="w-full text-left px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 hover:text-white flex items-center gap-2 transition-colors"
                          >
                            <RefreshCw className="w-3.5 h-3.5 text-zinc-400" />
                            <span>Reassign</span>
                          </button>
                          <div className="h-px bg-zinc-800 my-1" />
                          <button
                            type="button"
                            onClick={() => handleActionCancel(task)}
                            className="w-full text-left px-3 py-1.5 text-rose-400 hover:bg-rose-950/30 flex items-center gap-2 transition-colors"
                          >
                            <X className="w-3.5 h-3.5 text-rose-400" />
                            <span>Cancel</span>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ============================================================== */}
      {/* Footer                                                         */}
      {/* ============================================================== */}
      <div className="flex items-center justify-between p-3 border-t border-zinc-800 bg-[#09090b] text-xs font-mono text-zinc-500 shrink-0">
        <div>
          Showing {filteredTasks.length === 0 ? 0 : 1}-{filteredTasks.length} of {tasks.length} Tasks
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="p-1 hover:text-zinc-200 transition-colors border border-transparent hover:border-zinc-800 rounded disabled:opacity-40"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="px-2 py-0.5 text-zinc-400">1</span>
          <button
            type="button"
            className="p-1 hover:text-zinc-200 transition-colors border border-transparent hover:border-zinc-800 rounded disabled:opacity-40"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ============================================================== */}
      {/* Floating Bottom Bulk Action Bar                                */}
      {/* ============================================================== */}
      {selectedTasks.size > 0 && (
        <div className="absolute bottom-14 left-1/2 -translate-x-1/2 bg-zinc-900/95 backdrop-blur-md border border-zinc-700 rounded-full shadow-2xl flex items-center px-4 py-2 gap-3.5 animate-in fade-in slide-in-from-bottom-3 duration-200 z-40 select-none">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-mono font-semibold text-white whitespace-nowrap">
              {selectedTasks.size} {selectedTasks.size === 1 ? 'TASK' : 'TASKS'} SELECTED
            </span>
          </div>

          <div className="w-px h-4 bg-zinc-700" />

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleBulkCancel}
              className="px-3 py-1 text-xs font-mono text-rose-300 hover:text-white hover:bg-rose-950/40 border border-rose-900/40 hover:border-rose-700 rounded-full transition-all flex items-center gap-1.5"
              title="Cancel selected tasks"
            >
              <X className="w-3.5 h-3.5" />
              <span>Cancel</span>
            </button>
            <button
              type="button"
              onClick={handleBulkReassign}
              className="px-3 py-1 text-xs font-mono text-zinc-300 hover:text-white hover:bg-zinc-800 border border-zinc-700 hover:border-zinc-500 rounded-full transition-all flex items-center gap-1.5"
              title="Reassign selected tasks to next agent"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reassign</span>
            </button>
            <button
              type="button"
              onClick={handleBulkExport}
              className="px-3 py-1 text-xs font-mono text-zinc-300 hover:text-white hover:bg-zinc-800 border border-zinc-700 hover:border-zinc-500 rounded-full transition-all flex items-center gap-1.5"
              title="Export selected tasks to JSON"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export</span>
            </button>
          </div>

          <div className="w-px h-4 bg-zinc-700" />

          <button
            type="button"
            onClick={() => setSelectedTasks(new Set())}
            title="Clear selection"
            className="p-1 text-zinc-400 hover:text-white rounded-full hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};

export default TaskQueueTable;
