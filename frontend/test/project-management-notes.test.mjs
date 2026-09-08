import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = relativePath => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('dashboard de projeto exibe campo e histórico de notas com autoria e data', async () => {
  const source = await readSource('src/components/projects/ProjectDetailDashboard.tsx');

  assert.match(source, /Notas da gestão/);
  assert.match(source, /canManageProjectNotes \? \(/);
  assert.match(source, /className="field-group acp-project-note-field"/);
  assert.match(source, /<textarea[\s\S]{0,500}?maxLength=\{2000\}/);
  assert.match(source, /note\.author\.name/);
  assert.match(source, /<time dateTime=\{note\.createdAt\}>\{fmtDateTime\(note\.createdAt\)\}<\/time>/);
  assert.ok(
    source.indexOf('data-acp-project-notes') > source.indexOf('data-quality-project-deviations'),
    'o bloco de notas deve aparecer depois dos desvios'
  );
});

test('API de notas usa o projeto e separa leitura de criação', async () => {
  const source = await readSource('src/api/acompanhamentoComercial.ts');

  assert.match(source, /function listProjectManagementNotes\(projectId: string\)/);
  assert.match(source, /apiClient\.get<ProjectManagementNote\[]>\([\s\S]{0,180}?\/notas-gestao/);
  assert.match(source, /function createProjectManagementNote\([\s\S]{0,260}?apiClient\.post<ProjectManagementNote>/);
});

test('somente gestores recebem a permissão de adicionar notas', async () => {
  const pageSource = await readSource('src/pages/acompanhamento/AcompanhamentoPage.tsx');
  const boardSource = await readSource('src/components/projects/ProjectCardsBoard.tsx');

  assert.match(pageSource, /canManageProjectNotes=\{isManager\}/);
  assert.match(boardSource, /canManageProjectNotes=\{canManageProjectNotes\}/);
});
