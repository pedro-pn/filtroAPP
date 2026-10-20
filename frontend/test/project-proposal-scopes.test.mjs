import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createServer } from 'vite';

test('vínculos: cada projeto usa seus próprios serviços e respeita o acesso de consulta', async t => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false, ws: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  try {
    const { ProjectProposalScopes } = await server.ssrLoadModule('/src/components/projects/ProjectProposalScopes.tsx');
    const { ToastContext } = await server.ssrLoadModule('/src/components/ui/ToastContext.ts');
    const scope = (key, label) => ({ key, label, kind: 'MAIN', source: 'ACCESS_IMPORT', revision: 1,
      parentProposalCode: null, progress: { progressPct: 0, services: [] }, serviceCount: 1 });
    const service = { reportId: 'r25', reportType: 'RDO', number: 25, date: '2026-10-10',
      version: 'd'.repeat(64), serviceKey: 'e'.repeat(64), serviceType: 'limpeza',
      system: 'Vaso do compressor · 845-VK-001A1', contributionKey: null, method: 'INFERRED', count: 2 };
    client.setQueryData(['proposal-scopes', 'p1'], {
      scopes: [scope('ACCESS_IMPORT:4586', 'Adicional 4586')], services: [service], pending: 1
    });
    client.setQueryData(['proposal-scopes', 'p2'], {
      scopes: [scope('ACCESS_IMPORT:4800', 'Adicional 4800')], pending: 0,
      services: [{ ...service, reportId: 'r3', number: 3, serviceType: 'pressao', system: 'Linha da usina · L-203',
        contributionKey: 'ACCESS_IMPORT:4800', method: 'MANUAL', count: 1 }]
    });
    const render = (projectId, canManage) => renderToStaticMarkup(createElement(QueryClientProvider, { client },
      createElement(ToastContext.Provider, { value: { showToast() {} } },
        createElement(ProjectProposalScopes, { projectId, canManage }))));
    await t.test('serviço pendente mostra sua identificação, proposta e edição contextual', () => {
      const html = render('p1', true);
      for (const text of ['Adicional 4586', 'RDO 25', '10/10/2026', 'Limpeza química', '845-VK-001A1',
        '2 registros iguais', '1 serviço sem proposta definida', 'Pendentes (1)', 'Vincular proposta',
        'Buscar serviço ou RDO', 'aria-expanded="false"']) assert.ok(html.includes(text), text);
      assert.doesNotMatch(html, /Adicional 4800|Linha da usina|Somente consulta|<form/);
    });
    await t.test('trocar o projeto não reutiliza os serviços nem as propostas do anterior', () => {
      const html = render('p2', true);
      for (const text of ['Adicional 4800', 'RDO 3', 'Teste de pressão', 'Linha da usina',
        'Todos os serviços têm proposta definida.', 'Vínculo manual', 'Alterar vínculo']) assert.ok(html.includes(text), text);
      assert.doesNotMatch(html, /Adicional 4586|845-VK-001A1|RDO 25|Vincular proposta/);
    });
    await t.test('consulta preserva serviços e filtros sem expor edição', () => {
      const html = render('p1', false);
      assert.match(html, /Somente consulta/);
      assert.match(html, /Vaso do compressor/);
      assert.match(html, /Pendentes \(1\)/);
      assert.doesNotMatch(html, /Vincular proposta|Alterar vínculo|<form/);
    });
    await t.test('projeto sem serviços apresenta lista vazia e continua consultável', () => {
      client.setQueryData(['proposal-scopes', 'empty'], { scopes: [], services: [], pending: 0 });
      const html = render('empty', true);
      assert.match(html, /Nenhum serviço encontrado/);
      assert.doesNotMatch(html, /Vaso do compressor|Linha da usina/);
    });
  } finally { client.clear(); await server.close(); }
});
