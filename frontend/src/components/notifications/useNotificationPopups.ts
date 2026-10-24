import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppNotification, NotificationPage } from '../../api/notifications';

export function useNotificationPopups(userId: string, page: NotificationPage | undefined, canShow: boolean) {
  const storageKey = `filtroapp:notification-popups:${userId}`;
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem(storageKey) !== 'disabled'; }
    catch { return true; }
  });
  const [queue, setQueue] = useState<AppNotification[]>([]);
  const lastSnapshot = useRef<string | null>(null);
  const seenIds = useRef(new Set<string>());

  useEffect(() => {
    // Ao consultar a central, os avisos passam a ser acompanhados pela lista.
    if (!canShow) setQueue([]);
  }, [canShow]);

  useEffect(() => {
    if (!page) return;
    // A primeira consulta estabelece a referência, sem reapresentar o histórico.
    const previous = lastSnapshot.current;
    const incoming = previous ? page.items.filter(item => !item.readAt
      && item.kind !== 'BACKUP_FAILED'
      && item.createdAt >= previous && !seenIds.current.has(item.id)) : [];
    if (!previous || page.snapshotAt > previous) {
      lastSnapshot.current = page.snapshotAt;
      seenIds.current = new Set(page.items.map(item => item.id));
    } else {
      page.items.forEach(item => seenIds.current.add(item.id));
    }
    if (enabled && canShow && incoming.length) {
      // Mostrar no máximo três avisos em sequência, começando pelo mais recente.
      setQueue(current => [...current, ...incoming.slice(0, 3)].slice(0, 3));
    }
  }, [page, enabled, canShow]);

  const dismiss = useCallback((id: string) => {
    setQueue(current => current.filter(item => item.id !== id));
  }, []);

  const changeEnabled = (value: boolean) => {
    setEnabled(value);
    if (!value) setQueue([]);
    try { localStorage.setItem(storageKey, value ? 'enabled' : 'disabled'); }
    catch { /* A preferência continua válida nesta sessão sem armazenamento local. */ }
  };

  useEffect(() => {
    const syncPreference = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) {
        const value = event.key === null || event.newValue !== 'disabled';
        setEnabled(value);
        if (!value) setQueue([]);
      }
    };
    window.addEventListener('storage', syncPreference);
    return () => window.removeEventListener('storage', syncPreference);
  }, [storageKey]);

  return { enabled, changeEnabled, dismiss, popup: queue[0] };
}
