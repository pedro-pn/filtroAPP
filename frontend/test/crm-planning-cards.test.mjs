import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { cardMatchesView, parseCardsView } from '../src/components/projects/projectCardViews.ts';

test('Pausadas restaura pela URL e não seleciona projetos operacionais', () => {
  assert.equal(parseCardsView('pausadas'), 'pausadas');
  assert.equal(cardMatchesView({ category: 'FUTURO' }, 'pausadas'), false);
});

test('board separa sinalização, pausa e ganho pendente com os contadores correspondentes', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const { ProjectCardsBoard } = await server.ssrLoadModule('/src/components/projects/ProjectCardsBoard.tsx');
    const base = { kind: 'OPPORTUNITY', category: 'FUTURO', externalId: 'prisma-id', commercialStatus: 'OPEN', planningRequested: true,
      projectLinkStatus: 'NOT_REQUESTED', scopeKind: 'PRIMARY', targetProject: null, clientName: null, clientCnpj: null,
      location: null, proposalCode: null, revision: null, estimatedValue: null, expectedCloseDate: null, expectedStartDate: null,
      externalUrl: 'https://example.invalid/deal', sourceUpdatedAt: '2026-10-20T12:00:00Z' };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
    client.setQueryData(['project-cards'], [
      { ...base, id: 'open', name: 'Negociação sinalizada' },
      { ...base, id: 'won', name: 'Venda confirmada incompleta', commercialStatus: 'WON', projectLinkStatus: 'PENDING_DATA', planningRequested: false },
      { ...base, id: 'paused', name: 'Cliente adiou negociação', category: 'PAUSADA', commercialStatus: 'POSTPONED', scopeKind: 'ADDITIONAL', targetProject: { id: 'p1', code: '6100' } }
    ]);
    const render = view => renderToStaticMarkup(createElement(QueryClientProvider, { client },
      createElement(MemoryRouter, { initialEntries: [`/?cards=${view}`] }, createElement(ProjectCardsBoard))));
    const future = render('futuros');
    assert.match(future, /Negociação sinalizada/); assert.match(future, /Venda confirmada incompleta/);
    assert.match(future, /Fechada — cadastro pendente/); assert.match(future, /Cliente a confirmar/);
    assert.doesNotMatch(future, /Cliente adiou negociação/);
    assert.match(future, /Futuros[\s\S]*?2/); assert.match(future, /Pausadas[\s\S]*?1/);
    const paused = render('pausadas');
    assert.match(paused, /Cliente adiou negociação/); assert.match(paused, /Negociação adiada/);
    assert.match(paused, /Extra escopo/); assert.match(paused, /6100/);
    assert.doesNotMatch(paused, /Negociação sinalizada|Venda confirmada incompleta/);
    client.clear();
  } finally { await server.close(); }
});
