import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('evolução dos projetos mostra equipe e preserva ações de gestão', () => {
  const source = read('../src/pages/efetivo/components/ProjectWorkflowBoard.tsx');
  assert.match(source, /Participantes da missão/);
  assert.match(source, /Ocultar equipe/);
  assert.match(source, /Equipe e ciclos/);
  assert.match(source, /Editar equipe inicial/);
  const css = read('../src/pages/efetivo/efetivo.css');
  assert.match(css, /max-width: 1279\.98px[\s\S]*?\.efetivo-kanban\.show-cancelled \{ grid-template-columns: repeat\(3/);
  assert.match(css, /\.efetivo-kanban-details > div \{[^}]*grid-template-columns: 26px minmax\(0, 1fr\)/);
});

test('a página, os portais e a prévia de arraste compartilham o tema do Efetivo', () => {
  const theme = read('../src/pages/efetivo/EfetivoTheme.css');
  const dialogs = read('../src/pages/efetivo/EfetivoDialogs.css');
  const css = read('../src/pages/efetivo/efetivo.css');
  assert.match(dialogs, /@import '\.\/EfetivoTheme\.css'/);
  for (const boundary of ['.efetivo-page-v2', '.efetivo-dialog', '.modal-card.efetivo-modal', '.efetivo-kanban-ghost']) {
    assert.ok(theme.split('}')[0].includes(boundary));
  }
  for (const [alias, token] of [['tx', 'ink'], ['wh', 'surface'], ['bd', 'line'], ['error-bg', 'danger-bg'], ['warning-text', 'warning']]) {
    assert.ok(theme.includes(`--${alias}: var(--${token});`));
  }
  assert.match(theme, /\.primary-button\s*\{[^}]*color: var\(--on-brand\)/);
  assert.match(theme, /\.danger-button\s*\{[^}]*color: var\(--on-danger\)/);
  assert.match(theme, /:disabled\s*\{[^}]*background: var\(--disabled-bg\)/);
  assert.match(theme, /:focus-visible\s*\{[^}]*var\(--focus-ring\)/);
  assert.doesNotMatch(css, /#f8faf8|#4a2c05|rgba\(48, 80, 58/);
  assert.match(css, /\.efetivo-admin-tabs button\.active\s*\{[^}]*background: var\(--brand-soft\)/);
});
