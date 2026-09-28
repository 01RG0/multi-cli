import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bell } from 'lucide-react';
import { useNotifications, type Notification, type NotifType } from '../hooks/useNotifications';

const TYPE_COLOR: Record<NotifType, string> = {
  success:    '#22c55e',
  info:       '#3b82f6',
  warning:    '#f59e0b',
  error:      '#ef4444',
  upgrade:    '#a855f7',
  autonomous: '#06b6d4',
};

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ── Toast ──────────────────────────────────────────────────────────────────
interface ToastItem extends Notification {
  dismissAt: number;
}

function Toast({ item, onDismiss, onClick }: { item: ToastItem; onDismiss: () => void; onClick: () => void }) {
  const color = TYPE_COLOR[item.type] ?? '#3b82f6';
  return (
    <div
      onClick={() => { onClick(); onDismiss(); }}
      style={{
        borderLeft: `3px solid ${color}`,
        animation: 'slideInRight 0.25s ease',
      }}
      className="cursor-pointer flex items-start gap-3 px-4 py-3 rounded-lg shadow-xl"
      css-override="bg-[#1e1e2e] text-white"
      // inline style for full control
    >
      <span style={{ color, marginTop: 2, fontSize: 8 }}>●</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-white truncate">{item.title}</p>
        {item.message && (
          <p className="text-[11px] text-zinc-400 truncate mt-0.5">{item.message}</p>
        )}
      </div>
      <button
        onClick={e => { e.stopPropagation(); onDismiss(); }}
        className="text-zinc-500 hover:text-white text-xs ml-1"
      >✕</button>
    </div>
  );
}

function ToastContainer({ toasts, onDismiss, onOpen }: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  onOpen: () => void;
}) {
  return (
    <div
      style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 99999, display: 'flex', flexDirection: 'column', gap: 8, width: 320 }}
    >
      {toasts.map(t => (
        <Toast key={t.id} item={t} onDismiss={() => onDismiss(t.id)} onClick={onOpen} />
      ))}
    </div>
  );
}

// ── Panel ──────────────────────────────────────────────────────────────────
function NotifRow({ n }: { n: Notification }) {
  const color = TYPE_COLOR[n.type] ?? '#3b82f6';
  return (
    <div
      style={{ opacity: n.read ? 0.6 : 1 }}
      className="flex items-start gap-3 px-4 py-3 border-b border-zinc-800 hover:bg-zinc-900 transition"
    >
      <span style={{ color, marginTop: 4, fontSize: 8, flexShrink: 0 }}>●</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-white truncate">{n.title}</p>
        {n.message && (
          <p className="text-[11px] text-zinc-400 mt-0.5 line-clamp-2">{n.message}</p>
        )}
      </div>
      <span className="text-[10px] text-zinc-600 font-mono whitespace-nowrap ml-2 mt-0.5">{timeAgo(n.ts)}</span>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────
export const NotificationCenter: React.FC = () => {
  const { notifications, unreadCount, markAllRead, clearAll } = useNotifications();
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(notifications.length);

  // Generate toasts for new notifications
  useEffect(() => {
    if (notifications.length <= prevCountRef.current) {
      prevCountRef.current = notifications.length;
      return;
    }
    const newOnes = notifications.slice(0, notifications.length - prevCountRef.current);
    prevCountRef.current = notifications.length;

    setToasts(prev => {
      const items: ToastItem[] = newOnes.map(n => ({ ...n, dismissAt: Date.now() + 5000 }));
      return [...items, ...prev].slice(0, 3);
    });
  }, [notifications]);

  // Auto-dismiss toasts
  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setToasts(prev => prev.filter(t => t.dismissAt > now));
    }, 500);
    return () => clearInterval(timer);
  }, [toasts.length]);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Close panel on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleOpen = useCallback(() => {
    setOpen(o => {
      if (!o) markAllRead();
      return !o;
    });
  }, [markAllRead]);

  return (
    <>
      {/* Bell Button */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={handleOpen}
          className="relative flex items-center justify-center w-8 h-8 rounded hover:bg-zinc-800 transition text-zinc-400 hover:text-white"
          title="Notifications"
        >
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span
              style={{ background: '#ef4444', fontSize: 9, minWidth: 14, height: 14 }}
              className="absolute -top-0.5 -right-0.5 flex items-center justify-center rounded-full text-white font-bold px-1"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {/* Dropdown Panel */}
        {open && (
          <div
            ref={panelRef}
            style={{
              position: 'fixed',
              top: 56,
              right: 16,
              width: 380,
              maxHeight: 480,
              zIndex: 9999,
              background: '#0d0d1a',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 12,
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
              <span className="text-xs font-bold text-white tracking-wider">NOTIFICATIONS</span>
              <div className="flex items-center gap-3">
                {notifications.length > 0 && (
                  <button
                    onClick={clearAll}
                    className="text-[11px] text-zinc-500 hover:text-white transition"
                  >
                    Clear all
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="text-zinc-500 hover:text-white text-xs"
                >✕</button>
              </div>
            </div>

            {/* List */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-zinc-600 text-xs gap-2">
                  <Bell className="w-6 h-6 opacity-30" />
                  <span>No notifications yet</span>
                </div>
              ) : (
                notifications.slice(0, 50).map(n => <NotifRow key={n.id} n={n} />)
              )}
            </div>
          </div>
        )}
      </div>

      {/* Toast Container */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} onOpen={handleOpen} />

      {/* Global style for toast animation */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(120%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </>
  );
};

export default NotificationCenter;
