import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('confirmação informa o texto exigido e preserva instruções personalizadas', async () => {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false, ws: false },
    ssr: { noExternal: ['react-dom'] },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom',
    plugins: [{
      name: 'inline-confirmation-portal-for-ssr',
      enforce: 'pre',
      resolveId(id) {
        if (id === 'react-dom') return '\0confirmation-portal';
      },
      load(id) {
        // Renderizar o conteúdo do portal sem depender de um navegador ou chamar a API.
        if (id === '\0confirmation-portal') return 'export const createPortal = children => children;';
      }
    }]
  });
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  try {
    const { ConfirmDialog } = await server.ssrLoadModule('/src/components/ui/ConfirmDialog.tsx');
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { body: {} } });
    const render = props => renderToStaticMarkup(createElement(ConfirmDialog, {
      open: true, title: 'Confirmar ação', confirmLabel: 'Confirmar', onConfirm() {}, onCancel() {}, ...props
    }));

    for (const confirmationText of ['REVOGAR', 'ROTACIONAR']) {
      const markup = render({ confirmationText });
      assert.match(markup, new RegExp(`<label[^>]*>Digite <strong>${confirmationText}</strong> para confirmar</label>`));
      assert.match(markup, /<button[^>]*disabled=""[^>]*>Confirmar<\/button>/);
    }

    const custom = render({ confirmationText: 'usuario-teste', confirmationLabel: 'Digite o nome de usuário para confirmar' });
    assert.match(custom, /<label[^>]*>Digite o nome de usuário para confirmar<\/label>/);
    assert.doesNotMatch(custom, /Digite <strong>/);

    const simple = render({});
    assert.doesNotMatch(simple, /confirm-dialog-text|Digite/);
    assert.doesNotMatch(simple, /<button[^>]*disabled/);
    assert.equal(render({ open: false, confirmationText: 'REVOGAR' }), '');
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
    await server.close();
  }
});
