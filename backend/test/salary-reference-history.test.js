import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { apiSimulationDatabase } from './helpers/api-simulation-db.js';
import { receiveConectaEvent } from '../src/lib/conecta-rh/service.js';
import { getJobRoleSalary } from '../src/lib/api-credentials/job-role-salary.js';
import { getJobRoleHourlyReference } from '../src/lib/api-credentials/job-role-hourly-reference.js';
import { salaryReferenceAt } from '../src/lib/acompanhamento/salary-reference.js';
import { buildRoleParamsResolver } from '../src/lib/acompanhamento/labor-cost.js';

test('correções de data e substituições não recuperam revisões antigas', () => {
  const row = (version, date, id, status = 'ACTIVE', supersedesId = null) => ({ version,
    effectiveDate: new Date(date), params: { salarioBase: status === 'ACTIVE' ? 2000 : null,
      salaryReference: { id, status, revision: version, supersedesId } } });
  const sets = [row(4, '2026-11-11', 'old'), row(5, '2026-10-01', 'old')];
  assert.equal(salaryReferenceAt(sets, '2026-11-18').set.version, 5);
  sets.push(row(6, '2026-10-01', 'replacement', 'ACTIVE', 'old'), row(7, '2026-11-11', 'old', 'CANCELLED'));
  assert.equal(salaryReferenceAt(sets, '2026-11-18').set.version, 6);
  sets.push(row(8, '2026-10-01', 'replacement', 'CANCELLED', 'old'));
  assert.equal(salaryReferenceAt(sets, '2026-11-18').salaryStatus, 'CANCELLED');
});

test('ajuste local de HH conserva a data do cancelamento e a identidade da revisão de origem', () => {
  const reference = { id: 'cancelled', revision: 2, status: 'CANCELLED' };
  const sets = [
    { version: 3, effectiveDate: new Date('1970-01-01'), params: { salarioBase: 3100 } },
    { version: 5, effectiveDate: new Date('2026-11-11'), params: { salarioBase: null, salaryReference: reference } },
    { version: 6, effectiveDate: new Date('2026-11-18'), params: { salarioBase: null, reajusteHhPct: 0.1, salaryReference: reference } }
  ];
  assert.equal(salaryReferenceAt(sets, '2026-11-12').salaryStatus, 'CANCELLED');
  assert.equal(salaryReferenceAt(sets, '2026-11-18').salaryStatus, 'CANCELLED');
  assert.equal(salaryReferenceAt(sets, '2026-11-10').set.version, 3);
});

test('cancelamento Conecta preserva histórico, impede legado e permite substituição ou publicação local', { timeout: 120_000 }, async t => {
  const database = await apiSimulationDatabase(); t.after(() => database.close());
  const db = database.client, companyId = randomUUID(), roleId = randomUUID(), salaryId = randomUUID();
  const event = (aggregateType, data, revision = 1) => ({ schemaVersion: '1.0', companyId,
    eventId: randomUUID(), aggregateType, eventType: aggregateType + '.upserted', aggregateId: data.id,
    revision, occurredAt: '2026-11-18T13:45:35Z', data });
  const receive = input => receiveConectaEvent(db, input, { companyId });
  await receive(event('job_role', { id: roleId, name: 'Assistente IV de teste', isActive: true, isOperational: true, cbo: null }));
  const role = await db.jobRole.findFirstOrThrow();
  const profile = await db.costProfile.create({ data: { key: 'role:' + role.id, label: role.name, jobRoleId: role.id } });
  await db.costParameterSet.create({ data: { costProfileId: profile.id, version: 3, effectiveDate: new Date('1970-01-01'),
    params: { salarioBase: 3100, reajusteHhPct: 0.1 } } });
  const salary = { id: salaryId, jobRoleId: roleId, amount: '3000.00', currency: 'BRL', basis: 'MONTHLY',
    status: 'ACTIVE', effectiveDate: '2026-11-11', supersedesId: null };
  await receive(event('job_role_salary', salary));
  const context = { scopes: new Set(['cargos.salarios.read']) }, params = { id: role.id }, query = { referenceDate: '2026-11-18' };
  assert.equal((await getJobRoleSalary(db, params, query, context)).version, 4);
  const cancel = event('job_role_salary', { ...salary, status: 'CANCELLED', cancellationReason: 'Tabela substituída', batchId: randomUUID() }, 2);
  await receive(cancel); await receive(cancel);
  const reference = await getJobRoleHourlyReference(db, params, query, context);
  assert.equal(reference.salaryStatus, 'CANCELLED'); assert.equal(reference.salary, null);
  assert.equal(reference.referenceRevision, 5); assert.equal(reference.hhAdjustmentPct, 0.1);
  await assert.rejects(getJobRoleSalary(db, params, query, context), { code: 'SALARY_REFERENCE_CANCELLED' });
  assert.equal(await db.costParameterSet.count(), 3);
  assert.equal((await db.costParameterSet.findFirstOrThrow({ where: { version: 4 } })).params.salarioBase, '3000.00');
  const resolver = buildRoleParamsResolver({ roles: [{ name: role.name, costProfile: { parameterSets: await db.costParameterSet.findMany() } }],
    models: [{ key: 'operador', parameterSets: [{ version: 1, effectiveDate: new Date('1970-01-01'), params: { salarioBase: 9999 } }] }] });
  assert.equal(resolver.paramsFor(role.name, query.referenceDate), null);
  const replacement = { ...salary, id: randomUUID(), amount: '2600.00', supersedesId: salary.id };
  await receive(event('job_role_salary', replacement));
  assert.equal((await getJobRoleSalary(db, params, query, context)).salary, '2600');
  assert.equal((await getJobRoleSalary(db, params, query, context)).version, 6);
  // Out-of-order redelivery of the cancelled occurrence cannot remove its replacement.
  await receive(event('job_role_salary', { ...salary, status: 'CANCELLED' }, 3));
  assert.equal((await getJobRoleSalary(db, params, query, context)).salary, '2600');
  await receive(event('job_role_salary', { ...replacement, status: 'CANCELLED' }, 2));
  assert.equal((await getJobRoleHourlyReference(db, params, query, context)).salaryStatus, 'CANCELLED');
  await db.costParameterSet.create({ data: { costProfileId: profile.id, version: 8, effectiveDate: new Date('2026-11-18'),
    params: { salarioBase: 2700 }, note: 'Publicação local autorizada' } });
  assert.equal((await getJobRoleSalary(db, params, query, context)).salary, '2700');
});

test('migration regulariza cancelamentos antigos sem reativar o salário excluído', { timeout: 120_000 }, async t => {
  const database = await apiSimulationDatabase(); t.after(() => database.close());
  const db = database.client, companyId = randomUUID(), roleId = randomUUID();
  const role = await db.jobRole.create({ data: { name: 'Cargo do cancelamento antigo', normalizedKey: 'cargo do cancelamento antigo' } });
  const profile = await db.costProfile.create({ data: { key: 'role:' + role.id, label: role.name, jobRoleId: role.id } });
  await db.costParameterSet.create({ data: { costProfileId: profile.id, version: 3, effectiveDate: new Date('1970-01-01'), params: { salarioBase: 3100 } } });
  await db.conectaRhAggregate.create({ data: { companyId, aggregateType: 'job_role', externalId: roleId,
    revision: 1, data: { name: role.name }, occurredAt: new Date(), status: 'APPLIED', localId: role.id } });
  const cancelled = await db.conectaRhAggregate.create({ data: { companyId, aggregateType: 'job_role_salary', externalId: randomUUID(),
    revision: 2, data: { jobRoleId: roleId, status: 'CANCELLED', effectiveDate: '2026-11-11', amount: '3000.00', supersedesId: null },
    occurredAt: new Date(), lastAttemptAt: new Date(), status: 'APPLIED' } });
  const approvedRoleId = randomUUID();
  const approvedRole = await db.jobRole.create({ data: { name: 'Cargo regularizado localmente', normalizedKey: 'cargo regularizado localmente' } });
  const approvedProfile = await db.costProfile.create({ data: { key: 'role:' + approvedRole.id, label: approvedRole.name, jobRoleId: approvedRole.id } });
  await db.conectaRhAggregate.create({ data: { companyId, aggregateType: 'job_role', externalId: approvedRoleId,
    revision: 1, data: { name: approvedRole.name }, occurredAt: new Date(), status: 'APPLIED', localId: approvedRole.id } });
  await db.conectaRhAggregate.create({ data: { companyId, aggregateType: 'job_role_salary', externalId: randomUUID(), revision: 2,
    data: { jobRoleId: approvedRoleId, status: 'CANCELLED', effectiveDate: '2026-11-11', amount: '3000.00', supersedesId: null },
    occurredAt: new Date('2026-11-18T13:45:35Z'), lastAttemptAt: new Date('2026-11-18T13:46:14Z'), status: 'APPLIED' } });
  await db.costParameterSet.create({ data: { costProfileId: approvedProfile.id, version: 7, effectiveDate: new Date('2026-11-18'),
    params: { salarioBase: 3500 }, createdAt: new Date('2026-11-18T14:00:00Z') } });
  await database.db.exec(await readFile(new URL('../prisma/migrations/20261118190000_salary_cancellation_history/migration.sql', import.meta.url), 'utf8'));
  const sets = await db.costParameterSet.findMany({ where: { costProfileId: profile.id } });
  const set = sets.sort((a, b) => b.version - a.version)[0];
  assert.ok(set.version > 4); assert.equal(set.params.salarioBase, null);
  assert.equal(salaryReferenceAt(sets, '2026-11-18').salaryStatus, 'CANCELLED');
  assert.equal((await db.conectaRhAggregate.findUniqueOrThrow({ where: { id: cancelled.id } })).localId, set.id);
  assert.equal(await db.costParameterSet.count({ where: { costProfileId: approvedProfile.id } }), 1, 'preserva publicação local posterior');
  await database.db.exec(await readFile(new URL('../prisma/migrations/20261118190000_salary_cancellation_history/migration.sql', import.meta.url), 'utf8'));
  assert.equal(await db.costParameterSet.count({ where: { costProfileId: profile.id } }), sets.length, 'regularização é idempotente');
});
