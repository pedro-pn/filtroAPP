import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../src/api/client';
import { AuthContext } from '../../src/auth/AuthContext';
import type { AuthUser } from '../../src/types/auth';
import type { AppNotification } from '../../src/api/notifications';
import { TopBar } from '../../src/layout/TopBar';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import '../../src/styles/variables.css';
import '../../src/styles/foundation.css';
import '../../src/layout/AppShell.css';

const state = { userId: 'manager', failRead: false, failList: false, failPage: false, failAll: false, read: JSON.parse(sessionStorage.getItem('notification-fixture-reads') || '{}') as Record<string, string[]> };
Object.assign(window, { notificationFixture: state });
const persist = () => sessionStorage.setItem('notification-fixture-reads', JSON.stringify(state.read));
const kinds = ['PROJECT_CREATED', 'REPORT_PENDING', 'PROPOSAL_RECEIVED'] as const;
const titles = ['Novo projeto cadastrado', 'Relatório pendente de revisão', 'Nova proposta extra escopo'];
const events: AppNotification[] = Array.from({ length: 23 }, (_, index) => ({
  id: `event-${index}`, kind: kinds[index % 3], title: titles[index % 3],
  description: `${index + 5800} — Projeto de teste com descrição suficientemente longa para validar quebra de linha no celular`,
  href: `?opened=${index}`, createdAt: new Date(Date.UTC(2026, 9, 21, 12, 0, 0) - index * 60000).toISOString(), readAt: null
}));
apiClient.defaults.adapter = async config => {
  const url = config.url || '';
  const read = new Set(state.read[state.userId] || []);
  let data: unknown;
  if (config.method === 'get') {
    if (state.failList) throw new Error('Falha de consulta simulada');
    if (config.params.cursor && state.failPage) throw new Error('Falha de página simulada');
    const visible = state.userId === 'manager' ? events : [];
    const filtered = visible.filter(item => config.params.filter !== 'unread' || !read.has(item.id));
    const offset = Number(config.params.cursor || 0);
    data = { items: filtered.slice(offset, offset + 20).map(item => ({ ...item, readAt: read.has(item.id) ? new Date().toISOString() : null })),
      unreadCount: visible.filter(item => !read.has(item.id)).length, snapshotAt: new Date().toISOString(),
      nextCursor: filtered.length > offset + 20 ? String(offset + 20) : null };
  } else {
    if (state.failRead) throw new Error('Falha de leitura simulada');
    if (url.endsWith('/read-all')) {
      if (state.failAll) throw new Error('Falha de leitura em lote simulada');
      events.forEach(item => read.add(item.id));
    } else read.add(url.split('/')[2]);
    state.read[state.userId] = [...read]; persist(); data = { ok: true };
  }
  return { data, status: 200, statusText: 'OK', headers: {}, config };
};

function Fixture() {
  const [userId, setUserId] = useState('manager');
  const location = useLocation();
  const user: AuthUser = { id: userId, username: userId, name: 'Conta de teste', email: null,
    role: userId === 'manager' ? 'MANAGER' : 'COLLABORATOR', accountType: userId === 'manager' ? 'ADMIN' : 'INTERNAL',
    moduleRoles: userId === 'manager' ? ['rdo:manager'] : ['equipamentos:viewer'], reportEmissionPermissions: ['SITE_RDO'], isActive: true };
  return <AuthContext.Provider value={{ user, token: 'fake', isAuthenticated: true, isBootstrapping: false,
    login: async () => {}, logout: async () => {}, refreshUser: async () => {}, replaceUser: () => {} }}>
    <ThemeProvider>
      <TopBar appearance="design-system" title="Projetos" profile={{ name: 'Conta de teste' }} />
      <main className="fv-ds" style={{ padding: 24 }}>
        <h1>Central de notificações</h1>
        <button onClick={() => { const next = userId === 'manager' ? 'equipment' : 'manager'; state.userId = next; setUserId(next); }}>Trocar conta</button>
        <output aria-label="Destino">{location.search}</output>
      </main>
    </ThemeProvider>
  </AuthContext.Provider>;
}

createRoot(document.getElementById('root')!).render(<BrowserRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Fixture /></QueryClientProvider></BrowserRouter>);
