import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../src/api/client';
import type { NotificationConfig, NotificationRecipient } from '../../src/api/equipamentos';
import { ToastProvider } from '../../src/components/ui/Toast';
import { NotificationsConfig } from '../../src/pages/equipamentos/NotificationsConfig';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import '../../src/styles/variables.css';
import '../../src/styles/foundation.css';
import '../../src/styles/legacy.css';
import '../../src/pages/equipamentos/EquipmentConfig.ds.css';

const storageKey = 'equipment-notifications-fixture';
const stored = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
const state = {
  config: (stored?.config || { enabled: true, notifyOnEquipmentCreated: false, milestoneDays: [30, 15, 7],
    notifyOnDueDay: true, repeatExpired: true, repeatGapDays: 5 }) as NotificationConfig,
  recipients: (stored?.recipients || [
    { id: 'external', email: 'manutencao@example.com', userId: null, isActive: true,
      notifyCalibrationReminders: true, notifyCalibrationUpdated: true, notifyEquipmentCreated: false },
    { id: 'account', email: 'gestor@example.com', userId: 'user-1', isActive: true,
      notifyCalibrationReminders: false, notifyCalibrationUpdated: true, notifyEquipmentCreated: true }
  ]) as NotificationRecipient[],
  failNextWrite: false,
  calls: [] as Array<{ url: string; body: unknown }>
};
Object.assign(window, { equipmentNotificationsFixture: state });
apiClient.defaults.adapter = async config => {
  const url = config.url || '';
  const method = config.method || 'get';
  const body = config.data ? JSON.parse(config.data) : {};
  if (method !== 'get') {
    state.calls.push({ url, body });
    if (state.failNextWrite) {
      state.failNextWrite = false;
      throw new Error('Falha simulada ao salvar preferências');
    }
  }
  let data: unknown;
  if (url.endsWith('/notifications/config')) {
    if (method === 'put') state.config = { ...state.config, ...body };
    data = state.config;
  } else if (url.endsWith('/notifications/accounts')) {
    data = [
      { id: 'user-1', name: 'Gestor', email: 'gestor@example.com' },
      { id: 'user-2', name: 'Compras', email: 'compras@example.com' }
    ];
  } else if (url.endsWith('/notifications/recipients')) {
    if (method === 'post') {
      const recipient = { id: `new-${state.recipients.length}`, userId: body.userId || null,
        email: body.email || 'compras@example.com', isActive: true,
        notifyCalibrationReminders: true, notifyCalibrationUpdated: true, notifyEquipmentCreated: false };
      state.recipients.push(recipient);
      data = recipient;
    } else data = state.recipients;
  } else if (url.includes('/notifications/recipients/')) {
    const id = url.split('/').at(-1);
    if (method === 'delete') state.recipients = state.recipients.filter(item => item.id !== id);
    else state.recipients = state.recipients.map(item => item.id === id ? { ...item, ...body } : item);
    data = state.recipients.find(item => item.id === id) || null;
  } else throw new Error(`API não simulada: ${url}`);
  sessionStorage.setItem(storageKey, JSON.stringify({ config: state.config, recipients: state.recipients }));
  return { data: structuredClone(data), status: 200, statusText: 'OK', headers: {}, config };
};

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}><ThemeProvider><ToastProvider>
    <main className="fv-ds equip-page-v2" style={{ maxWidth: 1040, margin: 'auto', padding: 20 }}>
      <h1>Notificações de equipamentos</h1>
      <NotificationsConfig />
    </main>
  </ToastProvider></ThemeProvider></QueryClientProvider>
);
