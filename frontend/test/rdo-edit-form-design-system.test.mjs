import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('editor de RDO reutiliza os elementos visuais do formulário principal', () => {
  const page = source('src/pages/ReportDetailPage.tsx');

  assert.match(page, /<AppShell\b/);
  assert.match(page, /<PageHeader\b/);
  assert.match(page, /className="fv-ds rdo-form-page rdo-edit-page"/);
  assert.match(page, /className="rdo-form-stage rdo-edit-form"/);
  assert.match(page, /<Card className="rdo-form-card report-services-step"/);
  assert.match(page, /className="rdo-service-card"/);
  assert.match(page, /aria-label="Equipamento e sistema"/);
  assert.match(page, /aria-label="Equipe do serviço"/);
  assert.match(page, /aria-label="Horários do serviço"/);
  assert.match(page, /<ServiceFields[\s\S]*?appearance="design-system"/);
  assert.match(page, /<UploadField[\s\S]*?appearance="design-system"/);
  assert.match(page, /<ReasonDialog[\s\S]*?appearance="design-system"/);
  assert.doesNotMatch(page, /[🧪🔴🔵💧⚙️🛡️]/u);
});

test('editor possui ações responsivas sem rolagem horizontal local', () => {
  const page = source('src/pages/ReportDetailPage.tsx');
  const css = source('src/pages/ReportDetailPage.css');
  const mobileStart = css.indexOf('@media (max-width: 767.98px)');
  const mobileBlock = css.slice(mobileStart);

  assert.match(page, /className="rdo-edit-actions"/);
  assert.match(css, /flex-wrap: wrap/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(
    mobileBlock,
    /\.rdo-edit-actions \.fv-button \{[\s\S]*?--fv-button-height: calc\(var\(--space-10\) - var\(--space-1\)\)/
  );
  assert.match(mobileBlock, /--fv-button-font-size: var\(--text-sm\)/);
  assert.match(mobileBlock, /\.rdo-edit-actions \{[\s\S]*?padding: var\(--space-2\)/);
  assert.doesNotMatch(css, /overflow-x:\s*(?:auto|scroll)/);
});

test('editor compartilha a largura estreita do formulário principal no desktop', () => {
  const sharedCss = source('src/pages/collaborator/NewReportPage.css');
  const editorCss = source('src/pages/ReportDetailPage.css');

  assert.match(sharedCss, /--rdo-form-max: 540px/);
  assert.doesNotMatch(
    editorCss,
    /\.rdo-edit-general-grid[\s\S]*?grid-template-columns: repeat\([23],/
  );
});
