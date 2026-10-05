import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = relativePath => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('dashboard de projeto exibe campo e histórico de notas com autoria e data', async () => {
  const source = await readSource('src/components/projects/ProjectDetailDashboard.tsx');

  assert.match(source, /Notas da gestão/);
  assert.match(source, /canManageProjectNotes \? \(/);
  assert.match(source, /<Field id="acp-project-note-content" label="Nova nota"/);
  assert.match(source, /<Textarea[\s\S]{0,500}?maxLength=\{2000\}/);
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

test('somente gestores podem abrir a edição das divisões do acompanhamento', async () => {
  const board = await readSource('src/components/projects/ProjectCardsBoard.tsx');
  const detail = await readSource('src/components/projects/ProjectDetailDashboard.tsx');

  assert.match(board, /canManageDivisions=\{canManageGroups\}/);
  assert.match(detail, /canManageDivisions \? <Button[^>]*onClick=\{\(\) => \{[^}]*setTrackingDivisionsOpen\(true\)/);
  assert.match(detail, /canManageDivisions && trackingDivisionsOpen && projectId && trackingDivisions \? <ProjectTrackingDivisionsPanel/);
});

test('dashboard usa a equipe planejada como fallback antes do primeiro RDO', async () => {
  const source = await readSource('src/components/projects/ProjectDetailDashboard.tsx');
  const people = await readSource('src/components/projects/ProjectDetailPeople.tsx');

  assert.match(source, /!data\.header\.lastRdoDate/);
  assert.match(source, /plannedCollaborators\.map/);
  assert.match(people, /<Badge tone="info">Planejado<\/Badge>/);
  assert.match(people, /Ainda não há RDO para este projeto/);
});

test('escopo do dashboard acomoda textos longos no layout atual', async () => {
  const styles = await readSource('src/components/projects/ProjectDetailDashboard.ds.css');

  assert.match(styles, /\.acp-detail-scope li \{[^}]*overflow-wrap: anywhere;/);
});
