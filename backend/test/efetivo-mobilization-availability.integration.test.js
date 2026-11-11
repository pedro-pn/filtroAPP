import assert from 'node:assert/strict';
import test from 'node:test';

import { getPlanningAvailabilityPeriod } from '../src/lib/efetivo/planning/availability-period.js';
import { listMissions } from '../src/lib/efetivo/planning/mission-planning.js';
import { missionAwaitsMobilization } from '../../shared/modules/mission-mobilization.js';
import { apiSimulationDatabase } from './helpers/api-simulation-db.js';

test('preparação reserva a equipe sem mobilizar nem prolongar a previsão', { timeout: 120_000 }, async t => {
  const database = await apiSimulationDatabase();
  t.after(() => database.close());
  const client = database.client;
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-11T12:00:00Z') });
  const date = value => new Date(`${value}T00:00:00Z`);
  const planner = await client.user.create({ data: { username: 'planner', name: 'Planejador', passwordHash: 'test', role: 'MANAGER' } });
  const role = await client.jobRole.create({ data: { name: 'Operador', normalizedKey: 'operador' } });
  const people = await Promise.all(['Pessoa A', 'Pessoa B', 'Pessoa C'].map(name => client.collaborator.create({ data: {
    code: name, name, jobRoleId: role.id
  } })));
  const project = await client.project.create({ data: {
    code: 'TEST-001', name: 'Projeto de teste', clientName: 'Cliente de teste', clientCnpj: '', contractCode: '', location: '',
    workflow: { create: { stage: 'PREPARATION', leaderUserId: planner.id, plannedMobilizationDate: date('2026-11-09') } }
  } });
  const plan = await client.efetivoPlan.create({ data: { kind: 'OFFICIAL', status: 'ACTIVE', name: 'Oficial' } });
  const mission = await client.efetivoMissionPlan.create({ data: {
    planId: plan.id, projectId: project.id, scheduleStatus: 'CONFIRMED', stage: 'MOBILIZATION',
    headquartersResponsibleUserId: planner.id, headquartersResponsibleName: planner.name, headquartersResponsibleRole: 'Planejador',
    mobilizationDate: date('2026-11-09'), executionStartDate: date('2026-11-09'), executionEndDate: date('2026-11-30'),
    cycles: { create: { isDefault: true, mobilizationDate: date('2026-11-09') } },
    demands: { create: { jobRoleId: role.id, requiredCount: 3 } },
    allocations: { create: people.map(person => ({ collaboratorId: person.id, jobRoleId: role.id, jobRoleNameSnapshot: role.name })) }
  } });
  const availability = (startDate, endDate = startDate) => getPlanningAvailabilityPeriod({ startDate, endDate }, { database: client });

  await t.test('preparação prevalece sobre a etapa antiga da missão, mesmo depois de 09/11', async () => {
    const listed = await listMissions({}, { database: client });
    assert.equal(missionAwaitsMobilization(listed[0]), true);
    const result = await availability('2026-11-09', '2026-12-02');
    assert.equal(result.people.length, 3);
    for (const person of result.people) {
      assert.ok(person.days.filter(day => day.date <= '2026-11-30').every(day => day.status === 'AWAITING_MOBILIZATION'));
      assert.ok(person.days.filter(day => day.date > '2026-11-30').every(day => day.status === 'AVAILABLE' && day.detail === null));
    }
    assert.deepEqual(result.roles[0].daily.at(-1), { date: '2026-12-02', demand: 0, allocated: 0, free: 3, deficit: 0, shortage: 0 });
    // A consulta continua limitada ao previsto mesmo quando todo o período vem depois de 30/11.
    assert.ok((await availability('2026-12-01')).people.every(person => person.days[0].status === 'AVAILABLE'));
    assert.equal((await client.efetivoMissionPlan.findUnique({ where: { id: mission.id } })).stage, 'MOBILIZATION');
  });

  await t.test('entrar em Mobilização ainda exige confirmar a data efetiva', async () => {
    await client.projectWorkflow.update({ where: { projectId: project.id }, data: { stage: 'MOBILIZATION' } });
    assert.ok((await availability('2026-11-11')).people.every(person => person.days[0].status === 'AWAITING_MOBILIZATION'));
    await client.projectWorkflow.update({ where: { projectId: project.id }, data: { actualMobilizationDate: date('2026-11-09') } });
    assert.ok((await availability('2026-11-11')).people.every(person => person.days[0].status === 'MOBILIZED'));
  });

  await t.test('confirmação não estende a projeção futura além de 30/11', async () => {
    const result = await availability('2026-11-30', '2026-12-01');
    assert.ok(result.people.every(person => person.days[0].status === 'MOBILIZED' && person.days[1].status === 'AVAILABLE'));
  });

  await t.test('presença real após a previsão permanece até a saída efetiva, sem ocupação futura indefinida', async () => {
    t.mock.timers.setTime(new Date('2026-12-01T12:00:00Z').getTime());
    const result = await availability('2026-12-01', '2026-12-02');
    assert.ok(result.people.every(person => person.days[0].status === 'MOBILIZED' && person.days[1].status === 'AVAILABLE'));
  });
});

test('status de espera preserva cenários e mobilizações legadas já em execução', () => {
  const mission = { stage: 'MOBILIZATION', project: { workflow: { stage: 'PREPARATION', actualMobilizationDate: null } } };
  assert.equal(missionAwaitsMobilization(mission), true);
  assert.equal(missionAwaitsMobilization({ ...mission, plan: { kind: 'SCENARIO' } }), false);
  assert.equal(missionAwaitsMobilization({ ...mission, project: { workflow: { stage: 'EXECUTION', actualMobilizationDate: null } } }), false);
  assert.equal(missionAwaitsMobilization({ stage: 'EXECUTION' }), false);
});
