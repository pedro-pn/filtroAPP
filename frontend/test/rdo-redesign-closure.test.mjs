import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('diálogo de confirmação delega portal e acessibilidade ao Modal compartilhado', () => {
  const dialog = source('src/components/ui/ConfirmDialog.tsx');

  assert.match(dialog, /appearance = 'legacy'/);
  assert.match(dialog, /appearance=\{appearance\}/);
  assert.match(dialog, /ariaDescribedBy=\{description \? 'confirm-dialog-description' : undefined\}/);
  assert.match(dialog, /return dialog/);
  assert.doesNotMatch(dialog, /createPortal/);
});

test('bordas públicas e relatórios da missão permanecem no Design System', () => {
  const publicSignature = source('src/pages/PublicSignaturePage.tsx');
  const validation = source('src/pages/SignatureValidationPage.tsx');
  const consent = source('src/pages/client/ClientPrivacyConsentPage.tsx');
  const projectReports = source('src/components/projects/ProjectReportsDialog.tsx');

  for (const page of [publicSignature, validation, consent]) {
    assert.match(page, /rdo-public-shell/);
    assert.match(page, /<BrandLogo\b/);
  }
  assert.match(validation, /SIGNED: 'Assinado'/);
  assert.match(projectReports, /appearance="design-system"/);
  assert.match(projectReports, /fullscreenOnMobile=\{false\}/);
  assert.match(projectReports, /<GroupedReportList[\s\S]*?appearance="design-system"/);
});

test('campos condicionais e remoção de anexos conservam nomes e confirmação DS', () => {
  const conditions = source('src/components/reports/NewReportSpecialConditions.tsx');
  const upload = source('src/components/ui/UploadField.tsx');

  for (const label of ['Início', 'Término', 'Tempo total', 'Motivo', 'Intervalo noturno']) {
    assert.match(conditions, new RegExp(`label="${label}"`));
  }
  assert.match(upload, /title="Remover imagem\?"/);
  assert.match(upload, /appearance=\{appearance\}/);
  assert.doesNotMatch(upload, /window\.confirm/);
});
