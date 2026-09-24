import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createServer } from 'vite';

async function fixture(run) {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const render = (Component, props) => renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Component, props)));
  try { await run({ server, client, render }); }
  finally { client.clear(); await server.close(); }
}

const invoice = (receiptStatus, index) => ({
  id: `invoice-${index}`, type: index % 2 ? 'NFE' : 'NFSE', number: String(100 + index), series: index ? 'A' : null,
  issuedAt: '2026-09-15T12:00:00.000Z', amount: 1234.56 + index,
  customerName: 'Cliente externo', customerCnpj: '12345678000199', customerDiffers: true,
  receiptStatus, installmentCount: index ? 2 : 1,
  project: { id: 'p', code: '4069', name: 'Missão de teste' }
});

test('faturamentos mantêm valores, recebimento, grupo e estados Omie na interface DS', async () => fixture(async ({ server, client, render }) => {
  const { ProjectInvoicesSection } = await server.ssrLoadModule('/src/components/projects/ProjectInvoicesSection.tsx');
  const statuses = ['RECEIVED', 'PARTIAL', 'OVERDUE', 'OPEN', 'UNKNOWN'];
  const invoices = Array.from({ length: 11 }, (_, index) => invoice(statuses[index % statuses.length], index));
  const snapshot = { invoices, total: 13641.16, count: 11, linkedProjectCount: 1, projectCount: 2,
    lastSyncedAt: '2026-09-16T10:00:00.000Z', syncStatus: 'STALE' };
  client.setQueryData(['project-invoices', 'group', 'g'], snapshot);
  const group = render(ProjectInvoicesSection, { groupId: 'g' });
  for (const label of ['Faturamentos realizados', 'NFS-e 100', 'NF-e 101', 'Recebido parcialmente', 'Em atraso', 'A receber', 'Não informado', '2 parcelas', 'Missão', '4069', 'Tomador diferente do cadastro do projeto', 'R$']) {
    assert.ok(group.includes(label), label);
  }
  assert.match(group, /fv-data-table/);
  assert.match(group, /fv-pagination/);
  assert.match(group, /A última atualização no Omie falhou/);
  assert.match(group, /Há missões deste grupo sem vínculo/);
  assert.doesNotMatch(group, /page-card|mini-btn|badge-ok/);

  client.getQueryCache().find({ queryKey: ['project-invoices', 'group', 'g'] })?.setState({
    status: 'error', error: new Error('Falha de atualização'), fetchStatus: 'idle'
  });
  const cached = render(ProjectInvoicesSection, { groupId: 'g' });
  assert.match(cached, /Não foi possível atualizar os faturamentos/);
  assert.match(cached, /NFS-e 100/);

  client.setQueryData(['project-invoices', 'project', 'p'], { ...snapshot, linkedProjectCount: 1, projectCount: 1 });
  const project = render(ProjectInvoicesSection, { projectId: 'p' });
  assert.match(project, /para este projeto/);
  assert.doesNotMatch(project, /Há missões deste grupo sem vínculo/);

  client.setQueryData(['project-invoices', 'project', 'p'], { ...snapshot, invoices: [], total: 0, count: 0,
    lastSyncedAt: null, syncStatus: 'UPDATING' });
  assert.match(render(ProjectInvoicesSection, { projectId: 'p' }), /Consultando o histórico de faturamentos no Omie/);
}));

test('avanço usa apresentação DS só no detalhe e mantém percentual acima de 100%', async () => fixture(async ({ server, client, render }) => {
  const { ProjectProgressBreakdown } = await server.ssrLoadModule('/src/components/projects/ProjectProgressBreakdown.tsx');
  const service = { serviceType: 'TESTE_PRESSAO', weight: 100, executionPct: 120,
    systems: [{ projectSystemId: 'system-1', equipment: 'UG 01', systemName: 'Linha A',
      systemType: 'TUBULACAO', unit: 'M', plannedQty: 10, realizedQty: 12, pct: 120 }] };
  client.setQueryData(['project-progress', 'p'], { hasScope: true, progressPct: 120, services: [service],
    scopeGroups: [{ scopeName: 'Escopo principal', services: [service] }], pendingMeasurements: [] });
  const detail = render(ProjectProgressBreakdown, { projectId: 'p', appearance: 'design-system',
    filter: { scopeKey: '', equipmentKey: '' } });
  assert.match(detail, /data-acp-progress-ds/);
  assert.match(detail, /120%/);
  assert.match(detail, /Escopo principal/);
  assert.match(detail, /UG 01 · Linha A/);
  assert.match(detail, /fv-progress-bar/);
  assert.doesNotMatch(detail, /acp-prog-bar big/);

  const shared = render(ProjectProgressBreakdown, { projectId: 'p' });
  assert.match(shared, /class="acp-progress"/);
  assert.doesNotMatch(shared, /data-acp-progress-ds/);
}));
