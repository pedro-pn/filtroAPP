import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const source = path => readFileSync(new URL(`../src/pages/assinaturas/${path}`, import.meta.url), 'utf8');

test('preparação renderiza assinantes, formulário acessível e loading do PDF no DS', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const { SignerList } = await server.ssrLoadModule('/src/pages/assinaturas/components/SignerList.tsx');
    const signers = [{ id: 's-1', name: 'Ana Silva', email: null, position: 1 }];
    const html = renderToStaticMarkup(createElement(SignerList, { signers, saving: false, onSave: async () => {} }));
    assert.match(html, /for="signature-signer-name-control"/);
    assert.match(html, /id="signature-signer-name-control"[^>]*required=""/);
    assert.match(html, /aria-describedby="signature-signer-email-helper"/);
    assert.match(html, /fv-card/);
    assert.match(html, /signature-signer-color-0/);
    assert.match(html, /aria-label="Remover Ana Silva"/);
    assert.match(html, /Sem e-mail · link manual/);
    assert.doesNotMatch(html, /class="(?:primary-button|secondary-button)/);
    const empty = renderToStaticMarkup(createElement(SignerList, { signers: [], saving: true, onSave: async () => {} }));
    assert.match(empty, /Nenhum assinante adicionado/);
    assert.match(empty, /aria-busy="true"/);
    assert.match(empty, /disabled=""/);

    const { PdfPageCanvas } = await server.ssrLoadModule('/src/pages/assinaturas/components/PdfPageCanvas.tsx');
    const loading = renderToStaticMarkup(createElement(PdfPageCanvas, { imageUrl: '', pageNumber: 2, signers,
      fields: [{ signerId: 's-1', pageNumber: 2, x: .1, y: .2, width: .2, height: .055 }], onFieldsChange() {} }));
    assert.match(loading, /fv-skeleton/);
    assert.match(loading, /Área de posicionamento, página 2/);
    assert.doesNotMatch(loading, /class="signature-field /, 'não exibir campos sobre uma página ainda não carregada');
  } finally { await server.close(); }
});

test('preparação preserva coordenadas, fluxo de publicação e recuperação de erro', () => {
  const setup = source('components/DocumentSetupView.tsx');
  const canvas = source('components/PdfPageCanvas.tsx');
  const dialog = source('components/PublishDialog.tsx');
  const signers = source('components/SignerList.tsx');
  const css = source('AssinaturasPreparation.ds.css');
  assert.match(setup, /if \(!disposed\) setImageError\(true\)/);
  assert.match(setup, /URL.revokeObjectURL\(currentUrl\)/);
  assert.match(setup, /onImageError=\{\(\) => setImageError\(true\)\}/);
  assert.match(setup, /Tentar novamente/);
  assert.match(setup, /const fieldsSaved = await saveFields\(\)/);
  assert.match(setup, /if \(!fieldsSaved\)[\s\S]*return;[\s\S]*await mutations.publish/);
  assert.match(canvas, /if \(!imageReady \|\| interaction/);
  assert.match(canvas, /style=\{normalizedToPercent\(field\)\}/);
  assert.match(canvas, /clampNormalizedRect/);
  assert.match(canvas, /event.key === 'Escape'[\s\S]*closePicker\(\)/);
  assert.match(canvas, /const frame = requestAnimationFrame/);
  assert.match(canvas, /cancelAnimationFrame\(frame\)/);
  assert.match(signers, /catch \(error\)[\s\S]*setSaveError/);
  assert.match(dialog, /const busy = pending \|\| form.formState.isSubmitting/);
  assert.match(dialog, /closeOnEscape=\{!busy\}/);
  assert.match(dialog, /new Date\(values.expiresAt \|\| ''\).toISOString\(\)/);
  assert.match(css, /\.signature-pdf-canvas.is-ready \{[^}]*min-height: 0/);
  assert.match(css, /\.signature-editor-toolbar\) \{[^}]*flex-direction: row;[^}]*flex-wrap: nowrap/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|rgba?\(|!important/i);
  assert.doesNotMatch(css, /\.efetivo|\.signature-public/);
  const tokens = readFileSync(new URL('../src/styles/variables.css', import.meta.url), 'utf8');
  for (const [, token] of css.matchAll(/var\((--[\w-]+)/g)) {
    assert.ok(token === '--signature-signer-color' || token.startsWith('--signature-picker-offset-') || tokens.includes(`${token}:`), `Token ausente: ${token}`);
  }
});
