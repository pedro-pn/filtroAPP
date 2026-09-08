import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createServer } from 'vite';

async function load(path) {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname, server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try { return await server.ssrLoadModule(path); } finally { await server.close(); }
}

function collaborator(id, status = 'FREE') {
  return { id, name: `Pessoa ${id}`, role: 'Operação', status, isActive: true };
}

function mission(id, stage, collaboratorId, mobilizationDate = '2026-09-01') {
  return {
    id, stage, scheduleStatus: 'CONFIRMED', mobilizationDate, returnDate: '2026-09-30',
    project: { code: id, name: `Missão ${id}` }, allocations: [{ collaboratorId }]
  };
}

test('disponibilidade separa livres, aguardando, mobilizados e férias', async () => {
  const { buildAvailabilityColumns } = await load('/src/utils/collaboratorAvailability.ts');
  const result = buildAvailabilityColumns(
    [collaborator('livre'), collaborator('aguarda'), collaborator('mobilizado', 'ALLOCATED'), collaborator('ferias', 'UNAVAILABLE')],
    [mission('m1', 'STANDBY', 'aguarda'), mission('m2', 'EXECUTION', 'mobilizado', '2026-08-01')],
    [{ collaboratorId: 'ferias', type: 'FERIAS', startDate: '2026-08-01', endDate: '2026-08-31' }],
    '2026-08-27'
  );
  assert.deepEqual(result.columns.AVAILABLE.map(item => item.collaborator.id), ['livre']);
  assert.deepEqual(result.columns.AWAITING_MOBILIZATION.map(item => item.collaborator.id), ['aguarda']);
  assert.deepEqual(result.columns.MOBILIZED.map(item => item.collaborator.id), ['mobilizado']);
  assert.deepEqual(result.columns.ON_VACATION.map(item => item.collaborator.id), ['ferias']);
});

test('quadro de disponibilidade é somente leitura e não expõe drag ou movimentação', () => {
  const source = fs.readFileSync(new URL('../src/pages/efetivo/components/AvailabilityBoard.tsx', import.meta.url), 'utf8');
  assert.match(source, /Somente leitura/);
  assert.doesNotMatch(source, /draggable=|onDrag|Mover para/);
  assert.doesNotMatch(source, /Livre para mobilização|Sem compromisso na data/);
});

test('formulário calcula disponibilidade em todo o período e ignora a própria missão', async () => {
  const { buildMissionAvailabilityColumns } = await load('/src/utils/collaboratorAvailability.ts');
  const people = ['livre', 'aguarda', 'mobilizado', 'ferias', 'propria'].map(id => ({
    ...collaborator(id), jobRoleId: 'r1', admissionDate: '2025-01-01', terminationDate: null
  }));
  const result = buildMissionAvailabilityColumns(
    people,
    [
      mission('standby', 'STANDBY', 'aguarda', '2026-09-05'),
      mission('execucao', 'EXECUTION', 'mobilizado', '2026-08-01'),
      mission('current', 'EXECUTION', 'propria', '2026-08-01')
    ],
    [{ collaboratorId: 'ferias', type: 'FERIAS', startDate: '2026-09-04', endDate: '2026-09-08' }],
    '2026-09-01',
    '2026-09-10',
    'current'
  );
  assert.deepEqual(result.columns.AVAILABLE.map(item => item.collaborator.id), ['livre', 'propria']);
  assert.deepEqual(result.columns.AWAITING_MOBILIZATION.map(item => item.collaborator.id), ['aguarda']);
  assert.deepEqual(result.columns.MOBILIZED.map(item => item.collaborator.id), ['mobilizado']);
  assert.deepEqual(result.columns.ON_VACATION.map(item => item.collaborator.id), ['ferias']);
});

test('disponibilidade respeita mobilização e desmobilização individuais', async () => {
  const { buildAvailabilityColumns } = await load('/src/utils/collaboratorAvailability.ts');
  const partialMission = {
    ...mission('parcial', 'EXECUTION', 'parcial', '2026-09-01'),
    allocations: [{
      collaboratorId: 'parcial',
      mobilizationDate: '2026-09-05',
      demobilizationDate: '2026-09-20'
    }]
  };
  const person = collaborator('parcial', 'FREE');
  assert.deepEqual(
    buildAvailabilityColumns([person], [partialMission], [], '2026-09-04').columns.AWAITING_MOBILIZATION.map(item => item.collaborator.id),
    ['parcial']
  );
  assert.deepEqual(
    buildAvailabilityColumns([person], [partialMission], [], '2026-09-05').columns.MOBILIZED.map(item => item.collaborator.id),
    ['parcial']
  );
  assert.deepEqual(
    buildAvailabilityColumns([person], [partialMission], [], '2026-09-21').columns.AVAILABLE.map(item => item.collaborator.id),
    ['parcial']
  );
});

test('disponibilidade não considera o colaborador mobilizado durante a pausa entre ciclos', async () => {
  const { buildAvailabilityColumns } = await load('/src/utils/collaboratorAvailability.ts');
  const pausedMission = {
    ...mission('ciclica', 'EXECUTION', 'ciclico', '2026-07-01'),
    executionEndDate: '2026-09-30',
    cycles: [
      { id: 'mc1', mobilizationDate: '2026-07-07', demobilizationDate: '2026-07-09' },
      { id: 'mc2', mobilizationDate: '2026-09-07', demobilizationDate: '2026-09-09' }
    ]
  };
  const person = collaborator('ciclico', 'FREE');
  assert.deepEqual(
    buildAvailabilityColumns([person], [pausedMission], [], '2026-08-01').columns.AWAITING_MOBILIZATION.map(item => item.collaborator.id),
    ['ciclico']
  );
  assert.deepEqual(
    buildAvailabilityColumns([person], [pausedMission], [], '2026-09-08').columns.MOBILIZED.map(item => item.collaborator.id),
    ['ciclico']
  );
});

test('seleção da equipe abre diálogo kanban em vez de lista embutida', () => {
  const source = fs.readFileSync(new URL('../src/pages/efetivo/components/MissionTeamSelector.tsx', import.meta.url), 'utf8');
  assert.match(source, /Ver colaboradores/);
  assert.match(source, /buildMissionAvailabilityColumns/);
  assert.match(source, /efetivo-team-availability-kanban/);
  assert.match(source, /Filtrar por cargo/);
  assert.match(source, /Confirmar sobreposição/);
  assert.doesNotMatch(source, /className="efetivo-team-list"/);
});

test('gestão direta da equipe permite múltiplos ciclos e confirma sobreposição', () => {
  const source = fs.readFileSync(new URL('../src/pages/efetivo/components/MissionAllocationModal.tsx', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../src/pages/efetivo/efetivo.css', import.meta.url), 'utf8');
  assert.match(source, /Ciclos do projeto/);
  assert.match(source, /Novo ciclo individual/);
  assert.match(source, /Personalizar ciclos/);
  assert.match(source, /Registre a desmobilização antes de criar outro ciclo/);
  assert.match(source, /Confirmar sobreposição/);
  assert.match(source, /efetivo-allocation-add-actions/);
  assert.match(css, /\.efetivo-allocation-add\s*\{[^}]*grid-template-columns:\s*minmax\(220px, 1fr\) minmax\(300px, 1fr\)/);
  assert.match(css, /\.efetivo-cycle-list > article\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/);
  assert.match(css, /@media \(max-width: 540px\)[\s\S]*?\.efetivo-cycle-add,[\s\S]*?grid-template-columns:\s*1fr;/);
});

test('status dos dois kanbans têm bolinhas com cores próprias e o módulo usa toda a largura', () => {
  const css = fs.readFileSync(new URL('../src/pages/efetivo/efetivo.css', import.meta.url), 'utf8');
  for (const status of ['STANDBY', 'MOBILIZATION', 'EXECUTION', 'FINAL_MEASUREMENT', 'FINISHED']) {
    assert.match(css, new RegExp(`\\[data-kanban-stage='${status}'\\] \\{ --stage: #[0-9a-f]{6}; \\}`));
  }
  for (const status of ['AVAILABLE', 'AWAITING_MOBILIZATION', 'MOBILIZED', 'ON_VACATION']) {
    assert.match(css, new RegExp(`\\[data-availability-status='${status}'\\] \\{ --stage: #[0-9a-f]{6}; \\}`));
  }
  assert.match(css, /\.app-shell:has\(\.equip-page\.efetivo-page\)\s*\{[\s\S]*?max-width:\s*none/);
});
