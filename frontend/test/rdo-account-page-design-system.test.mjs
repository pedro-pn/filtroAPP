import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('página de conta usa o shell e os componentes do novo padrão', () => {
  const page = source('src/pages/account/AccountPage.tsx');

  assert.match(page, /<AppShell\b/);
  assert.match(page, /createNavigationModel/);
  assert.match(page, /hubModulesForUser/);
  assert.match(page, /<main className="fv-ds account-page">/);
  assert.match(page, /<PageHeader\b/);
  assert.match(page, /<Card\b[\s\S]*?title="E-mail"/);
  assert.match(page, /<Card\b[\s\S]*?title="Alterar senha"/);
  assert.match(page, /<Card\b[\s\S]*?title="Notificações por e-mail"/);
  assert.match(page, /<Card\b[\s\S]*?title="Privacidade"/);
  assert.equal((page.match(/<Switch\b/g) || []).length, 5);
  assert.match(page, /autoComplete="email"/);
  assert.match(page, /autoComplete="current-password"/);
  assert.match(page, /autoComplete="new-password"/);
  assert.doesNotMatch(page, /layout\/Shell|layout\/TopBar|<Shell\b|<TopBar\b|page-card/);
});

test('migração da conta preserva os fluxos de dados e segurança existentes', () => {
  const page = source('src/pages/account/AccountPage.tsx');

  for (const contract of [
    'updateAccountEmail(email.trim() || null)',
    'changePassword(currentPassword, newPassword)',
    'updateAccountNotificationPreferences(notificationPreferences)',
    'exportMyData()',
    'requestMyDataDeletion()',
    'replaceUser(response.user)',
    "navigate('/', { replace: true })"
  ]) {
    assert.ok(page.includes(contract), `contrato ausente: ${contract}`);
  }
});

test('CSS da conta é responsivo e depende apenas de tokens do tema', () => {
  const css = source('src/pages/account/AccountPage.css');

  assert.match(css, /\.fv-ds\.account-page\s*\{[\s\S]*?width:\s*min\(100%, 760px\)/);
  assert.match(css, /\.account-notification-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /background:\s*var\(--surface-2\)/);
  assert.match(css, /color:\s*var\(--muted\)/);
  assert.match(css, /@media \(max-width: 767\.98px\)/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|\brgba?\(|!important/i);
});

test('tema do portal cliente alcança o elemento raiz que combina as duas classes', () => {
  const css = source('src/pages/RdoRolePages.ds.css');

  assert.match(css, /:where\(\.fv-ds, \[data-fv-ds\]\)\.rdo-client-page \.client-report-card/);
  assert.match(css, /:where\(\.fv-ds, \[data-fv-ds\]\)\.rdo-client-page \.det-row/);
  assert.match(css, /:where\(\.fv-ds, \[data-fv-ds\]\)\.rdo-client-page \.client-report-actions textarea/);
  assert.doesNotMatch(css, /:where\(\.fv-ds, \[data-fv-ds\]\)\s+\.rdo-client-page/);
});

test('tutorial do cliente usa os seletores do novo design system', () => {
  const tutorial = source('src/components/ClientTutorial.tsx');

  for (const selector of [
    '.client-report-card .fv-button--secondary',
    '.client-report-actions .fv-button--primary',
    '.client-report-actions .fv-button--danger',
    '.fv-topbar-profile:not(:disabled)'
  ]) {
    assert.ok(tutorial.includes(selector), `seletor ausente: ${selector}`);
  }
  assert.doesNotMatch(tutorial, /\.secondary-button|\.primary-button|\.danger-button|\.topbar-chip/);
});
