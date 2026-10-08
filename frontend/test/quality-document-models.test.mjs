import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('quality models remain available only in the quality category, including read-only and saving states', async () => {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom'
  });
  try {
    const { ProjectWorkflowDocumentationTracking } = await server.ssrLoadModule('/src/pages/efetivo/components/ProjectWorkflowIntakePanels.tsx');
    for (const required of [null, false, true]) {
      for (const canEdit of [false, true]) {
        const category = type => ({ type, label: type === 'QUALITY' ? 'Documentos de qualidade' : 'Exames', description: '', required,
          requirements: [], nameLabel: 'Nome', singularLabel: 'documento' });
        const workflow = { version: 1, permissions: { canEdit }, documentationReadiness: { status: 'PENDING', completed: 0, total: 2 },
          documentationCategories: [category('EXAM'), category('QUALITY')] };
        const html = renderToStaticMarkup(createElement(ProjectWorkflowDocumentationTracking, { workflow, saving: true, onPatch() {} }));
        assert.equal((html.match(/>Modelos<\/button>/g) || []).length, 1);
        assert.match(html, /<button[^>]*aria-haspopup="dialog"[^>]*>Modelos<\/button>/);
        const modelsButton = html.match(/<button[^>]*aria-haspopup="dialog"[^>]*>/)?.[0];
        assert.doesNotMatch(modelsButton, /disabled/);
        workflow.documentationCategories = [category('EXAM')];
        const exams = renderToStaticMarkup(createElement(ProjectWorkflowDocumentationTracking, { workflow, saving: false, onPatch() {} }));
        assert.doesNotMatch(exams, />Modelos<\/button>/);
      }
    }
  } finally {
    await server.close();
  }
});
