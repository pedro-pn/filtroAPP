import assert from 'node:assert/strict';
import test from 'node:test';

import { missionMovePendencies, normalizeMissionDemands, resolveMissionResponsible, syncMissionDemobilization, validateMissionChronology } from '../src/lib/efetivo/planning/mission-planning.js';
import { missionInputSchema } from '../src/lib/efetivo/planning/schemas.js';

test('cronologia aceita limites iguais e rejeita inversão', () => {
  assert.doesNotThrow(() => validateMissionChronology({ mobilizationDate: '2026-01-01', executionStartDate: '2026-01-01', executionEndDate: '2026-01-01', returnDate: '2026-01-01' }));
  assert.throws(() => validateMissionChronology({ mobilizationDate: '2026-01-02', executionStartDate: '2026-01-01', executionEndDate: '2026-01-03', returnDate: '2026-01-04' }), /mobilização/i);
});

test('desmobilização é opcional e só é validada quando informada', () => {
  const dates = { mobilizationDate: '2026-01-01', executionStartDate: '2026-01-02', executionEndDate: '2026-01-10' };
  assert.doesNotThrow(() => validateMissionChronology({ ...dates, returnDate: null }));
  assert.throws(() => validateMissionChronology({ ...dates, returnDate: '2026-01-09' }), /desmobilização/i);
  assert.equal(missionInputSchema.parse({
    ...dates, projectId: 'p1', scheduleStatus: 'CANCELLED', headquartersResponsibleUserId: 'u1', collaboratorIds: []
  }).returnDate, undefined);
});

test('desmobilização da missão atualiza o campo canônico do projeto', async () => {
  let update;
  await syncMissionDemobilization({ project: { update: async input => { update = input; } } }, {
    id: 'p1', mobilizationDate: new Date('2026-01-01T00:00:00.000Z')
  }, '2026-01-15');
  assert.equal(update.where.id, 'p1');
  assert.equal(update.data.demobilizationDate.toISOString(), '2026-01-15T00:00:00.000Z');
});

test('demanda remove zeros, recusa duplicidade e confirmação vazia', () => {
  assert.deepEqual(normalizeMissionDemands([{ jobRoleId: 'r1', requiredCount: 0 }, { jobRoleId: 'r2', requiredCount: 2 }]), [{ jobRoleId: 'r2', requiredCount: 2 }]);
  assert.throws(() => normalizeMissionDemands([{ jobRoleId: 'r1', requiredCount: 1 }, { jobRoleId: 'r1', requiredCount: 2 }]), /única vez/i);
  assert.throws(() => normalizeMissionDemands([], 'CONFIRMED'), /demanda positiva/i);
});

test('input aceita somente o vínculo do líder e não recebe etapa, nome ou cargo manuais', () => {
  const parsed = missionInputSchema.parse({
    projectId: 'p1', scheduleStatus: 'CANCELLED', headquartersResponsibleUserId: 'u1',
    mobilizationDate: '2026-09-01', executionStartDate: '2026-09-02', executionEndDate: '2026-09-03', returnDate: '2026-09-04',
    collaboratorIds: [], stage: 'EXECUTION', headquartersResponsibleName: 'Manual', headquartersResponsibleRole: 'Manual'
  });
  assert.equal(parsed.headquartersResponsibleUserId, 'u1');
  assert.equal('stage' in parsed, false);
  assert.equal('headquartersResponsibleName' in parsed, false);
  assert.equal('headquartersResponsibleRole' in parsed, false);
});

test('input não oferece mais situação de rascunho e valida períodos individuais', () => {
  const base = {
    projectId: 'p1', headquartersResponsibleUserId: 'u1', scheduleStatus: 'CONFIRMED',
    mobilizationDate: '2026-09-01', executionStartDate: '2026-09-02', executionEndDate: '2026-09-29', returnDate: '2026-09-30',
    collaboratorIds: ['c1']
  };
  assert.equal(missionInputSchema.safeParse({ ...base, scheduleStatus: 'DRAFT' }).success, false);
  assert.equal(missionInputSchema.safeParse({
    ...base,
    allocationPeriods: [{ collaboratorId: 'c1', mobilizationDate: '2026-09-05', demobilizationDate: '2026-09-20' }]
  }).success, true);
  assert.equal(missionInputSchema.safeParse({
    ...base,
    allocationPeriods: [{ collaboratorId: 'c1', mobilizationDate: '2026-08-31', demobilizationDate: '2026-09-20' }]
  }).success, false);
});

test('líder usa nome e cargo canônicos do colaborador vinculado à conta', async () => {
  const responsible = await resolveMissionResponsible({
    user: { findFirst: async () => ({ id: 'u1', name: 'Conta Coordenação', collaborator: { id: 'c1', name: 'Ana Líder', isActive: true, jobRole: { name: 'Líder de Operações' } } }) }
  }, {
    headquartersResponsibleUserId: 'u1'
  });
  assert.deepEqual(responsible, { name: 'Ana Líder', role: 'Líder de Operações', collaboratorId: 'c1', userId: 'u1' });
});

test('conta sem colaborador e cargo vinculados não pode ser usada como líder', async () => {
  await assert.rejects(resolveMissionResponsible({
    user: { findFirst: async () => ({ id: 'u1', name: 'Coordenação', collaborator: null }) }
  }, {
    headquartersResponsibleUserId: 'u1'
  }), error => error.code === 'INVALID_MISSION_LEADER');
});

test('missão só pode mover quando líder, datas, equipe e confirmação estão completos', () => {
  const complete = {
    headquartersResponsibleUserId: 'u1', headquartersResponsibleName: 'Ana', headquartersResponsibleRole: 'Líder',
    mobilizationDate: new Date(), executionStartDate: new Date(), executionEndDate: new Date(), returnDate: null,
    scheduleStatus: 'CONFIRMED', demands: [{ requiredCount: 2 }], allocations: [{ id: 'a1' }, { id: 'a2' }]
  };
  assert.deepEqual(missionMovePendencies(complete), []);
  assert.deepEqual(missionMovePendencies({ ...complete, scheduleStatus: 'DRAFT', allocations: [] }), ['completar a equipe', 'confirmar a programação']);
});
