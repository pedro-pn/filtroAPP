import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import express from 'express';
import YAML from 'yaml';

import { API_SCOPES, getApiOperation, publicApiOperations } from '../src/lib/api-credentials/catalog.js';
import { getJobRoleSalary } from '../src/lib/api-credentials/job-role-salary.js';
import { executePlaygroundOperation, validatePlaygroundRequest } from '../src/lib/api-credentials/playground.js';
import { apiRequestContext, integrationApiErrorHandler } from '../src/middleware/api-request-context.js';
import { createOperationalRouter } from '../src/routes/integrations/v1/operational.js';
import { makePlaygroundParameterSchema } from '../../shared/schemas/playground-parameters.js';
import { z } from 'zod';

const operationId = 'jobRoles.salary.get';
const scope = 'cargos.salarios.read';
const context = { scopes: new Set([scope]), projectAccessMode: 'SELECTED', projectIds: new Set() };
const params = { id: 'role-1' };
const query = { referenceDate: '2026-10-15' };
const parameterSet = (effectiveDate, version, salary) => ({
  effectiveDate: new Date(`${effectiveDate}T00:00:00Z`), version,
  params: { salarioBase: salary, baseModel: 'NEVER_EXPOSE', beneficios: { secret: 'NEVER_EXPOSE' } },
  note: 'NEVER_EXPOSE', createdByUserId: 'NEVER_EXPOSE'
});
const history = () => [
  parameterSet('2026-01-01', 1, 3000),
  parameterSet('2027-01-01', 3, 5000),
  parameterSet('2026-07-01', 2, '4086.57'),
  parameterSet('2026-01-01', 4, 3100)
];

function database(sets = history(), { hasRole = true, hasProfile = true } = {}) {
  const calls = [], logs = [], events = [], updates = [];
  const credential = {
    id: 'synthetic-credential', projectAccessMode: 'SELECTED', maxPageSize: 10,
    requestsPerMinute: 60, requestsPerDay: 1000, rowsPerDay: 10000,
    secretLastFour: 'demo', scopes: [{ scopeCode: scope }], projects: [{ projectId: 'project-1', project: { code: '05776' } }]
  };
  const db = {
    jobRole: { async findUnique(args) {
      calls.push(args);
      if (!hasRole || args.where.id !== params.id) return null;
      const selection = args.select.costProfile.select.parameterSets;
      const selected = sets.filter(set => set.effectiveDate <= selection.where.effectiveDate.lte)
        .sort((a, b) => {
          for (const order of selection.orderBy) {
            const [field, direction] = Object.entries(order)[0];
            const difference = Number(a[field]) - Number(b[field]);
            if (difference) return direction === 'desc' ? -difference : difference;
          }
          return 0;
        }).slice(0, selection.take);
      return { id: params.id, name: 'Operador', collaborators: ['NEVER_EXPOSE'],
        costProfile: hasProfile ? { parameterSets: selected } : null };
    } },
    apiCredential: { async findUnique() { return credential; }, async updateMany() { return { count: 1 }; } },
    apiUsageBucket: {
      async upsert({ create }) { return { id: create.windowKind }; },
      async updateMany(args) { updates.push(args); return { count: db.quotaExceeded ? 0 : 1 }; },
      async update(args) { updates.push(args); return args; }
    },
    apiRequestLog: { async create({ data }) { logs.push(data); } },
    apiCredentialEvent: { async create({ data }) { events.push(data); } },
    async $transaction(action) { return typeof action === 'function' ? action(db) : Promise.all(action); }
  };
  return { db, calls, credential, logs, events, updates };
}

test('salary lookup uses the effective date before version and never anticipates future raises', async () => {
  const { db, calls } = database();
  for (const [referenceDate, expectedSalary, expectedVersion] of [
    ['2026-06-30', '3100', 4],
    ['2026-07-01', '4086.57', 2],
    ['2026-10-15', '4086.57', 2],
    ['2026-12-31', '4086.57', 2],
    ['2027-01-01', '5000', 3]
  ]) {
    const result = await getJobRoleSalary(db, params, { referenceDate }, context);
    assert.equal(result.salary, expectedSalary);
    assert.equal(result.version, expectedVersion);
  }
  assert.deepEqual(calls[0], {
    where: { id: params.id },
    select: { id: true, name: true, costProfile: { select: { parameterSets: {
      where: { effectiveDate: { lte: new Date('2026-06-30T00:00:00Z') } },
      orderBy: [{ effectiveDate: 'desc' }, { version: 'desc' }], take: 1,
      select: { params: true, effectiveDate: true, version: true }
    } } } }
  });
});

test('same-day revisions choose the highest version and expose only the contracted salary projection', async () => {
  const { db } = database([...history(), parameterSet('2026-07-01', 5, '4123.45')]);
  assert.deepEqual(await getJobRoleSalary(db, params, query, context), {
    jobRoleId: params.id, jobRoleName: 'Operador', salary: '4123.45', effectiveDate: '2026-07-01', version: 5
  });
});

test('missing roles, missing profiles and dates before the first salary return 404', async () => {
  for (const [fixture, input, code] of [
    [database([], { hasRole: false }), query, 'NOT_FOUND'],
    [database([], { hasProfile: false }), query, 'SALARY_NOT_FOUND'],
    [database([]), query, 'SALARY_NOT_FOUND'],
    [database(), { referenceDate: '2025-12-31' }, 'SALARY_NOT_FOUND'],
    [database([parameterSet('2027-01-01', 1, 5000)]), query, 'SALARY_NOT_FOUND']
  ]) await assert.rejects(() => getJobRoleSalary(fixture.db, params, input, context), error => error.statusCode === 404 && error.code === code);
});

test('unconfigured or invalid salaries never fall back to an older or generic salary', async () => {
  for (const value of [undefined, null, '', ' ', true, [], {}, 'invalid', 'NaN', 'Infinity', -1]) {
    const { db } = database([...history(), parameterSet('2026-10-01', 5, value)]);
    await assert.rejects(() => getJobRoleSalary(db, params, query, context), error => error.code === 'SALARY_NOT_FOUND');
  }
  const { db } = database([parameterSet('2026-01-01', 1, 0)]);
  assert.equal((await getJobRoleSalary(db, params, query, context)).salary, '0');
});

test('scope, required real calendar date and strict cargo-only parameters are enforced before data access', async () => {
  for (const scopes of [new Set(), new Set(['cargos.read']), new Set(['colaboradores.operacional.read'])]) {
    await assert.rejects(() => getJobRoleSalary({}, params, query, { scopes }), error => error.code === 'INSUFFICIENT_SCOPE');
  }
  for (const input of [{}, { referenceDate: '' }, { referenceDate: '2026-02-30' },
    { referenceDate: '2026-10-15T00:00:00Z' }, { referenceDate: ['2026-10-15'] },
    { ...query, collaboratorId: 'person-1' }, { ...query, fields: '*' }, { ...query, projectId: 'project-1' }]) {
    await assert.rejects(() => getJobRoleSalary({}, params, input, context), error => error.name === 'ZodError');
    assert.throws(() => validatePlaygroundRequest({ operationId, pathParams: params, query: input }));
  }
  await assert.rejects(() => getJobRoleSalary({}, { id: ' ' }, query, context), error => error.name === 'ZodError');
});

test('API central catalog and playground expose the dedicated grant with a required date', async () => {
  const definition = API_SCOPES.find(item => item.code === scope);
  assert.equal(definition.status, 'AVAILABLE');
  assert.deepEqual(definition.exposedFields, ['jobRoleId', 'jobRoleName', 'salary', 'effectiveDate', 'version']);
  const operation = publicApiOperations().find(item => item.operationId === operationId);
  assert.deepEqual(operation.requiredScopes, [scope]);
  assert.deepEqual(operation.parameters.map(item => [item.name, item.required]), [['id', true], ['referenceDate', true]]);
  assert.match(operation.parameters[0].label, /cargo/i);
  const form = makePlaygroundParameterSchema(z, operation.parameters);
  assert.equal(form.safeParse({ id: params.id }).success, false);
  assert.equal(form.safeParse({ id: params.id, ...query }).success, true);

  const { db, events, updates } = database();
  const response = await executePlaygroundOperation(db, 'synthetic-credential', { operationId, pathParams: params, query });
  assert.equal(response.request.path, `/api/integracoes/v1/cargos/${params.id}/salario?referenceDate=2026-10-15`);
  assert.equal(response.response.body.salary, '4086.57');
  assert.doesNotMatch(JSON.stringify(response.response.body), /NEVER_EXPOSE/);
  assert.ok(events.some(event => event.type === 'TESTED' && event.summary.operationId === operationId));
  assert.ok(updates.some(update => update.data.rows?.increment === 1));
});

test('salary OpenAPI contract matches the scope, required query and exact response fields', async () => {
  const contract = YAML.parse(await readFile(new URL('../../specs/015-api-token-playground/contracts/openapi.yaml', import.meta.url), 'utf8'));
  const operation = contract.paths['/integracoes/v1/cargos/{id}/salario'].get;
  assert.equal(operation.operationId, getApiOperation(operationId).openApiOperationId);
  assert.deepEqual(operation['x-required-scopes'], [scope]);
  assert.deepEqual(operation.parameters.map(item => [item.name, item.required]), [['id', true], ['referenceDate', true]]);
  const schema = operation.responses['200'].content['application/json'].schema;
  const { db } = database();
  const response = await getJobRoleSalary(db, params, query, context);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(Object.keys(response).sort(), schema.required.slice().sort());
  assert.deepEqual(Object.keys(schema.properties).sort(), schema.required.slice().sort());
});

test('HTTP salary route enforces grants, validation and quotas, and records the contracted response', async t => {
  const { db, calls, credential, logs, updates } = database();
  const app = express();
  app.use(apiRequestContext());
  app.use((req, _res, next) => {
    req.apiAuth = { credential, scopeCodes: new Set([req.headers['x-test-scope'] || scope]), projectIds: new Set() };
    next();
  });
  app.use('/api/integracoes/v1', createOperationalRouter({ prismaClient: db }));
  app.use(integrationApiErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/integracoes/v1/cargos/${params.id}/salario`;
  const denied = await fetch(`${url}?referenceDate=2026-10-15`, { headers: { 'x-test-scope': 'cargos.read' } });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, 'INSUFFICIENT_SCOPE');
  for (const suffix of ['', '?referenceDate=2026-02-30', '?referenceDate=2026-10-15&collaboratorId=person-1']) {
    const invalid = await fetch(url + suffix);
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, 'VALIDATION_ERROR');
  }
  assert.equal(calls.length, 0);
  assert.equal(updates.length, 0);
  const response = await fetch(`${url}?referenceDate=2026-10-15`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(response.headers.get('x-request-id'));
  assert.deepEqual(await response.json(), {
    jobRoleId: params.id, jobRoleName: 'Operador', salary: '4086.57', effectiveDate: '2026-07-01', version: 2
  });
  assert.ok(logs.some(log => log.operationId === operationId && log.responseRows === 1 && log.scopeCode === scope));
  const missing = await fetch(`${url}?referenceDate=2025-01-01`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, 'SALARY_NOT_FOUND');
  assert.ok(updates.some(update => update.data.rows?.decrement === 1));
  db.quotaExceeded = true;
  const exceeded = await fetch(`${url}?referenceDate=2026-10-15`);
  assert.equal(exceeded.status, 429);
  assert.equal((await exceeded.json()).code, 'QUOTA_EXCEEDED');
  assert.equal(calls.length, 2);
});
