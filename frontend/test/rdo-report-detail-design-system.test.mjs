import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { withRdoCompanions } from './rdo-source.mjs';

const source = (path) =>
  withRdoCompanions(path, candidate => readFileSync(new URL(`../${candidate}`, import.meta.url), 'utf8'));

test('detalhe somente leitura e relatório assinado usam o shell do novo padrão', () => {
  const page = source('src/pages/ReportDetailPage.tsx');

  assert.match(page, /className="fv-ds rdo-report-detail-page"/);
  assert.match(page, /<PageHeader\b[\s\S]*?Voltar aos relatórios/);
  assert.match(page, /<ReportSummaryView report=\{report\}/);
  assert.match(page, /<Card className="rdo-report-detail-card"/);
  assert.match(page, /<StatusPill[\s\S]*?toneMap=\{reportStatusTones\}/);
  assert.doesNotMatch(page, /import \{ Shell \}|import \{ TopBar \}|<Shell\b|<TopBar\b/);
});

test('ações e diálogos do detalhe compartilham os componentes do design system', () => {
  const page = source('src/pages/ReportDetailPage.tsx');

  assert.match(page, /className="rdo-report-detail-actions"/);
  assert.match(page, /<Button variant="primary" size="sm" type="button"[\s\S]*?>\s*PDF/);
  assert.match(page, /<Button variant="danger" size="sm"[\s\S]*?\{TEXT\.rejectClient\}/);
  assert.match(page, /<ReasonDialog[\s\S]*?appearance="design-system"/);
  assert.match(page, /<SignatureDialog[\s\S]*?appearance="design-system"/);
  assert.match(page, /open=\{sequenceEditOpen\}[\s\S]*?appearance="design-system"/);
});

test('status assinado é informativo e aprovado permanece sucesso', () => {
  const status = source('src/components/ui/ds/status.ts');
  const listing = source('src/components/reports/manager/ManagerReportListing.tsx');
  const client = source('src/pages/client/ClientPage.tsx');

  assert.match(status, /assinado: 'info'/);
  assert.match(listing, /signed: 'info'/);
  assert.match(listing, /approved: 'success'/);
  assert.match(client, /label="Aprovados"[\s\S]*?tone="success"/);
  assert.match(client, /label="Assinados"[\s\S]*?tone="info"/);
});

test('detalhe usa tokens sem overflow horizontal local', () => {
  const css = source('src/pages/ReportDetailPage.css');
  const detailCss = css.slice(css.indexOf('/* Read-only report details'));

  assert.match(detailCss, /\.fv-ds\.rdo-report-detail-page\s*\{[\s\S]*?width: min\(100%, 960px\)/);
  assert.match(detailCss, /\.rdo-report-detail-card > \.fv-card__body\s*\{[\s\S]*?gap: var\(--space-4\)/);
  assert.match(detailCss, /\.rdo-report-detail-actions\s*\{[\s\S]*?flex-wrap: wrap/);
  assert.match(detailCss, /@media \(max-width: 767\.98px\)[\s\S]*?grid-template-columns: 1fr/);
  assert.doesNotMatch(detailCss, /#[\da-f]{3,8}\b|\brgba?\(/i);
  assert.doesNotMatch(detailCss, /overflow-x:\s*(?:auto|scroll)/);
  assert.doesNotMatch(detailCss, /!important/);
});
