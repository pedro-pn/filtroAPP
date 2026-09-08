import assert from 'node:assert/strict';
import test from 'node:test';

import { getOfficialMissionContext, missionContextDto } from '../src/lib/efetivo/planning/official-mission-context.js';

const mission = {
  id: 'm1', projectId: 'p1', version: 2, plan: { revision: 8 },
  headquartersResponsibleUserId: 'u1', headquartersResponsibleName: 'Coordenação', headquartersResponsibleRole: 'Coordenador',
  mobilizationDate: '2026-08-01', executionStartDate: '2026-08-02', executionEndDate: '2026-08-10', returnDate: '2026-08-11',
  needsReplanning: false, replanningReason: null,
  allocations: [{ collaborator: { id: 'c1', name: 'Ana' }, jobRoleId: 'r1', jobRoleNameSnapshot: 'Técnica', jobRole: { isActive: false } }],
  demands: [{ jobRoleId: 'r1', requiredCount: 1, jobRole: { name: 'Técnica' } }]
};

test('DTO oficial é mínimo e preserva snapshot de cargo', () => {
  const context = missionContextDto(mission, 3);
  assert.equal(context.planRevision, 8);
  assert.equal(context.calendarRevision, 3);
  assert.deepEqual(context.collaborators[0].jobRole, { id: 'r1', name: 'Técnica', isActive: false });
  assert.equal('auditEvents' in context, false);
});

test('contexto diário inclui somente colaboradores dentro do período individual', () => {
  const datedMission = {
    ...mission,
    allocations: [
      { ...mission.allocations[0], mobilizationDate: '2026-08-05', demobilizationDate: '2026-08-08' },
      { ...mission.allocations[0], collaborator: { id: 'c2', name: 'Bia' }, mobilizationDate: null, demobilizationDate: null }
    ]
  };
  const before = missionContextDto(datedMission, 3, '2026-08-03');
  const during = missionContextDto(datedMission, 3, '2026-08-06');
  assert.deepEqual(before.collaborators.map(item => item.id), ['c2']);
  assert.deepEqual(during.collaborators.map(item => item.id), ['c1', 'c2']);
});

test('lookup usa apenas plano oficial confirmado e fronteiras inclusivas', async () => {
  let where;
  const database = {
    efetivoMissionPlan: { findFirst: async input => { where = input.where; return mission; } },
    workforceCalendarState: { findUnique: async () => ({ revision: 3 }) }
  };
  const result = await getOfficialMissionContext({ projectId: 'p1', date: '2026-08-01' }, { database });
  assert.equal(where.plan.kind, 'OFFICIAL');
  assert.equal(where.scheduleStatus, 'CONFIRMED');
  assert.equal(where.mobilizationDate.lte.toISOString().slice(0, 10), '2026-08-01');
  assert.equal(result.missionId, 'm1');
});

test('ausência de missão oficial retorna contexto nulo', async () => {
  const database = {
    efetivoMissionPlan: { findFirst: async () => null },
    workforceCalendarState: { findUnique: async () => null }
  };
  assert.equal(await getOfficialMissionContext({ projectId: 'p1', date: '2026-08-01' }, { database }), null);
});
