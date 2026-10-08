import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

async function load(path) {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname, server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try { return await server.ssrLoadModule(path); } finally { await server.close(); }
}

const collaborators = [
  { id: 'c1', name: 'Álvaro Silva', role: 'Assistente de Operações III', jobRoleId: 'r1', isActive: true },
  { id: 'c2', name: 'Bianca Souza', role: 'Mantenedor I', jobRoleId: 'r2', isActive: true }
];

test('busca da equipe ignora acentos e encontra por nome ou cargo', async () => {
  const team = await load('/src/utils/missionTeam.ts');
  assert.deepEqual(team.filterMissionTeamCollaborators(collaborators, 'alvaro').map(item => item.id), ['c1']);
  assert.deepEqual(team.filterMissionTeamCollaborators(collaborators, 'operacoes iii').map(item => item.id), ['c1']);
  assert.deepEqual(team.filterMissionTeamCollaborators(collaborators, 'mantenedor').map(item => item.id), ['c2']);
});

test('edição pré-seleciona colaboradores alocados sem duplicar IDs', async () => {
  const team = await load('/src/utils/missionTeam.ts');
  const mission = { allocations: [{ collaboratorId: 'c2' }, { collaboratorId: 'c1' }, { collaboratorId: 'c2' }] };
  assert.deepEqual(team.selectedMissionCollaboratorIds(mission), ['c2', 'c1']);
  assert.deepEqual(team.toggleMissionCollaborator(['c2'], 'c1', true), ['c2', 'c1']);
  assert.deepEqual(team.toggleMissionCollaborator(['c2', 'c1'], 'c2', false), ['c1']);
});

test('troca de colaborador remove o período antigo e cria o novo dentro da missão', async () => {
  const team = await load('/src/utils/missionTeam.ts');
  const periods = [{
    collaboratorId: 'old-member',
    mobilizationDate: '2026-09-07',
    demobilizationDate: '2026-11-26'
  }];

  assert.deepEqual(team.synchronizeMissionAllocationPeriods(
    ['new-member'],
    periods,
    '2026-09-07',
    '2026-11-26'
  ), [{
    collaboratorId: 'new-member',
    mobilizationDate: '2026-09-07',
    demobilizationDate: '2026-11-26'
  }]);
});

test('mudança da mobilização move o primeiro ciclo herdado sem alterar datas individuais', async () => {
  const team = await load('/src/utils/missionTeam.ts');
  const periods = [
    { collaboratorId: 'default', mobilizationDate: '2026-09-07', demobilizationDate: '2026-11-26' },
    { collaboratorId: 'custom', mobilizationDate: '2026-09-14', demobilizationDate: '2026-11-12' }
  ];
  assert.deepEqual(team.shiftDefaultMissionAllocationPeriods(periods,
    { startDate: '2026-09-07', endDate: '2026-11-26' },
    { startDate: '2026-09-10', endDate: '2026-11-30' }
  ), [
    { collaboratorId: 'default', mobilizationDate: '2026-09-10', demobilizationDate: '2026-11-30' },
    periods[1]
  ]);
});

test('remoção da equipe inicial envia datas válidas mesmo com ciclo padrão antigo do projeto 5841', async () => {
  const team = await load('/src/utils/missionTeam.ts');
  const mission = {
    stage: 'STANDBY', mobilizationDate: '2026-10-22', executionStartDate: '2026-10-22',
    executionEndDate: '2026-11-30', returnDate: '2026-12-01',
    cycles: [{ id: 'default', isDefault: true, mobilizationDate: '2026-09-25', demobilizationDate: '2026-12-01' }],
    allocations: ['messias', 'retained'].map(collaboratorId => ({
      collaboratorId, mobilizationDate: null, demobilizationDate: null, cycles: []
    }))
  };
  const periods = mission.allocations.map(allocation => {
    const period = team.missionTeamAllocationPeriod(allocation, mission);
    return { collaboratorId: allocation.collaboratorId, mobilizationDate: period.startDate, demobilizationDate: period.endDate };
  });
  const allocationPeriods = team.synchronizeMissionAllocationPeriods(['retained'], periods, mission.mobilizationDate, mission.returnDate);
  assert.deepEqual(allocationPeriods, [{
    collaboratorId: 'retained', mobilizationDate: '2026-10-22', demobilizationDate: '2026-12-01'
  }]);
  assert.deepEqual(team.missionTeamCollaboratorPeriods({
    mission, collaboratorId: 'retained', startDate: mission.mobilizationDate, endDate: mission.returnDate, allocationPeriods
  }), [{ id: null, startDate: '2026-10-22', endDate: '2026-12-01', isOpen: false }]);
});

test('equipe inicial do projeto 5841 remove Messias mantendo períodos registrados na requisição', async () => {
  const team = await load('/src/utils/missionTeam.ts');
  const retainedIds = ['almir', 'carlos', 'daniel', 'luan'];
  const mission = {
    projectId: 'project-5841', headquartersResponsibleUserId: 'leader', scheduleStatus: 'CONFIRMED',
    stage: 'STANDBY', mobilizationDate: '2026-10-22', executionStartDate: '2026-10-22',
    executionEndDate: '2026-11-30', returnDate: '2026-12-01',
    cycles: [{ id: 'default', isDefault: true, mobilizationDate: '2026-09-25', demobilizationDate: '2026-12-01' }],
    allocations: [...retainedIds, 'messias'].map(collaboratorId => ({
      collaboratorId, mobilizationDate: null, demobilizationDate: null,
      cycles: [{ id: `cycle-${collaboratorId}`, mobilizationDate: '2026-09-25', demobilizationDate: '2026-12-01' }]
    }))
  };
  const periods = mission.allocations.map(allocation => {
    const period = team.missionTeamAllocationPeriod(allocation, mission);
    return { collaboratorId: allocation.collaboratorId, mobilizationDate: period.startDate, demobilizationDate: period.endDate };
  });
  const allocationPeriods = team.synchronizeMissionAllocationPeriods(retainedIds, periods, mission.mobilizationDate, mission.returnDate);
  const input = { ...mission, collaboratorIds: retainedIds, allocationPeriods };
  assert.deepEqual(input.allocationPeriods.map(period => period.collaboratorId), retainedIds);
  assert.ok(input.allocationPeriods.every(period => period.mobilizationDate === '2026-09-25'));
});

test('edição da equipe conserva datas individuais e ciclos confirmados', async () => {
  const team = await load('/src/utils/missionTeam.ts');
  const mission = {
    stage: 'STANDBY', mobilizationDate: '2026-10-22', executionEndDate: '2026-11-30', returnDate: '2026-12-01',
    cycles: [{ id: 'default', isDefault: true, mobilizationDate: '2026-09-25', demobilizationDate: '2026-12-01' }]
  };
  const inherited = { mobilizationDate: null, demobilizationDate: null, cycles: [] };
  assert.deepEqual(team.missionTeamAllocationPeriod({ ...inherited, mobilizationDate: '2026-10-23', demobilizationDate: '2026-11-20' }, mission), {
    startDate: '2026-10-23', endDate: '2026-11-20'
  });
  assert.deepEqual(team.missionTeamAllocationPeriod({ ...inherited, cycles: [{ mobilizationDate: '2026-10-24', demobilizationDate: '2026-11-19' }] }, mission), {
    startDate: '2026-10-24', endDate: '2026-11-19'
  });
  for (const historicalMission of [
    { ...mission, project: { workflow: { actualMobilizationDate: '2026-09-25' } } },
    { ...mission, stage: 'EXECUTION' },
    { ...mission, cycles: [{ ...mission.cycles[0], demobilizationDate: '2026-11-15' }] },
    { ...mission, cycles: [{ ...mission.cycles[0], isDefault: false }] },
    { ...mission, cycles: [...mission.cycles, { id: 'second', mobilizationDate: '2026-12-03', demobilizationDate: '2026-12-10' }] }
  ]) {
    assert.equal(team.missionTeamAllocationPeriod(inherited, historicalMission).startDate, '2026-09-25');
  }
});

test('edição da equipe preserva as datas oficiais quando a previsão do fluxo mudou', async () => {
  const team = await load('/src/utils/missionTeam.ts');
  const mission = {
    mobilizationDate: '2026-09-07',
    executionStartDate: '2026-09-08',
    executionEndDate: '2026-11-26',
    returnDate: null
  };
  const workflow = {
    mobilizationDate: '2026-10-01',
    executionStartDate: '2026-10-01',
    executionEndDate: '2026-11-26'
  };

  assert.deepEqual(team.resolveMissionTeamScheduleDates(mission, workflow, { returnDate: '2026-12-01' }), {
    ...mission,
    returnDate: ''
  });
  assert.deepEqual(team.resolveMissionTeamScheduleDates(null, workflow), { ...workflow, returnDate: '' });
});

test('filtro da seleção permite ativos, inativos e todos sem perder a equipe selecionada', async () => {
  const team = await load('/src/utils/missionTeam.ts');
  const people = [...collaborators, { id: 'c3', name: 'Pessoa desligada', role: 'Mantenedor I', jobRoleId: 'r2', isActive: false }];
  assert.deepEqual(team.filterCollaboratorsByActivity(people, 'ACTIVE').map(person => person.id), ['c1', 'c2']);
  assert.deepEqual(team.filterCollaboratorsByActivity(people, 'INACTIVE').map(person => person.id), ['c3']);
  assert.deepEqual(team.filterCollaboratorsByActivity(people, 'ALL').map(person => person.id), ['c1', 'c2', 'c3']);
  assert.deepEqual(team.toggleMissionCollaborator(['c1'], 'c3', true), ['c1', 'c3']);
});

test('definição da equipe inicial reativa uma programação cancelada', async () => {
  const team = await load('/src/utils/missionTeam.ts');
  assert.equal(team.missionTeamScheduleStatus('CANCELLED', true), 'CONFIRMED');
  assert.equal(team.missionTeamScheduleStatus('CANCELLED', false), 'CANCELLED');
  assert.equal(team.missionTeamScheduleStatus('DRAFT', false), 'CONFIRMED');
});
