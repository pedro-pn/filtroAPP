import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('ações de seleção de relatórios permanecem em uma linha no mobile', () => {
  const css = source('src/styles/base.css');
  const batchActions = source('src/components/reports/ReportPdfBatchActions.tsx');
  const client = source('src/pages/client/ClientPage.tsx');
  const manager = source('src/pages/gestor/GestorPage.tsx');
  const managerCss = source('src/pages/gestor/GestorPage.ds.css');

  assert.match(
    css,
    /\.report-batch-toolbar > \.admin-form-actions\s*\{[\s\S]*?flex-wrap:\s*nowrap/
  );
  assert.match(
    css,
    /@media \(max-width: 768px\)[\s\S]*?\.report-batch-toolbar > \.admin-form-actions\s*\{[\s\S]*?grid-auto-columns:\s*minmax\(0, 1fr\)[\s\S]*?grid-auto-flow:\s*column/
  );
  assert.match(
    css,
    /\.report-batch-toolbar > \.admin-form-actions > button\s*\{[\s\S]*?min-width:\s*0[\s\S]*?white-space:\s*nowrap/
  );

  for (const [name, component] of [
    ['compartilhadas', batchActions],
    ['cliente', client],
    ['gestor', manager]
  ]) {
    assert.match(
      component,
      /report-batch-action-label--full/,
      `${name}: rótulo completo ausente`
    );
    assert.match(
      component,
      /report-batch-action-label--compact/,
      `${name}: rótulo compacto ausente`
    );
  }

  assert.match(manager, /className="report-batch-select-all"/);
  assert.match(
    manager,
    /forceDesignSystem[\s\S]*?rdo-manager-listing__batch-toolbar--archived/
  );
  assert.match(
    managerCss,
    /\.rdo-manager-listing__batch-toolbar[\s\S]*?> \.admin-form-actions[\s\S]*?display:\s*flex[\s\S]*?flex-wrap:\s*nowrap/
  );
  assert.match(
    managerCss,
    /\.report-batch-select-all[\s\S]*?\.report-batch-action-label--full\s*\{[\s\S]*?display:\s*inline/
  );
  assert.match(
    managerCss,
    /\.rdo-manager-listing__batch-toolbar--archived\s*\{[\s\S]*?display:\s*grid[\s\S]*?grid-template-columns:\s*max-content minmax\(0, 1fr\)/
  );
});
