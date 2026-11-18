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

test('campo usa cor de identificação e remoção DS com foco visível', async () => {
  const css = await source('src/styles/base.css');
  const migratedCss = await source('src/pages/assinaturas/AssinaturasPreparation.ds.css');
  const canvas = await source('src/pages/assinaturas/components/PdfPageCanvas.tsx');
  assert.match(css, /\.signature-field,[\s\S]*?border:\s*0;[\s\S]*?justify-content:\s*center/);
  assert.match(css, /\.signature-field > span:first-child \{[\s\S]*?text-align:\s*center/);
  assert.match(canvas, /<IconButton[\s\S]*?className="signature-field-remove"[\s\S]*?icon=\{DS_ICONS.trash\}/);
  assert.match(migratedCss, /\.signature-field-remove \{[^}]*background: var\(--surface\)/);
  assert.match(migratedCss, /:focus-visible \{[^}]*outline: 2px solid var\(--brand\)/);
  assert.match(css, /\.signature-field-resize \{[\s\S]*?repeating-linear-gradient\([\s\S]*?border:\s*0/);
  assert.doesNotMatch(css, /\.signature-field-color-[1-5]\s*\{/);
});

test('acompanhamento agrupa informações e mantém ações compactas na horizontal', async () => {
  const [list, css] = await Promise.all([
    source('src/pages/assinaturas/components/SignerStatusList.tsx'),
    source('src/pages/assinaturas/AssinaturasTracking.ds.css')
  ]);
  assert.match(list, /className="signature-status-overview"/);
  assert.match(list, /className="signature-status-detail"/);
  assert.match(list, /<Card className="assinaturas-signer-card"/);
  assert.match(css, /\.signature-row-actions,[\s\S]*?flex-direction:\s*row;[\s\S]*?flex-wrap:\s*nowrap/);
  assert.match(css, /\.signature-status-list \{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
});

test('cadastro separa formulário e adicionados usando a mesma cor do campo', async () => {
  const [list, canvas, css] = await Promise.all([
    source('src/pages/assinaturas/components/SignerList.tsx'),
    source('src/pages/assinaturas/components/PdfPageCanvas.tsx'),
    source('src/styles/base.css')
  ]);
  assert.ok(
    list.indexOf('assinaturas-setup__signer-form') < list.indexOf('assinaturas-setup__added-signers'),
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
    source('src/pages/assinaturas/AssinaturasPreparation.ds.css')
  ]);
  assert.match(detail, /title="Cancela o documento e revoga todos os convites pendentes[\s\S]*?Cancelar rodada/);
  assert.match(css, /:is\(\.signature-tabs, \.signature-lifecycle-actions, \.signature-detail-actions\) \{[^}]*flex-wrap:\s*nowrap/);
  assert.match(css, /:is\(\.signature-tabs, \.signature-lifecycle-actions, \.signature-detail-actions\) \{[^}]*overflow:\s*visible/);
  assert.match(detail, /appearance="design-system"/);
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
  assert.match(canvas, /className="signature-signer-picker"/);
  assert.match(css, /\.signature-signer-picker \{[\s\S]*?position:\s*absolute[\s\S]*?z-index:/);
});

test('diálogo de publicação separa conteúdo, campos e ações', async () => {
  const [dialog, css] = await Promise.all([
    source('src/pages/assinaturas/components/PublishDialog.tsx'),
    source('src/pages/assinaturas/AssinaturasPreparation.ds.css')
  ]);
  assert.match(dialog, /className="signature-publish-form"/);
  assert.match(css, /\.signature-publish-form \{[^}]*gap:\s*var\(--space-4\)/);
  assert.match(dialog, /footer=\{/);
  assert.match(dialog, /form="signature-publish-form"/);
  assert.match(dialog, /fullscreenOnMobile=\{false\}/);
});

test('upload separa ações do anexo e documentos usam listagem vertical', async () => {
  const [modal, page, css] = await Promise.all([
    source('src/pages/assinaturas/components/NewDocumentModal.tsx'),
    source('src/pages/assinaturas/components/DocumentLibrary.tsx'),
    source('src/styles/base.css')
  ]);
  assert.match(modal, /className="signature-new-document-form"/);
  assert.match(modal, /footer=\{/);
  assert.match(modal, /form="signature-new-document-form"/);
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
  assert.match(upload, /<Field id="signature-title" label="Título"/);
  assert.match(upload, /errorText=\{form\.formState\.errors\.title\?\.message\}/);
  assert.match(upload, /<Input size="sm"/);
  for (const component of [signers, publish]) {
    assert.match(component, /<Field id=/);
    assert.match(component, /errorText=\{form.formState.errors/);
    assert.match(component, /<Input size="sm"/);
    assert.doesNotMatch(component, /placeholder=/);
  }
  assert.match(dropzone, /field-group \$\{error \? 'field-invalid'/);
  assert.match(dropzone, /aria-invalid=\{Boolean\(error\)\}/);
  assert.match(dropzone, /id=\{`\$\{id\}-error`\}/);
  assert.match(publish, /<Field id="signature-expiry" label="Validade dos links"/);
  assert.match(publish, /<Select size="sm"/);
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
    source('src/pages/assinaturas/components/PublicSignatureView.tsx')
  ]);
  assert.match(tutorial, /localStorage\.setItem/);
  assert.equal((tutorial.match(/title: '\d\./g) || []).length, 6);
  assert.match(datetime, /timeZone:\s*'America\/Sao_Paulo'/);
  for (const surface of [card, detail, signerStatus, audit, publicPage]) {
    assert.match(surface, /formatSignatureDateTime/);
  }
  assert.match(page, /<AssinaturasAppShell/);
  assert.match(page, /className="assinaturas-page-v2"/);
  assert.match(css, /\.signature-document-list \{[\s\S]*?flex-direction:\s*column/);
  assert.match(css, /\.signature-list-section \*,[\s\S]*?min-width:\s*0/);
  assert.match(css, /\.signature-tabs \{[\s\S]*?flex-wrap:\s*wrap/);
  assert.match(css, /\.signature-card-file,[\s\S]*?text-overflow:\s*ellipsis/);
  assert.match(css, /@media \(max-width: 760px\)/);
});
