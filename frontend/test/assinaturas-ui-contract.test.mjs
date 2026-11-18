import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { createServer } from 'vite';

const frontendRoot = new URL('..', import.meta.url);

async function source(relativePath) {
  return fs.readFile(new URL(relativePath, frontendRoot), 'utf8');
}

async function loadModule(modulePath) {
  const server = await createServer({
    configFile: false,
    root: frontendRoot.pathname,
    server: { middlewareMode: true },
    appType: 'custom'
  });
  try {
    return await server.ssrLoadModule(modulePath);
  } finally {
    await server.close();
  }
}

test('navegação preserva somente query params compatíveis com lista e detalhe', async () => {
  const { normalizeSignatureSearchParams, signatureDocumentSearchParams } = await loadModule('/src/pages/assinaturas/utils/navigation.ts');
  assert.equal(
    normalizeSignatureSearchParams(new URLSearchParams('tab=archived&status=CONCLUIDO&q=contrato')).toString(),
    'tab=archived&status=CONCLUIDO&q=contrato'
  );
  assert.equal(
    normalizeSignatureSearchParams(new URLSearchParams('doc=doc-1&tab=setup&page=3&q=oculto&status=RASCUNHO')).toString(),
    'doc=doc-1&tab=setup&page=3'
  );
  assert.equal(
    normalizeSignatureSearchParams(new URLSearchParams('doc=doc-1&tab=audit&page=3')).toString(),
    'doc=doc-1&tab=audit'
  );
  assert.equal(
    normalizeSignatureSearchParams(new URLSearchParams('doc=doc-1&tab=archived&page=0')).toString(),
    'doc=doc-1&tab=details'
  );
  assert.equal(
    signatureDocumentSearchParams(new URLSearchParams('q=abc&status=RASCUNHO&page=4'), 'doc-2').toString(),
    'doc=doc-2&tab=details'
  );
});

test('formulários de assinatura usam rótulo e contrato visual de erro compartilhado', async () => {
  const [upload, signers, publish, dropzone] = await Promise.all([
    source('src/pages/assinaturas/components/NewDocumentModal.tsx'),
    source('src/pages/assinaturas/components/SignerList.tsx'),
    source('src/pages/assinaturas/components/PublishDialog.tsx'),
    source('src/components/ui/PdfDropzone.tsx')
  ]);
  for (const component of [upload, signers, publish]) {
    assert.match(component, /field-group/);
    assert.match(component, /aria-invalid/);
    assert.match(component, /field-error/);
    assert.doesNotMatch(component, /placeholder=/);
  }
  assert.match(dropzone, /field-group \$\{error \? 'field-invalid'/);
  assert.match(dropzone, /aria-invalid=\{Boolean\(error\)\}/);
  assert.match(dropzone, /id=\{`\$\{id\}-error`\}/);
  assert.match(publish, /<label htmlFor="signature-expiry"/);
  assert.match(publish, /<select id="signature-expiry"/);
});

test('posicionamento usa Pointer Events, restaura no cancelamento e tem suporte touch', async () => {
  const [canvas, css] = await Promise.all([
    source('src/pages/assinaturas/components/PdfPageCanvas.tsx'),
    source('src/styles/base.css')
  ]);
  assert.match(canvas, /setPointerCapture/);
  assert.match(canvas, /onPointerMove=\{move\}/);
  assert.match(canvas, /onPointerCancel=\{cancelInteraction\}/);
  assert.match(canvas, /next\[interaction\.index\] = interaction\.original/);
  assert.match(css, /\.signature-field,[\s\S]*?touch-action:\s*none/);
});

test('módulo mantém onboarding permanente, datas São Paulo e proteções de overflow', async () => {
  const [tutorial, datetime, css, page, card, detail, signerStatus, audit, publicPage] = await Promise.all([
    source('src/pages/assinaturas/AssinaturasTutorial.tsx'),
    source('src/pages/assinaturas/utils/datetime.ts'),
    source('src/styles/base.css'),
    source('src/pages/assinaturas/AssinaturasPage.tsx'),
    source('src/pages/assinaturas/components/DocumentCard.tsx'),
    source('src/pages/assinaturas/components/DocumentDetailView.tsx'),
    source('src/pages/assinaturas/components/SignerStatusList.tsx'),
    source('src/pages/assinaturas/components/AuditTrail.tsx'),
    source('src/pages/assinaturas/AssinaturasPublicSignPage.tsx')
  ]);
  assert.match(tutorial, /localStorage\.setItem/);
  assert.equal((tutorial.match(/title: '\d\./g) || []).length, 6);
  assert.match(datetime, /timeZone:\s*'America\/Sao_Paulo'/);
  for (const surface of [card, detail, signerStatus, audit, publicPage]) {
    assert.match(surface, /formatSignatureDateTime/);
  }
  assert.match(page, /equip-page assinaturas-page/);
  assert.match(css, /minmax\(min\(100%, 280px\), 1fr\)/);
  assert.match(css, /\.signature-list-section \*,[\s\S]*?min-width:\s*0/);
  assert.match(css, /\.signature-tabs \{[\s\S]*?flex-wrap:\s*wrap/);
  assert.match(css, /\.signature-card-file \{[\s\S]*?text-overflow:\s*ellipsis/);
  assert.match(css, /@media \(max-width: 760px\)/);
});
