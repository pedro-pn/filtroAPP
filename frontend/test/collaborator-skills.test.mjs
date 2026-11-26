import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const read = file => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');

test('tags de habilidade mostram nível e nome, do maior para o menor nível', async t => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  t.after(() => server.close());
  const { CollaboratorSkillTags } = await server.ssrLoadModule('/src/components/efetivo/CollaboratorSkillTags.tsx');
  const { CollaboratorSkillEditor } = await server.ssrLoadModule('/src/components/efetivo/CollaboratorSkillEditor.tsx');

  const html = renderToStaticMarkup(createElement(CollaboratorSkillTags, { skillLevels: { FILTRATION: 2, FLUSHING: 3, HYDROJETTING: 1 } }));
  assert.match(html, /aria-label="Habilidades"/);
  assert.ok(html.indexOf('Flushing') < html.indexOf('Filtragem') && html.indexOf('Filtragem') < html.indexOf('Hidrojato'));
  assert.match(html, /class="fv-skill-tag fv-skill-level--3" title="Flushing: nível 3 — Apto \/ executa com autonomia"/);
  assert.match(html, /class="fv-skill-tag fv-skill-level--2" title="Filtragem: nível 2/);
  assert.match(html, /class="fv-skill-tag fv-skill-level--1" title="Hidrojato: nível 1/);
  assert.doesNotMatch(html, /Teste hidro/);

  assert.equal(renderToStaticMarkup(createElement(CollaboratorSkillTags, { skillLevels: {} })), '');
  assert.match(renderToStaticMarkup(createElement(CollaboratorSkillTags, { skillLevels: null, emptyLabel: 'Não avaliado' })), /Não avaliado/);
  assert.match(renderToStaticMarkup(createElement(CollaboratorSkillTags, { skillLevels: {}, includeZero: true })), /fv-skill-level--0/);

  const editor = renderToStaticMarkup(createElement(CollaboratorSkillEditor, { value: { FLUSHING: 3 }, onChange: () => {} }));
  assert.equal((editor.match(/aria-pressed="true"/g) || []).length, 5, 'uma opção marcada por habilidade');
  assert.match(editor, /aria-pressed="true" aria-label="Flushing: nível 3/);
  assert.match(editor, /aria-pressed="true" aria-label="Limpeza química: nível 0/);
});

test('telas de planejamento e seleção de equipe exibem as habilidades', () => {
  for (const file of ['MissionTeamSelector', 'MissionAllocationModal', 'CollaboratorsBoard', 'AvailabilityBoard', 'ProjectWorkflowBoard', 'ProjectWorkflowPreparationPanels']) {
    assert.match(read(`pages/efetivo/components/${file}.tsx`), /<CollaboratorSkillTags skillLevels=/, file);
  }
  const selector = read('pages/efetivo/components/MissionTeamSelector.tsx');
  assert.match(selector, /id="mission-team-skill-filter" label="Habilidade"/);
  assert.match(selector, /&& matchesSkill\(entry\.collaborator\)/);
  assert.match(read('pages/efetivo/components/OperationalCollaboratorModal.tsx'), /<CollaboratorSkillEditor value=\{skillLevels\}/);
});
