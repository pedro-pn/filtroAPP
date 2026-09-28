import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('perfis coordenador, colaborador e cliente compartilham o shell do novo padrão', () => {
  const roleShell = source('src/pages/RdoAppShell.tsx');
  assert.match(roleShell, /<AppShell\b/);
  assert.match(roleShell, /createNavigationModel/);
  assert.match(roleShell, /hubModulesForUser/);
  assert.match(roleShell, /accountPageStateFromPath/);
  assert.match(roleShell, /contentWidth="fluid"/);

  for (const path of [
    'src/pages/coordinator/CoordinatorPage.tsx',
    'src/pages/client/ClientPage.tsx',
    'src/pages/collaborator/HomePage.tsx',
    'src/pages/collaborator/MyReportsPage.tsx',
    'src/pages/collaborator/MyArchivedReportsPage.tsx',
    'src/pages/collaborator/OngoingServicesPage.tsx'
  ]) {
    const page = source(path);
    assert.match(page, /<RdoAppShell\b/, path);
    assert.match(page, /className="fv-ds rdo-role-page/, path);
    assert.match(page, /<PageHeader\b/, path);
    assert.doesNotMatch(page, /layout\/Shell|layout\/TopBar|<Shell\b|<TopBar\b/, path);
  }
});

test('listagens do coordenador e colaborador reutilizam a experiência responsiva do gestor', () => {
  for (const path of [
    'src/pages/coordinator/CoordinatorPage.tsx',
    'src/pages/collaborator/MyReportsPage.tsx',
    'src/pages/collaborator/MyArchivedReportsPage.tsx'
  ]) {
    const page = source(path);
    assert.match(page, /<GroupedReportList\b[\s\S]*?appearance="design-system"/, path);
    assert.match(page, /<ManagerReportListing\b/, path);
    assert.match(page, /className="rdo-manager-listing rdo-role-report-listing"/, path);
  }

  const listing = source('src/components/reports/manager/ManagerReportListing.tsx');
  assert.match(listing, /selectable\?: boolean/);
  assert.match(listing, /selection=\{selectable \?/);

  const batch = source('src/components/reports/ReportPdfBatchActions.tsx');
  assert.match(batch, /appearance\?: 'legacy' \| 'design-system'/);
  assert.match(batch, /rdo-role-listing__batch-toolbar/);
  assert.match(batch, /<Button\b/);
});

test('portal do cliente preserva assinatura e ganha hierarquia visual compartilhada', () => {
  const client = source('src/pages/client/ClientPage.tsx');
  const coordinator = source('src/pages/coordinator/CoordinatorPage.tsx');
  const signatureDialog = source('src/components/reports/SignatureDialog.tsx');
  const signatureCss = source('src/components/reports/SignatureDialog.ds.css');
  const registry = JSON.parse(source('../shared/modules/registry.json'));
  const rdoModule = registry.modules.find((module) => module.id === 'rdo');
  assert.equal((client.match(/<MetricCard\b/g) || []).length, 3);
  assert.match(client, /<SearchInput\b/);
  assert.match(client, /rdo-client-project-summary/);
  assert.match(client, /rdo-client-report-section/);
  assert.match(client, /<SignatureDialog[\s\S]*?appearance="design-system"/);
  assert.match(client, /<StatusPill\b/);
  assert.doesNotMatch(client, /status-pill\s+\$\{status\.className\}/);
  assert.match(coordinator, /<StatusPill\b/);
  assert.doesNotMatch(coordinator, /className="badge badge-|status-pill\s+\$\{status\.className\}/);
  assert.match(signatureDialog, /signature-modal--ds/);
  assert.match(signatureDialog, /title=\{isDesignSystem \? title : undefined\}/);
  assert.match(signatureDialog, /footer=\{isDesignSystem \?/);
  assert.match(signatureCss, /\.signature-modal--ds/);
  assert.match(signatureCss, /background: var\(--surface\)/);
  assert.match(signatureCss, /background: var\(--danger-bg\)/);
  assert.doesNotMatch(signatureCss, /#[\da-f]{3,8}\b|\brgba?\(/i);
  assert.match(client, /reportMutations\.clientReview\.mutateAsync/);
  assert.match(client, /handleBatchSignature/);
  assert.match(client, /className="report-batch-select-all"/);
  assert.ok(rdoModule.hub.roles.includes('rdo:client'));
});

test('CSS compartilhado usa tokens, breakpoints oficiais e evita overflow mobile', () => {
  const css = source('src/pages/RdoRolePages.ds.css');
  assert.match(css, /\.rdo-role-page\s*\{[\s\S]*?min-width:\s*0/);
  assert.match(css, /\.rdo-role-metrics/);
  assert.match(css, /\.rdo-client-page \.stats-grid/);
  assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.rdo-role-listing__batch-toolbar\s*\{[\s\S]*?flex-wrap:\s*nowrap/);
  assert.match(css, /\.rdo-role-page \.report-card\s*\{[\s\S]*?background:\s*var\(--surface\)/);
  assert.match(css, /\.rdo-role-page \.report-card \.signature-progress\s*\{[\s\S]*?background:\s*var\(--surface-2\)/);
  assert.match(css, /\.rdo-role-page \.project-sort-button/);
  assert.match(css, /\.rdo-coordinator-page \.det-section\s*\{[\s\S]*?background:\s*var\(--surface-2\)/);
  assert.match(css, /\.rdo-client-page \.client-rejection-note\s*\{[\s\S]*?background:\s*var\(--danger-bg\)/);
  assert.match(css, /\.rdo-client-page \.signature-progress\s*\{[\s\S]*?background:\s*var\(--surface-2\)/);
  assert.match(css, /:where\(\.fv-ds, \[data-fv-ds\]\)\.rdo-client-page \.client-report-card/);
  assert.doesNotMatch(css, /:where\(\.fv-ds, \[data-fv-ds\]\)\s+\.rdo-client-page/);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*?\.rdo-collaborator-reports-page \.rdo-role-tabs\s*\{[\s\S]*?display:\s*none/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b/i);
  assert.doesNotMatch(css, /\brgba?\(/i);
  assert.doesNotMatch(css, /!important/);
});

test('cards do cliente mantêm estados legíveis, ações em linha e contraste no tema escuro', () => {
  const client = source('src/pages/client/ClientPage.tsx');
  const css = source('src/pages/RdoRolePages.ds.css');
  const variables = source('src/styles/variables.css');
  const legacyCss = source('src/styles/base.css');

  assert.match(client, /className="client-report-author"/);
  assert.match(client, /className="client-report-context"/);
  assert.match(client, /className="client-report-action-buttons"/);
  assert.match(client, /client-report-action-label--compact">Assinar/);
  assert.match(client, /\.filter\(item => item\.comment\)/);
  assert.doesNotMatch(client, /RDO pronto para conferência do cliente/);
  assert.match(css, /\.client-report-copy \.admin-card-title\s*\{[\s\S]*?text-overflow:\s*ellipsis[\s\S]*?white-space:\s*nowrap/);
  assert.match(css, /\.client-report-context\s*\{[\s\S]*?overflow-wrap:\s*anywhere[\s\S]*?white-space:\s*normal/);
  assert.match(css, /\.client-report-action-buttons\s*\{[\s\S]*?flex-wrap:\s*nowrap/);
  assert.match(css, /\.det-val\s*\{[\s\S]*?max-width:\s*none[\s\S]*?text-align:\s*start/);
  assert.match(variables, /\.dark\s*\{[\s\S]*?--brand:\s*var\(--green-500\)[\s\S]*?--on-brand:\s*var\(--white\)/);
  assert.match(legacyCss, /\.dark body\s*\{[\s\S]*?background: var\(--canvas\)[\s\S]*?color: var\(--ink\)/);
  assert.match(legacyCss, /\.dark \.status-signed\s*\{[\s\S]*?background: var\(--info-bg\)[\s\S]*?color: var\(--info\)/);
});
