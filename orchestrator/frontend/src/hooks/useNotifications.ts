import { useState, useEffect, useCallback, useRef } from 'react';

export type NotifType = 'success' | 'info' | 'warning' | 'error' | 'upgrade' | 'autonomous';

export interface Notification {
  id: string;
  type: NotifType;
  title: string;
  message: string;
  ts: number;
  read: boolean;
  source?: string;
}

const STORAGE_KEY = 'ultron_notifications';
const CAP = 100;

function load(): Notification[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function save(n: Notification[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(n.slice(0, CAP)));
  } catch {}
}

// Global event emitter so non-hook code can push notifications
export function fireNotification(n: Omit<Notification, 'id' | 'read' | 'ts'> & Partial<Pick<Notification, 'id' | 'read' | 'ts'>>) {
  window.dispatchEvent(new CustomEvent('ultron:notify', {
    detail: {
      id: n.id ?? crypto.randomUUID(),
      read: n.read ?? false,
      ts: n.ts ?? Date.now(),
      ...n,
    } satisfies Notification,
  }));
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>(load);
  const wsRef = useRef<WebSocket | null>(null);

  const addNotification = useCallback((n: Notification) => {
    setNotifications(prev => {
      const next = [n, ...prev].slice(0, CAP);
      save(next);
      return next;
    });
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications(prev => {
      const next = prev.map(n => ({ ...n, read: true }));
      save(next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }, []);

  // Listen for ultron:notify DOM events (from tool executors, other components)
  useEffect(() => {
    const handler = (e: Event) => addNotification((e as CustomEvent<Notification>).detail);
    window.addEventListener('ultron:notify', handler);
    return () => window.removeEventListener('ultron:notify', handler);
  }, [addNotification]);

  // WebSocket → notifications
  useEffect(() => {
    const wsUrl = window.location.origin.replace(/^http/, 'ws') + '/ws';
    let ws: WebSocket;
    let dead = false;

    function connect() {
      if (dead) return;
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data as string) as Record<string, unknown>;
          const n = mapWsEvent(data);
          if (n) addNotification(n);
        } catch {}
      };

      ws.onclose = () => {
        if (!dead) setTimeout(connect, 5000);
      };
    }

    connect();
    return () => {
      dead = true;
      ws?.close();
    };
  }, [addNotification]);

  const unreadCount = notifications.filter(n => !n.read).length;

  return { notifications, unreadCount, addNotification, markAllRead, clearAll };
}

function mapWsEvent(data: Record<string, unknown>): Notification | null {
  const type = data['type'] as string | undefined;
  if (!type) return null;

  const id = crypto.randomUUID();
  const ts = (data['ts'] as number) || Date.now();

  switch (type) {
    case 'autonomous_step_complete':
      return {
        id, ts, read: false, type: 'autonomous',
        title: `Step complete: ${String(data['description'] || '').slice(0, 50)}`,
        message: String(data['progress'] || data['result'] || ''),
        source: 'autonomous_task',
      };
    case 'autonomous_task_complete': {
      const status = String(data['status'] || 'completed');
      const notifType: NotifType = status === 'completed' ? 'success' : 'warning';
      return {
        id, ts, read: false, type: notifType,
        title: status === 'completed'
          ? `Task done: ${String(data['goal'] || '').slice(0, 50)}`
          : `Task ${status}: ${String(data['goal'] || '').slice(0, 40)}`,
        message: String(data['reason'] || `${data['steps_completed'] ?? ''} steps completed`),
        source: 'autonomous_task',
      };
    }
    case 'task_created':
      return {
        id, ts, read: false, type: 'info',
        title: 'Task queued',
        message: String((data['task'] as Record<string,unknown>)?.['prompt'] || '').slice(0, 80),
        source: 'queue',
      };
    case 'broadcast':
      if (data['from'] === 'ultron') {
        return {
          id, ts, read: false, type: 'info',
          title: 'Broadcast sent',
          message: String(data['message'] || '').slice(0, 80),
          source: 'broadcast',
        };
      }
      return null;
    case 'skill_added':
      return {
        id, ts, read: false, type: 'upgrade',
        title: `New skill: ${String(data['name'] || '')}`,
        message: String(data['description'] || ''),
        source: 'skill',
      };
    case 'memory_note':
      return {
        id, ts, read: false, type: 'upgrade',
        title: 'Memory note saved',
        message: String(data['note'] || '').slice(0, 80),
        source: 'memory',
      };
    case 'reminder_fired':
      return {
        id, ts, read: false, type: 'info',
        title: `Reminder: ${String(data['label'] || '')}`,
        message: String(data['text'] || ''),
        source: 'reminder',
      };
    case 'self_update':
      return {
        id, ts, read: false, type: 'upgrade',
        title: `ULTRON self-updated: ${String(data['detail'] || '').slice(0, 40)}`,
        message: String(data['message'] || ''),
        source: 'self',
      };
    case 'notification':
      return {
        id, ts, read: false,
        type: (data['type'] as NotifType) || 'info',
        title: String(data['title'] || 'Notification'),
        message: String(data['message'] || ''),
        source: String(data['source'] || ''),
      };
    default:
      return null;
  }
}
