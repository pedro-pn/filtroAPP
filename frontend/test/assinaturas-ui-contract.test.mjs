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
  assert.equal(
    signatureDocumentSearchParams(new URLSearchParams('q=abc&status=RASCUNHO&page=4'), 'doc-2', 'setup').toString(),
    'doc=doc-2&tab=setup&page=1'
  );
});

test('rascunho abre na configuração e publicação persiste campos pendentes', async () => {
  const [page, detail, setup] = await Promise.all([
    source('src/pages/assinaturas/AssinaturasPage.tsx'),
    source('src/pages/assinaturas/components/DocumentDetailView.tsx'),
    source('src/pages/assinaturas/components/DocumentSetupView.tsx')
  ]);
  assert.match(page, /openDocument\(document\.id, 'setup'\)/);
  assert.match(detail, /document\.status !== 'RASCUNHO'[\s\S]*?Acompanhamento/);
  assert.ok(
    setup.indexOf('await mutations.replaceFields.mutateAsync') < setup.indexOf('await mutations.publish.mutateAsync'),
    'os campos locais devem ser persistidos antes da publicação'
  );
});

test('campo de assinatura pode ser removido, nasce compacto e usa apresentação retangular', async () => {
  const [canvas, css] = await Promise.all([
    source('src/pages/assinaturas/components/PdfPageCanvas.tsx'),
    source('src/styles/base.css')
  ]);
  assert.match(canvas, /onPointerDown=\{event => event\.stopPropagation\(\)\}/);
  assert.match(canvas, /DEFAULT_FIELD_RECT = \{ width: 0\.2, height: 0\.055 \}/);
  assert.match(css, /\.signature-field,[\s\S]*?border-radius:\s*var\(--rs\)/);
});

test('campo usa uma cor suave, nome centralizado e controles transparentes', async () => {
  const css = await source('src/styles/base.css');
  assert.match(css, /\.signature-field,[\s\S]*?border:\s*0;[\s\S]*?justify-content:\s*center/);
  assert.match(css, /\.signature-field > span:first-child \{[\s\S]*?text-align:\s*center/);
  assert.match(css, /\.signature-field-remove \{[\s\S]*?background:\s*transparent;[\s\S]*?right:\s*-20px;[\s\S]*?top:\s*-20px/);
  assert.match(css, /\.signature-field-resize \{[\s\S]*?repeating-linear-gradient\([\s\S]*?border:\s*0/);
  assert.doesNotMatch(css, /\.signature-field-color-[1-5]\s*\{/);
});

test('acompanhamento agrupa informações e mantém ações compactas na horizontal', async () => {
  const [list, css] = await Promise.all([
    source('src/pages/assinaturas/components/SignerStatusList.tsx'),
    source('src/styles/base.css')
  ]);
  assert.match(list, /className="signature-status-overview"/);
  assert.match(list, /className="signature-status-detail"/);
  assert.match(css, /\.signature-status-row \{[\s\S]*?border-radius:\s*var\(--rs\)[\s\S]*?grid-template-columns:\s*minmax\(180px, \.8fr\) minmax\(250px, 1fr\) minmax\(240px, auto\)/);
  assert.match(css, /\.signature-status-row > \.signature-row-actions \{[\s\S]*?flex-direction:\s*row/);
});

test('cadastro separa formulário e adicionados usando a mesma cor do campo', async () => {
  const [list, canvas, css] = await Promise.all([
    source('src/pages/assinaturas/components/SignerList.tsx'),
    source('src/pages/assinaturas/components/PdfPageCanvas.tsx'),
    source('src/styles/base.css')
  ]);
  assert.ok(
    list.indexOf('signature-signer-form-card') < list.indexOf('signature-added-signers'),
    'o formulário deve aparecer antes da relação de assinantes adicionados'
  );
  assert.match(list, /signature-signer-item signature-signer-color-/);
  assert.match(canvas, /signature-field signature-signer-color-/);
  assert.match(css, /\.signature-signer-color-0 \{ --signature-signer-color:/);
  assert.match(css, /\.signature-field,[\s\S]*?var\(--signature-signer-color, var\(--g\)\)/);
});

test('ações de ciclo de vida permanecem em uma linha compacta', async () => {
  const [detail, css] = await Promise.all([
    source('src/pages/assinaturas/components/DocumentDetailView.tsx'),
    source('src/styles/base.css')
  ]);
  assert.match(detail, /title="Cancela o documento e revoga todos os convites pendentes[\s\S]*?Cancelar rodada/);
  assert.match(css, /\.signature-lifecycle-actions \{[\s\S]*?flex-wrap:\s*nowrap/);
  assert.match(css, /\.signature-lifecycle-actions > button \{[\s\S]*?white-space:\s*nowrap/);
});

test('clique no PDF escolhe o assinante no local e inclui diretamente quando há apenas um', async () => {
  const [setup, list, canvas, css] = await Promise.all([
    source('src/pages/assinaturas/components/DocumentSetupView.tsx'),
    source('src/pages/assinaturas/components/SignerList.tsx'),
    source('src/pages/assinaturas/components/PdfPageCanvas.tsx'),
    source('src/styles/base.css')
  ]);
  assert.doesNotMatch(setup, /selectedSignerId/);
  assert.doesNotMatch(list, /onSelect/);
  assert.match(canvas, /signers\.length === 1[\s\S]*?addField\(signers\[0\]\.id, point\)/);
  assert.match(canvas, /setPendingPlacement\(point\)/);
  assert.match(canvas, /className=\{`signature-signer-picker/);
  assert.match(css, /\.signature-signer-picker \{[\s\S]*?position:\s*absolute[\s\S]*?z-index:/);
});

test('diálogo de publicação separa conteúdo, campos e ações', async () => {
  const [dialog, css] = await Promise.all([
    source('src/pages/assinaturas/components/PublishDialog.tsx'),
    source('src/styles/base.css')
  ]);
  assert.match(dialog, /className="signature-publish-form"/);
  assert.match(css, /\.signature-publish-form \{[\s\S]*?display:\s*flex[\s\S]*?gap:\s*14px/);
  assert.match(css, /\.signature-publish-form \.modal-actions \{[\s\S]*?border-top:[\s\S]*?padding-top:/);
});

test('upload separa ações do anexo e documentos usam listagem vertical', async () => {
  const [modal, page, css] = await Promise.all([
    source('src/pages/assinaturas/components/NewDocumentModal.tsx'),
    source('src/pages/assinaturas/AssinaturasPage.tsx'),
    source('src/styles/base.css')
  ]);
  assert.match(modal, /className="signature-new-document-form"/);
  assert.match(css, /\.signature-new-document-form \.modal-actions \{[\s\S]*?margin-top:/);
  assert.match(page, /className="signature-document-list"/);
  assert.match(css, /\.signature-document-list \{[\s\S]*?flex-direction:\s*column/);
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
  assert.match(css, /\.signature-document-list \{[\s\S]*?flex-direction:\s*column/);
  assert.match(css, /\.signature-list-section \*,[\s\S]*?min-width:\s*0/);
  assert.match(css, /\.signature-tabs \{[\s\S]*?flex-wrap:\s*wrap/);
  assert.match(css, /\.signature-card-file,[\s\S]*?text-overflow:\s*ellipsis/);
  assert.match(css, /@media \(max-width: 760px\)/);
});
