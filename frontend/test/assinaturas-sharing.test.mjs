import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createServer } from 'vite';

test('compartilhamento: visualizador, editor e proprietário recebem controles coerentes com suas permissões', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  try {
    const { DocumentDetailView } = await server.ssrLoadModule('/src/pages/assinaturas/components/DocumentDetailView.tsx');
    const { ToastContext } = await server.ssrLoadModule('/src/components/ui/ToastContext.ts');
    const { AuthContext } = await server.ssrLoadModule('/src/auth/AuthContext.ts');
    const document = { id: 'doc', title: 'Contrato', originalFileName: 'contrato.pdf', status: 'RASCUNHO', archivedAt: null,
      createdAt: '2026-11-04T12:00:00Z', pageCount: 1, pageDimensions: [], fields: [], progress: { signed: 0, total: 1 },
      signers: [{ id: 'signer', name: 'Ana Silva', email: 'ana@example.com', position: 1, status: 'PENDENTE', emailStatus: 'PENDENTE' }] };
    const render = (permissions, changes = {}) => renderToStaticMarkup(createElement(QueryClientProvider, { client },
      createElement(ToastContext.Provider, { value: { showToast() {} } },
        createElement(AuthContext.Provider, { value: { user: null } }, createElement(DocumentDetailView, {
          document: { ...document, ...changes, permissions }, tab: changes.status ? 'details' : 'setup', pageNumber: 1,
          onTabChange() {}, onPageChange() {}, onBack() {}
        })))));
    const viewer = render({ isOwner: false, access: 'VIEW', canEdit: false });
    assert.match(viewer, /Apenas visualizar/);
    assert.match(viewer, /Baixar original/);
    assert.doesNotMatch(viewer, /Compartilhar|>Excluir<|>Arquivar<|>Publicar<|Salvar campos|Remover Ana Silva|signature-signer-name-control/);
    const editor = render({ isOwner: false, access: 'EDIT', canEdit: true });
    assert.match(editor, /Pode editar/);
    assert.match(editor, /signature-signer-name-control/);
    assert.match(editor, /Campos salvos/);
    assert.doesNotMatch(editor, /Compartilhar|>Excluir<|>Arquivar<|>Publicar</);
    const owner = render({ isOwner: true, access: 'OWNER', canEdit: true });
    for (const label of ['Compartilhar', 'Excluir', 'Arquivar', 'Publicar']) assert.match(owner, new RegExp(label));
    const sharedBatch = render({ isOwner: false, access: 'EDIT', canEdit: true }, { batchId: 'batch' });
    assert.match(sharedBatch, /Você pode ajustar os campos deste documento/);
    assert.doesNotMatch(sharedBatch, /signature-signer-name-control|>Publicar</);
    const tracking = render({ isOwner: false, access: 'VIEW', canEdit: false }, { status: 'AGUARDANDO_ASSINATURAS' });
    assert.match(tracking, /Ana Silva/);
    assert.doesNotMatch(tracking, /Copiar link de|Renovar convite de|Reenviar e-mail para|Revogar convite de|Cancelar rodada/);
  } finally { client.clear(); await server.close(); }
});
