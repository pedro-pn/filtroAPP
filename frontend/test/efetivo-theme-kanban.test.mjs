import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('líder e todos os participantes aparecem sem interação prévia', async t => {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false },
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom'
  });
  try {
    const { MissionKanbanTeam } = await server.ssrLoadModule('/src/pages/efetivo/components/MissionKanbanTeam.tsx');
    for (const status of ['CONFIRMED', 'DRAFT', 'CANCELLED']) {
      for (const count of [0, 1, 8]) {
        await t.test(`${status}: ${count} participantes`, () => {
          const mission = {
            scheduleStatus: status,
            headquartersResponsibleName: count ? 'Ana Oliveira' : '',
            headquartersResponsibleRole: count ? 'Coordenadora' : '',
            headquartersResponsibleCollaboratorId: count ? 'person-0' : null,
            allocations: Array.from({ length: count }, (_, index) => ({
              id: `allocation-${index}`, collaboratorId: `person-${index}`,
              collaborator: { name: `Pessoa ${index}`, role: 'Cargo do cadastro' },
              jobRole: index ? undefined : { name: 'Função da missão' }
            }))
          };
          const html = renderToStaticMarkup(createElement(MissionKanbanTeam, { mission }));
          assert.ok(html.includes(`Participantes da missão · ${count}`));
          assert.doesNotMatch(html, /<button|aria-expanded| hidden[ =>]|<details/);
          // Initials are decorative, not duplicated content for screen readers.
          assert.ok(html.includes('aria-hidden="true"'));
          for (let index = 0; index < count; index += 1) assert.ok(html.includes(`Pessoa ${index}`));
          if (count) {
            assert.ok(html.includes('Ana Oliveira'));
            assert.ok(html.includes('Função da missão'));
            assert.equal((html.match(/<em>Líder<\/em>/g) || []).length, 1);
          } else {
            assert.ok(html.includes('Líder não vinculado'));
            assert.ok(html.includes('Nenhum colaborador alocado ainda.'));
          }
        });
      }
    }
    await t.test('alocação sem dados expandidos mantém fallback legível', () => {
      const html = renderToStaticMarkup(createElement(MissionKanbanTeam, { mission: {
        headquartersResponsibleName: '', headquartersResponsibleCollaboratorId: null,
        allocations: [{ id: 'allocation', collaboratorId: 'person' }]
      } }));
      assert.ok(html.includes('Colaborador'));
      assert.ok(html.includes('Cargo não informado'));
    });
  } finally {
    await server.close();
  }
});

test('cards ativos e cancelados reutilizam a equipe permanente e preservam a gestão', () => {
  const source = read('../src/pages/efetivo/components/MissionKanban.tsx');
  assert.equal((source.match(/<MissionKanbanTeam mission=\{mission\} \/>/g) || []).length, 2);
  assert.doesNotMatch(source, /expandedId|setExpandedId|Ver líder e equipe|Ocultar equipe/);
  assert.match(source, /setAllocating\(mission\)/);
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
