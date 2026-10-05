import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

import { allocateCollaboratorInTransaction } from '../../backend/src/lib/efetivo/planning/allocations.js';
import { resolveSelectedMissionTeam } from '../../backend/src/lib/efetivo/planning/mission-team.js';

const server = await createServer({
  configFile: false,
  root: new URL('..', import.meta.url).pathname,
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true },
  appType: 'custom'
});
let buildMissionAvailabilityColumns;
let missionTeamCollaboratorPeriods;
try {
  ({ buildMissionAvailabilityColumns } = await server.ssrLoadModule('/src/utils/collaboratorAvailability.ts'));
  ({ missionTeamCollaboratorPeriods } = await server.ssrLoadModule('/src/utils/missionTeam.ts'));
} finally {
  await server.close();
}

const role = { id: 'r1', name: 'Operador', isActive: true, isOperational: true };
const person = { id: 'c1', name: 'Ana', role: role.name, jobRoleId: role.id, jobRole: role, admissionDate: '2020-01-01', terminationDate: null, isActive: true };

function mission(overrides = {}) {
  return {
    id: 'm1', planId: 'p1', scheduleStatus: 'CONFIRMED', stage: 'EXECUTION',
    mobilizationDate: '2026-10-01', executionEndDate: '2026-10-31', returnDate: null,
    cycles: [
      { id: 'mc1', isDefault: true, mobilizationDate: '2026-10-01', demobilizationDate: '2026-10-09' },
      { id: 'mc2', mobilizationDate: '2026-10-21', demobilizationDate: '2026-10-31' }
    ],
    demands: [{ jobRoleId: role.id, jobRole: role, requiredCount: 1 }],
    allocations: [],
    ...overrides
  };
}

function absence(startDate = '2026-10-10', endDate = '2026-10-20', type = 'FERIAS') {
  return { id: 'absence1', collaboratorId: person.id, startDate, endDate, type };
}

function database(currentMission, absences = [], otherMissions = []) {
  return {
    collaborator: { findUnique: async () => person, findMany: async () => [person] },
    collaboratorAbsence: { findMany: async () => absences },
    efetivoMissionAllocation: {
      findMany: async ({ where }) => where.missionId
        ? currentMission.allocations.map(allocation => ({ ...allocation, mission: currentMission }))
        : otherMissions.flatMap(other => other.allocations.map(allocation => ({ ...allocation, mission: other }))),
      upsert: async ({ create }) => ({ id: 'new-allocation', ...create })
    }
  };
}

function availability(currentMission, absences = [], otherMissions = [], options = {}) {
  const startDate = options.startDate || currentMission?.mobilizationDate || '2026-10-01';
  const endDate = options.endDate || currentMission?.returnDate || currentMission?.executionEndDate || '2026-10-31';
  const periods = missionTeamCollaboratorPeriods({ mission: currentMission, collaboratorId: person.id, startDate, endDate, ...options });
  return buildMissionAvailabilityColumns([person], otherMissions, absences, startDate, endDate, currentMission?.id, new Map([[person.id, periods]]));
}

test('férias, folga e afastamento somente na pausa não impedem herdar os ciclos', async () => {
  for (const type of ['FERIAS', 'FOLGA', 'AFASTAMENTO']) {
    const currentMission = mission();
    const absences = [absence(undefined, undefined, type)];
    for (const singleSelection of [false, true]) {
      const result = availability(currentMission, absences, [], { singleSelection });
      assert.deepEqual(result.columns.AVAILABLE.map(entry => entry.collaborator.id), [person.id]);
      assert.equal(result.otherUnavailable, 0);
    }
    await assert.doesNotReject(allocateCollaboratorInTransaction(database(currentMission, absences), currentMission, {
      collaboratorId: person.id, jobRoleId: role.id, mobilizationDate: '2026-10-01', demobilizationDate: '2026-10-31'
    }));
  }
});

test('férias que tocam qualquer ciclo continuam bloqueadas nos mesmos dias que a API', async () => {
  for (const [startDate, endDate, blocked] of [
    ['2026-09-29', '2026-09-30', false],
    ['2026-10-01', '2026-10-01', true],
    ['2026-10-09', '2026-10-10', true],
    ['2026-10-10', '2026-10-20', false],
    ['2026-10-20', '2026-10-21', true],
    ['2026-10-31', '2026-10-31', true],
    ['2026-11-01', '2026-11-05', false]
  ]) {
    const currentMission = mission();
    const absences = [absence(startDate, endDate)];
    const result = availability(currentMission, absences, [], { singleSelection: true });
    assert.equal(result.columns.ON_VACATION.length, Number(blocked), `${startDate} a ${endDate}`);
    const allocate = () => allocateCollaboratorInTransaction(database(currentMission, absences), currentMission, {
      collaboratorId: person.id, jobRoleId: role.id, allowMissionOverlap: true
    });
    if (blocked) await assert.rejects(allocate, error => error.conflicts?.some(conflict => conflict.code === 'ABSENCE_FERIAS'));
    else await assert.doesNotReject(allocate);
  }
});

test('período individual contínuo não ganha a pausa dos ciclos gerais', async () => {
  for (const [startDate, endDate, blocked] of [
    ['2026-10-09', '2026-10-21', true],
    ['2026-10-21', '2026-10-25', false]
  ]) {
    const currentMission = mission();
    const absences = [absence()];
    const result = availability(currentMission, absences, [], { startDate, endDate, singleSelection: true });
    assert.equal(result.columns.ON_VACATION.length, Number(blocked));
    const allocate = () => allocateCollaboratorInTransaction(database(currentMission, absences), currentMission, {
      collaboratorId: person.id, jobRoleId: role.id, mobilizationDate: startDate, demobilizationDate: endDate
    });
    if (blocked) await assert.rejects(allocate, error => error.conflicts?.some(conflict => conflict.code === 'ABSENCE_FERIAS'));
    else await assert.doesNotReject(allocate);
  }
});

test('edição da equipe preserva pausas dos ciclos individuais mesmo com datas agregadas no formulário', async () => {
  const currentMission = mission({ cycles: [] });
  currentMission.allocations = [{
    id: 'allocation1', collaboratorId: person.id, jobRoleId: role.id,
    cycles: mission().cycles, mobilizationDate: null, demobilizationDate: null
  }];
  const absences = [absence()];
  const allocationPeriods = [{ collaboratorId: person.id, mobilizationDate: '2026-10-01', demobilizationDate: '2026-10-31' }];
  assert.equal(availability(currentMission, absences, [], { allocationPeriods }).columns.AVAILABLE.length, 1);
  await assert.doesNotReject(resolveSelectedMissionTeam(database(currentMission, absences), {
    scheduleStatus: 'CONFIRMED', collaboratorIds: [person.id],
    mobilizationDate: currentMission.mobilizationDate, executionEndDate: currentMission.executionEndDate,
    allocationPeriods
  }, currentMission.planId, currentMission.id, { mission: currentMission }));
});

test('outra missão durante a pausa não exige confirmação, mas interseção com um ciclo exige', async () => {
  for (const [startDate, endDate, overlaps] of [
    ['2026-10-10', '2026-10-20', false],
    ['2026-10-09', '2026-10-10', true]
  ]) {
    const currentMission = mission();
    const other = mission({ id: 'other', cycles: [], mobilizationDate: startDate, executionEndDate: endDate, allocations: [{ collaboratorId: person.id }] });
    const result = availability(currentMission, [], [other], { singleSelection: true });
    assert.equal(result.columns.MOBILIZED.length, Number(overlaps));
    assert.equal(result.columns.AVAILABLE.length, Number(!overlaps));
    const allocate = () => allocateCollaboratorInTransaction(database(currentMission, [], [other]), currentMission, {
      collaboratorId: person.id, jobRoleId: role.id
    });
    if (overlaps) await assert.rejects(allocate, error => error.conflicts?.some(conflict => conflict.code === 'MISSION_OVERLAP'));
    else await assert.doesNotReject(allocate);
  }
});

test('missão nova, missão sem ciclos e ciclo aberto continuam bloqueando férias no período ocupado', async () => {
  const absences = [absence()];
  for (const currentMission of [null, mission({ cycles: [] }), mission({ cycles: [{ id: 'open', mobilizationDate: '2026-10-01', demobilizationDate: null }] })]) {
    assert.equal(availability(currentMission, absences).columns.ON_VACATION.length, 1);
    if (currentMission) await assert.rejects(allocateCollaboratorInTransaction(database(currentMission, absences), currentMission, {
      collaboratorId: person.id, jobRoleId: role.id
    }), error => error.conflicts?.some(conflict => conflict.code === 'ABSENCE_FERIAS'));
  }
});

test('colaborador de férias durante parte da missão pode entrar antes ou depois, inclusive na equipe inicial', async () => {
  const absences = [absence()];
  for (const [mobilizationDate, demobilizationDate] of [['2026-10-01', '2026-10-09'], ['2026-10-21', '2026-10-31']]) {
    const currentMission = mission({ cycles: [] });
    const allocationPeriods = [{ collaboratorId: person.id, mobilizationDate, demobilizationDate }];
    for (const selectedMission of [null, currentMission]) {
      const result = availability(selectedMission, absences, [], { allocationPeriods });
      assert.equal(result.columns.AVAILABLE.length, 1);
      assert.equal(result.columns.ON_VACATION.length, 0);
      await assert.doesNotReject(resolveSelectedMissionTeam(database(currentMission, absences), {
        scheduleStatus: 'CONFIRMED', collaboratorIds: [person.id],
        mobilizationDate: currentMission.mobilizationDate, executionEndDate: currentMission.executionEndDate,
        allocationPeriods
      }, currentMission.planId, selectedMission?.id, { mission: selectedMission }));
    }
  }
});

test('datas individuais e desmobilização após a execução delimitam o bloqueio na edição', () => {
  const currentMission = mission({ cycles: [], executionEndDate: '2026-10-25', returnDate: '2026-10-31' });
  assert.equal(availability(currentMission, [absence('2026-10-30', '2026-10-31')]).columns.ON_VACATION.length, 1);
  assert.equal(availability(currentMission, [absence()], [], {
    allocationPeriods: [{ collaboratorId: person.id, mobilizationDate: '2026-10-21', demobilizationDate: '2026-10-25' }]
  }).columns.AVAILABLE.length, 1);
});

test('ciclo padrão define o início real e os ciclos registrados delimitam o fim de um ciclo aberto', async () => {
  const cases = [
    {
      currentMission: mission({ mobilizationDate: '2026-10-02' }),
      startDate: '2026-10-01', endDate: '2026-10-05', vacation: absence('2026-10-01', '2026-10-01')
    },
    {
      currentMission: mission({ executionEndDate: '2026-10-25', cycles: [
        { id: 'default', isDefault: true, mobilizationDate: '2026-10-01', demobilizationDate: '2026-10-09' },
        { id: 'open', mobilizationDate: '2026-10-21', demobilizationDate: null },
        { id: 'last', mobilizationDate: '2026-10-30', demobilizationDate: '2026-10-31' }
      ] }),
      startDate: '2026-10-01', endDate: '2026-10-31', vacation: absence('2026-10-28', '2026-10-28')
    }
  ];
  for (const { currentMission, startDate, endDate, vacation } of cases) {
    assert.equal(availability(currentMission, [vacation], [], { startDate, endDate, singleSelection: true }).columns.ON_VACATION.length, 1);
    await assert.rejects(allocateCollaboratorInTransaction(database(currentMission, [vacation]), currentMission, {
      collaboratorId: person.id, jobRoleId: role.id, mobilizationDate: startDate, demobilizationDate: endDate
    }), error => error.conflicts?.some(conflict => conflict.code === 'ABSENCE_FERIAS'));
  }
});
