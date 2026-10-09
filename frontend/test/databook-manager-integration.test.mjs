import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { PassThrough } from 'node:stream';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { createServer } from 'vite';

function renderReady(element) {
  return new Promise((resolveMarkup, reject) => {
    const output = new PassThrough();
    let html = '';
    output.on('data', chunk => { html += chunk; });
    output.on('end', () => resolveMarkup(html));
    output.on('error', reject);
    const stream = renderToPipeableStream(element, {
      onAllReady() { stream.pipe(output); }, onError: reject
    });
  });
}

test('gestor abre o databook do projeto ativo ou arquivado indicado na URL', { timeout: 20000 }, async () => {
  const root = new URL('..', import.meta.url).pathname;
  const modalPath = resolve(root, 'src/components/ui/Modal');
  // Portals are client-only. Render their open content inline for this route integration test.
  const server = await createServer({ configFile: false, root, appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true }, plugins: [{ name: 'test-inline-modal', enforce: 'pre',
      resolveId(id, importer) {
        if (importer && id.startsWith('.') && resolve(dirname(importer), id) === modalPath) return '\0test-inline-modal';
      },
      load(id) {
        if (id === '\0test-inline-modal') return `import { createElement } from 'react';
          export function Modal({ open, title, children, footer }) {
            return open ? createElement('section', { role: 'dialog' }, title, children, footer) : null;
          }`;
      }
    }] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  try {
    const { GestorPage } = await server.ssrLoadModule('/src/pages/gestor/GestorPage.tsx');
    const { AuthContext } = await server.ssrLoadModule('/src/auth/AuthContext.ts');
    const { ToastContext } = await server.ssrLoadModule('/src/components/ui/ToastContext.ts');
    const { ThemeProvider } = await server.ssrLoadModule('/src/theme/ThemeProvider.tsx');
    const { queryKeys } = await server.ssrLoadModule('/src/hooks/queryKeys.ts');
    const user = { id: 'manager', name: 'Gestor', accountType: 'INTERNAL', role: 'MANAGER', moduleRoles: ['rdo:manager'] };
    const active = { id: 'active', code: 'UI-ATIVO', name: 'Projeto ativo', clientName: 'Cliente', isActive: true };
    const archived = { ...active, id: 'archived', code: 'UI-ARQUIVADO', name: 'Projeto arquivado', isActive: false };
    client.setQueryData(queryKeys.gestorBootstrap(user.id), { activeProjects: [active], archivedProjects: [archived], collaborators: [], surveys: [], projectSegments: [], surveyQuestions: [] });
    for (const project of [active, archived]) {
      client.setQueryData(['databooks', project.id], { project, permissions: { canRead: true, canGenerate: true },
        defaults: { startDate: '2026-09-16', endDate: '2026-10-07' }, items: [] });
    }
    const render = url => renderReady(createElement(ThemeProvider, {}, createElement(QueryClientProvider, { client },
      createElement(AuthContext.Provider, { value: { user, isAuthenticated: true } },
        createElement(ToastContext.Provider, { value: { showToast() {} } },
          createElement(MemoryRouter, { initialEntries: [url] }, createElement(GestorPage)))))));
    for (const [project, tab] of [[active, 'projetos'], [archived, 'arquivados']]) {
      const closed = await render(`/rdo/gestor?tab=${tab}`);
      assert.doesNotMatch(closed, /Ainda não há databook emitido/);
      const opened = await render(`/rdo/gestor?tab=${tab}&databook=${project.id}`);
      assert.ok(opened.includes(`Databook · ${project.code}`), `modal do projeto ${project.id}`);
      assert.match(opened, /Ainda não há databook emitido/);
      assert.match(opened, /Novo databook \/ etapa/);
    }
  } finally { client.clear(); await server.close(); }
});
