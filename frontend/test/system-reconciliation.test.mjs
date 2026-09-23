import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const systems = ['compatible', 'wrong-service', 'old'].map(id => ({ id, projectId: 'p', equipment: 'UG 01', name: `Sistema ${id}`, aliases: [], revision: 1 }));
const item = { itemIndex: 0, measurementKey: '0', serviceType: 'pressao', equipment: 'UG antiga', system: 'Nome antigo', diameter: '6', quantity: 20, unit: 'm', projectSystemId: 'old',
  reconciliation: { status: 'NO_SYSTEM_SCOPE', message: 'O sistema identificado não possui meta para este serviço.', matchedSystem: systems[2], compatibleSystemIds: ['compatible'] } };
const report = { id: 'h', source: 'HISTORICAL', projectId: 'p', reportType: 'RTP', sequenceNumber: 1, reportDate: '2026-03-01', revision: 3, items: [item] };

async function fixture(fn) {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname, esbuild: { jsx: 'automatic' },
    server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const { ToastProvider } = await server.ssrLoadModule('/src/components/ui/Toast.tsx');
  const render = (node, path = '/') => renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, { initialEntries: [path] }, createElement(ToastProvider, null, node))));
  try { await fn({ server, client, render }); }
  finally { client.clear(); await server.close(); }
}

test('a conciliação mostra vínculos antigos sem descartá-los e oferece apenas novos destinos compatíveis', async () => fixture(async ({ server, client, render }) => {
  const { ProjectSystemReconciliation } = await server.ssrLoadModule('/src/components/projects/ProjectSystemReconciliation.tsx');
  client.setQueryData(['system-reconciliation', 'p'], { project: { id: 'p', code: '5719', name: 'Missão teste' }, reports: [report] });
  client.setQueryData(['project-systems', 'scope', 'p'], systems);
  client.setQueryData(['project-progress', 'p'], { hasScope: false, services: [] });
  const html = render(createElement(ProjectSystemReconciliation, { projectId: 'p', canManage: true, onBack() {} }));
  assert.match(html, /RTP 001/);
  assert.match(html, /UG antiga · Nome antigo/);
  assert.match(html, /Sistema old/);
  assert.match(html, /<option value="old" disabled="" selected=""/);
  assert.match(html, /<option value="compatible"/);
  assert.doesNotMatch(html, /<option value="wrong-service"/);
  assert.match(html, /vínculo salvo sem meta compatível/);
  assert.match(html, /somente para esta medição/);
  assert.match(html, /Selecionar até 200 medições/);
  assert.doesNotMatch(html, /Por nome|Por medição|Confirmar equivalência/);
  assert.deepEqual(client.getQueryData(['system-reconciliation', 'p']).reports, [report]);
  const readOnly = render(createElement(ProjectSystemReconciliation, { projectId: 'p', canManage: false, onBack() {} }));
  assert.doesNotMatch(readOnly, /Sistema desta medição|Salvar vínculo|Selecionar medição|Aplicar às selecionadas/);
  assert.match(readOnly, /Consulta disponível/);
}));

test('upload preserva quantitativos e edição, remove seletores e encaminha para a missão correta no Acompanhamento', async () => fixture(async ({ server, client, render }) => {
  const { HistoricalServicesContent } = await server.ssrLoadModule('/src/pages/gestor/HistoricalServicesModal.tsx');
  const { AuthContext } = await server.ssrLoadModule('/src/auth/AuthContext.ts');
  const { systemReconciliationPath } = await server.ssrLoadModule('/src/api/systemReconciliation.ts');
  client.setQueryData(['historical-services', 'p'], [report]);
  const content = user => render(createElement(AuthContext.Provider, { value: { user } }, createElement(HistoricalServicesContent, {
    projectId: 'p', projects: [{ id: 'p', code: '5719', name: 'Missão teste' }], onProjectChange() {}, onBusyChange() {}
  })));
  const html = content({ accountType: 'ADMIN', moduleRoles: ['acompanhamento:manager'] });
  assert.match(html, /RTP 001/);
  assert.match(html, /20 m/);
  assert.match(html, /Editar/);
  assert.match(html, /href="\/acompanhamento\?section=projetos&amp;project=p&amp;reconcile=1"/);
  assert.doesNotMatch(html, /Salvar vínculo|Vincular UG|Sistema no acompanhamento/);
  assert.deepEqual(client.getQueryData(['historical-services', 'p']), [report]);
  for (const accountType of ['INTERNAL', 'ADMIN']) {
    const denied = content({ accountType, moduleRoles: ['rdo:manager'] });
    assert.match(denied, /Solicite a conferência/);
    assert.doesNotMatch(denied, /href="\/acompanhamento|Conciliar sistemas no Acompanhamento/);
  }
  assert.equal(systemReconciliationPath('project a&b'), '/acompanhamento?section=projetos&project=project%20a%26b&reconcile=1');
}));

test('link direto da conciliação e do projeto respeita a proteção do módulo, inclusive para ADMIN sem papel', async () => fixture(async ({ server, render }) => {
  const { RoleRoute } = await server.ssrLoadModule('/src/auth/RoleRoute.tsx');
  const { AuthContext } = await server.ssrLoadModule('/src/auth/AuthContext.ts');
  const { moduleRouteAccess, moduleRoutePath } = await server.ssrLoadModule('/src/modules/registry.ts');
  const { systemReconciliationPath } = await server.ssrLoadModule('/src/api/systemReconciliation.ts');
  const routes = createElement(Routes, null,
    createElement(Route, { element: createElement(RoleRoute, moduleRouteAccess('acompanhamento')) },
      createElement(Route, { path: moduleRoutePath('acompanhamento', 'index'), element: createElement('p', null, 'cronograma-conciliacao-autorizado') })));
  for (const path of [systemReconciliationPath('p'), '/acompanhamento?section=projetos&project=p']) {
    for (const accountType of ['INTERNAL', 'ADMIN']) {
      for (const moduleRoles of [[], ['rdo:manager'], ['acompanhamento:viewer'], ['acompanhamento:manager']]) {
        const user = { id: 'permissions-test', accountType, role: 'MANAGER', moduleRoles };
        const html = render(createElement(AuthContext.Provider, { value: { user, token: 'test', isAuthenticated: true, isBootstrapping: false } }, routes), path);
        assert.equal(html.includes('cronograma-conciliacao-autorizado'), moduleRoles.some(role => role.startsWith('acompanhamento:')),
          `${accountType} / ${moduleRoles.join(',')} / ${path}`);
      }
    }
    const anonymous = render(createElement(AuthContext.Provider, { value: { user: null, isAuthenticated: false, isBootstrapping: false } }, routes), path);
    assert.doesNotMatch(anonymous, /cronograma-conciliacao-autorizado/);
  }
}));
