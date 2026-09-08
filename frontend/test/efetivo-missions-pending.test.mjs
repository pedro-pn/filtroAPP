import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import fs from 'node:fs';

async function load(path) {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname, server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try { return await server.ssrLoadModule(path); } finally { await server.close(); }
}

function mission(overrides = {}) {
  return {
    id: 'm1',
    scheduleStatus: 'CONFIRMED',
    headquartersResponsibleUserId: 'u1',
    headquartersResponsibleName: 'Coordenação',
    headquartersResponsibleCollaboratorId: 'c1',
    demands: [{ jobRoleId: 'r1', requiredCount: 2 }],
    allocations: [{ id: 'a1' }, { id: 'a2' }],
    ...overrides
  };
}

test('pendências apontam demanda, equipe e confirmação faltantes', async () => {
  const pendencies = await load('/src/utils/missionPendencies.ts');
  assert.deepEqual(pendencies.missionPendencies(mission()), []);
  assert.deepEqual(pendencies.missionPendencies(mission({ demands: [] })), ['Selecionar a equipe']);
  assert.deepEqual(pendencies.missionPendencies(mission({ allocations: [{ id: 'a1' }] })), ['Completar a equipe (1/2)']);
  assert.deepEqual(pendencies.missionPendencies(mission({ scheduleStatus: 'DRAFT' })), ['Confirmar a programação']);
  assert.deepEqual(pendencies.missionPendencies(mission({ scheduleStatus: 'CANCELLED', demands: [] })), []);
});

test('contagem soma projetos sem programação e missões incompletas', async () => {
  const pendencies = await load('/src/utils/missionPendencies.ts');
  const count = pendencies.countMissionPendencies([mission(), mission({ id: 'm2', demands: [] })], [{ id: 'p1' }]);
  assert.equal(count, 2);
});

test('datas do projeto pré-preenchem a programação', async () => {
  const pendencies = await load('/src/utils/missionPendencies.ts');
  assert.deepEqual(pendencies.prefillDatesFromProject({ mobilizationDate: '2026-09-01T00:00:00.000Z', startDate: '2026-09-03T00:00:00.000Z' }), {
    mobilizationDate: '2026-09-01',
    executionStartDate: '2026-09-03',
    executionEndDate: '',
    returnDate: ''
  });
});

test('aba Missões só nasce de projeto cadastrado, sem cadastro manual', () => {
  const board = fs.readFileSync(new URL('../src/pages/efetivo/components/MissionsBoard.tsx', import.meta.url), 'utf8');
  const form = fs.readFileSync(new URL('../src/pages/efetivo/components/MissionFormModal.tsx', import.meta.url), 'utf8');
  assert.match(board, /listPendingMissionProjects/);
  assert.match(board, /efetivo-mission-pending/);
  assert.doesNotMatch(board, /Nova missão/);
  assert.doesNotMatch(form, /id="mission-project"/);
});

test('situação de rascunho não pode mais ser escolhida nem filtrada na programação', () => {
  const board = fs.readFileSync(new URL('../src/pages/efetivo/components/MissionsBoard.tsx', import.meta.url), 'utf8');
  const form = fs.readFileSync(new URL('../src/pages/efetivo/components/MissionFormModal.tsx', import.meta.url), 'utf8');
  const api = fs.readFileSync(new URL('../src/api/efetivoPlanning.ts', import.meta.url), 'utf8');
  const schemas = fs.readFileSync(new URL('../../backend/src/lib/efetivo/planning/schemas.js', import.meta.url), 'utf8');

  assert.doesNotMatch(board, /<option value="DRAFT">/);
  assert.doesNotMatch(form, /<option value="DRAFT">/);
  assert.match(api.match(/export interface MissionInput \{[\s\S]*?\n\}/)?.[0] || '', /Exclude<MissionScheduleStatus, 'DRAFT'>/);
  assert.match(schemas, /editableMissionScheduleStatusSchema = z\.enum\(\['CONFIRMED', 'CANCELLED'\]\)/);
});

test('kanban arrasta pelo card inteiro e limpa o estado de arraste ao soltar', () => {
  const kanban = fs.readFileSync(new URL('../src/pages/efetivo/components/MissionKanban.tsx', import.meta.url), 'utf8');
  assert.match(kanban, /draggable=\{moveAllowed\}/);
  assert.match(kanban, /missionPendencies\(mission\)\.length === 0/);
  assert.match(kanban, /const \[draggingId, setDraggingId\]/);
  assert.doesNotMatch(kanban, /drag-placeholder/);
  assert.doesNotMatch(kanban, /efetivo-drag-handle/);
});

test('cada etapa tem cor apenas na bolinha, com colunas e cards em cor única', () => {
  const css = fs.readFileSync(new URL('../src/pages/efetivo/efetivo.css', import.meta.url), 'utf8');
  const kanban = fs.readFileSync(new URL('../src/pages/efetivo/components/MissionKanban.tsx', import.meta.url), 'utf8');
  for (const stage of ['STANDBY', 'MOBILIZATION', 'EXECUTION', 'FINAL_MEASUREMENT', 'FINISHED']) {
    assert.match(css, new RegExp(`\\[data-kanban-stage='${stage}'\\] \\{ --stage:`));
  }
  assert.match(kanban, /efetivo-stage-dot/);
  assert.match(css, /\.efetivo-stage-dot \{[^}]*background: var\(--stage/);
  assert.doesNotMatch(css, /--stage-soft/);
  assert.doesNotMatch(css, /border-left: 4px solid var\(--stage/);
});

test('paridade de campos com o exemplo de referência', () => {
  const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const scenarioForm = read('../src/pages/efetivo/components/ScenarioFormModal.tsx');
  for (const label of ['Nome do cenário *', 'Objetivo da simulação', 'Contratação hipotética', 'Quantidade', 'Disponíveis a partir de']) {
    assert.ok(scenarioForm.includes(label), `campo ausente no diálogo de cenário: ${label}`);
  }
  const missionForm = read('../src/pages/efetivo/components/MissionFormModal.tsx')
    + read('../src/pages/efetivo/components/MissionTeamSelector.tsx');
  for (const label of ['Liderança', 'Vincular líder', 'Programação', 'Previsão de mobilização', 'Desmobilização', 'Opcional.', 'Ver colaboradores']) {
    assert.ok(missionForm.includes(label), `campo ausente no diálogo de missão: ${label}`);
  }
  const missionsBoard = read('../src/pages/efetivo/components/MissionsBoard.tsx');
  for (const label of ['posições planejadas', 'posições pendentes', 'Equipe completa e sem conflitos', 'Alocar disponíveis']) {
    assert.ok(missionsBoard.includes(label), `resumo ausente na aba Missões: ${label}`);
  }
  const kanban = read('../src/pages/efetivo/components/MissionKanban.tsx');
  for (const label of ['contratos no fluxo', 'LÍDER VINCULADO', 'Ver líder e equipe', 'Nenhuma missão nesta etapa']) {
    assert.ok(kanban.includes(label), `elemento ausente no kanban: ${label}`);
  }
  const stages = read('../src/utils/missionKanban.ts');
  assert.match(stages, /MISSION_STAGE_DESCRIPTIONS/);
  const css = read('../src/pages/efetivo/efetivo.css');
  assert.match(missionsBoard, /efetivo-action-row efetivo-mission-card-actions/);
  assert.match(css, /\.efetivo-mission-card-actions\s*\{[^}]*flex-wrap:\s*nowrap/);
  const calendar = read('../src/pages/efetivo/components/OperationalCalendar.tsx');
  assert.match(calendar, /'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'/);
});
