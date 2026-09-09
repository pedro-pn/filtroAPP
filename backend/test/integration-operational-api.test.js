import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { API_SCOPES, API_OPERATIONS, futureScopeDefinitions, publicApiOperations } from '../src/lib/api-credentials/catalog.js';
import { OPERATIONAL_RESOURCES, BASE_OPERATIONAL_RESOURCES } from '../src/lib/api-credentials/operational-resources.js';
import { serializeOperationalResource } from '../src/lib/api-credentials/operational-serialization.js';
import { listOperationalResources } from '../src/lib/api-credentials/operational-service.js';
import { createOperationalRouter } from '../src/routes/integrations/v1/operational.js';
import { executePlaygroundOperation } from '../src/lib/api-credentials/playground.js';

const key = 'synthetic-operational-cursor-key-at-least-32-chars';
const stamp = new Date('2026-09-07T10:00:00.000Z');
const context = (overrides = {}) => ({ scopes: new Set(API_SCOPES.map(item => item.code)), projectAccessMode: 'SELECTED', projectIds: new Set(['p1']), maxPageSize: 100, cursorKey: key, snapshotAt: new Date('2026-09-08T10:00:00Z'), ...overrides });
const definition = model => OPERATIONAL_RESOURCES.find(item => item.model === model);
const approved = projectId => ({ projectId, status: 'APPROVED', deletedAt: null, project: { deletedAt: null } });
const sample = (resource, extra = {}) => ({ ...Object.fromEntries(Object.entries(resource.fields).map(([field, type]) => [field,
  type.endsWith('?') ? null : type === 'datetime' ? stamp : type === 'boolean' ? true : type === 'integer' ? 1 : type === 'decimal' ? new Prisma.Decimal('12.345') : `example-${field}`
])), ...extra });

function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return value.every(item => matches(row, item));
    if (key === 'OR') return value.some(item => matches(row, item));
    const actual = row?.[key];
    if (value === null || typeof value !== 'object' || value instanceof Date) return actual instanceof Date ? actual.getTime() === new Date(value).getTime() : actual === value;
    if ('some' in value) return (actual || []).some(item => matches(item, value.some));
    if ('in' in value) return value.in.includes(actual);
    if (['gt', 'gte', 'lt', 'lte'].some(op => op in value)) return Object.entries(value).every(([op, target]) => ({ gt: actual > target, gte: actual >= target, lt: actual < target, lte: actual <= target })[op]);
    return actual != null && matches(actual, value);
  });
}

function database(resource, rows) {
  const calls = [];
  return { calls, [resource.delegate]: { async findMany(args) {
    calls.push(args);
    return rows.filter(row => matches(row, args.where)).sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id)).slice(0, args.take);
  } } };
}

test('stored fields and explicit relation selects match Prisma; derived fields are recomputed by their projection', async () => {
  const source = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  for (const resource of OPERATIONAL_RESOURCES) {
    const model = Prisma.dmmf.datamodel.models.find(item => item.name === resource.model);
    const block = source.match(new RegExp(`model ${resource.model} \\{([\\s\\S]*?)\\n\\}`))[1];
    function checkSelect(modelName, select) {
      const selectedModel = Prisma.dmmf.datamodel.models.find(item => item.name === modelName);
      for (const [name, selection] of Object.entries(select)) {
        const selectedField = selectedModel.fields.find(item => item.name === name);
        assert.ok(selectedField, `${modelName}.${name} select`);
        if (selectedField.kind === 'object') {
          assert.ok(selection.select, `${modelName}.${name} must select relation fields explicitly`);
          checkSelect(selectedField.type, selection.select);
        } else assert.equal(selection, true);
      }
    }
    checkSelect(resource.model, resource.select);
    for (const [name, type] of Object.entries(resource.fields)) {
      if (Object.hasOwn(resource.derivedFields || {}, name)) {
        assert.notEqual(serializeOperationalResource(resource, { [name]: 'UNPROJECTED' })[name], 'UNPROJECTED', `${resource.model}.${name} must be projected`);
        if (type === 'object') assert.equal(resource.fieldSchemas[name].additionalProperties, false);
        continue;
      }
      const field = model.fields.find(item => item.name === name);
      assert.ok(field, `${resource.model}.${name}`);
      const sourceType = block.match(new RegExp(`\\n\\s+${name}\\s+(\\S+)`))?.[1];
      assert.ok(sourceType);
      assert.notEqual(field.kind, 'object');
      assert.notEqual(field.type, 'Json');
      assert.equal(sourceType.endsWith('[]'), false);
      assert.equal(sourceType.endsWith('?'), type.endsWith('?'), `${resource.model}.${name} nullable`);
      assert.equal(({ String: 'string', DateTime: 'datetime', Int: 'integer', Boolean: 'boolean', Decimal: 'decimal' })[field.type] || (field.kind === 'enum' ? 'string' : 'unknown'), type.replace('?', ''));
    }
  }
});

test('every operational collection is grantable, routable, selectable in playground and absent from future candidates', () => {
  const router = createOperationalRouter();
  assert.equal(router.stack.length, OPERATIONAL_RESOURCES.length + 3);
  for (const resource of OPERATIONAL_RESOURCES) {
    assert.ok(API_SCOPES.some(scope => scope.code === resource.scope && scope.status === 'AVAILABLE'));
    assert.ok(API_OPERATIONS.some(operation => operation.operationId === resource.operationId && operation.path === resource.path));
    assert.ok(publicApiOperations().some(operation => operation.operationId === resource.operationId));
    assert.ok(!futureScopeDefinitions().some(scope => scope.code === resource.scope));
    const route = router.stack.find(layer => layer.route?.path === resource.path).route;
    assert.deepEqual(Object.keys(route.methods), ['get']);
    assert.equal(route.stack.length, 2);
    let allowed = false;
    route.stack[0].handle({ apiAuth: { scopeCodes: new Set(resource.requiredScopes) }, query: {} }, {}, () => { allowed = true; });
    assert.equal(allowed, true);
    const res = { status(code) { this.statusCode = code; return this; }, setHeader() {}, json(body) { this.body = body; } };
    route.stack[0].handle({ apiAuth: { scopeCodes: new Set(['qualidade.registros.read']) }, query: {} }, res, () => assert.fail('missing scope allowed'));
    assert.equal(res.statusCode, 403);
  }
});

for (const resource of BASE_OPERATIONAL_RESOURCES) {
  test(`${resource.model}: successful allowlisted read, missing scope and invalid queries before data access`, async () => {
    const row = sample(resource, { id: 'a', ...resource.where, ...approved('p1'), report: approved('p1'), reportLinks: [{ report: approved('p1') }],
      cpf: 'NEVER_EXPOSE', email: 'NEVER_EXPOSE', publicToken: 'NEVER_EXPOSE', storagePath: 'NEVER_EXPOSE', rawRow: { forbidden: 'NEVER_EXPOSE' }, futureColumn: 'NEVER_EXPOSE' });
    if (resource.projectPolicy === 'SELF') row.id = 'p1';
    const db = database(resource, [row]);
    const result = await listOperationalResources(db, resource.operationId, {}, context());
    assert.equal(result.items.length, 1);
    assert.deepEqual(Object.keys(result.items[0]).sort(), Object.keys(resource.fields).sort());
    assert.doesNotMatch(JSON.stringify(result), /NEVER_EXPOSE/);
    assert.deepEqual(db.calls[0].select, resource.select);
    assert.equal(db.calls[0].take, 101);
    await assert.rejects(() => listOperationalResources({}, resource.operationId, {}, context({ scopes: new Set() })), error => error.code === 'INSUFFICIENT_SCOPE');
    for (const query of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { limit: 'invalid' }, { fields: '*' }, { includeDeleted: true }, { model: 'User' }, { updatedSince: 'invalid' }]) {
      await assert.rejects(() => listOperationalResources({}, resource.operationId, query, context()));
    }
    await assert.rejects(() => listOperationalResources({}, resource.operationId, { projectId: 'p2' }, context()));
    await assert.rejects(() => listOperationalResources({}, resource.operationId, {}, context({ projectIds: new Set() })), error => error.code === 'PROJECT_NOT_ALLOWED');
  });
}

test('project isolation covers self, direct, report and collaborator links; rejects unpublished and deleted parents', async () => {
  for (const model of ['Project', 'Report', 'MaintenanceRecord', 'ChemicalCleaning', 'Collaborator']) {
    const resource = definition(model);
    const rows = ['p1', 'p2'].map(projectId => sample(resource, { id: projectId, ...approved(projectId), report: approved(projectId), reportLinks: [{ report: approved(projectId) }] }));
    const db = database(resource, rows);
    const result = await listOperationalResources(db, resource.operationId, {}, context());
    assert.deepEqual(result.items.map(row => row.id), ['p1'], model);
  }
  const report = definition('Report');
  const db = database(report, [sample(report, { id: 'a', ...approved('p1') }), sample(report, { id: 'b', ...approved('p1'), status: 'PENDING' }), sample(report, { id: 'c', ...approved('p1'), deletedAt: stamp }), sample(report, { id: 'd', ...approved('p1'), project: { deletedAt: stamp } })]);
  assert.deepEqual((await listOperationalResources(db, report.operationId, {}, context())).items.map(row => row.id), ['a']);
  const maintenance = definition('MaintenanceRecord');
  const standalone = database(maintenance, [sample(maintenance, { id: 'a', status: 'APPROVED', reportId: null, report: null })]);
  assert.equal((await listOperationalResources(standalone, maintenance.operationId, {}, context())).items.length, 0);
  assert.equal((await listOperationalResources(standalone, maintenance.operationId, {}, context({ projectAccessMode: 'ALL' }))).items.length, 1);
});

test('stable pagination handles tied timestamps, fixes snapshot and binds cursor to operation, filters and project policy', async () => {
  const resource = definition('JobRole');
  const db = database(resource, ['c', 'a', 'b'].map(id => sample(resource, { id })));
  const first = await listOperationalResources(db, resource.operationId, { limit: 2, active: true }, context());
  assert.deepEqual(first.items.map(row => row.id), ['a', 'b']);
  const next = await listOperationalResources(db, resource.operationId, { limit: 2, active: true, cursor: first.page.nextCursor }, context({ snapshotAt: new Date('2026-09-09Z') }));
  assert.deepEqual(next.items.map(row => row.id), ['c']);
  assert.equal(first.page.snapshotAt, next.page.snapshotAt);
  assert.equal(next.page.hasMore, false);
  const manyProjects = context({ projectIds: new Set(Array.from({ length: 500 }, (_, index) => `project-${index.toString().padStart(90, '0')}`)) });
  const largePolicyPage = await listOperationalResources(db, resource.operationId, { limit: 2 }, manyProjects);
  assert.ok(largePolicyPage.page.nextCursor.length < 4096);
  assert.equal((await listOperationalResources(db, resource.operationId, { limit: 2, cursor: largePolicyPage.page.nextCursor }, manyProjects)).items.length, 1);
  for (const [operationId, query, ctx] of [
    [resource.operationId, { cursor: `${first.page.nextCursor}broken`, active: true }, context()],
    [resource.operationId, { cursor: first.page.nextCursor, active: false }, context()],
    [resource.operationId, { cursor: first.page.nextCursor, active: true }, context({ projectIds: new Set(['p2']) })],
    [definition('ClientSegment').operationId, { cursor: first.page.nextCursor, active: true }, context()],
    [resource.operationId, { cursor: first.page.nextCursor, active: true, snapshotAt: '2026-09-06T00:00:00Z' }, context()]
  ]) await assert.rejects(() => listOperationalResources({}, operationId, query, ctx), error => error.code === 'INVALID_CURSOR');
  for (const query of [{ snapshotAt: '2030-01-01T00:00:00Z' }, { snapshotAt: '2026-09-06T00:00:00Z', updatedSince: '2026-09-07T00:00:00Z' }]) {
    await assert.rejects(() => listOperationalResources({}, resource.operationId, query, context()), error => error.code === 'INVALID_SNAPSHOT');
  }
  assert.equal((await listOperationalResources(db, resource.operationId, {}, context({ maxPageSize: 1 }))).page.limit, 1);
  assert.equal(serializeOperationalResource(definition('ChemicalCleaning'), sample(definition('ChemicalCleaning'))).quantityKg, '12.345');
});

function meteredDatabase(resource) {
  const db = database(resource, [sample(resource)]);
  const events = [], logs = [], updates = [];
  db.apiUsageBucket = {
    async upsert({ create }) { return { id: create.windowKind }; },
    async updateMany(args) { updates.push(args); return { count: 1 }; },
    async update(args) { updates.push(args); return args; }
  };
  db.$transaction = async action => typeof action === 'function' ? action(db) : Promise.all(action);
  db.apiCredentialEvent = { async create({ data }) { events.push(data); } };
  db.apiRequestLog = { async create({ data }) { logs.push(data); } };
  db.apiCredential = { async findUnique() { return { id: 'synthetic-credential', projectAccessMode: 'ALL', maxPageSize: 3, requestsPerMinute: 10, requestsPerDay: 100, rowsPerDay: 1000, secretLastFour: 'demo', scopes: [{ scopeCode: resource.scope }], projects: [] }; }, async updateMany() { return { count: 1 }; } };
  return { db, events, logs, updates };
}

test('playground dispatches operational service, bounds page by credential and settles quota with TESTED audit', async () => {
  const resource = definition('JobRole');
  const { db, events, updates } = meteredDatabase(resource);
  const result = await executePlaygroundOperation(db, 'synthetic-credential', { operationId: resource.operationId, query: {}, pathParams: {} }, { cursorKey: key });
  assert.equal(result.response.body.items.length, 1);
  assert.equal(result.response.body.page.limit, 3);
  assert.ok(result.request.path.startsWith('/api/integracoes/v1/cargos'));
  assert.match(result.request.curl, /\$FILTRO_API_TOKEN/);
  assert.ok(events.some(event => event.type === 'TESTED'));
  assert.ok(updates.some(update => update.data.rows?.increment === 3));
  assert.ok(updates.some(update => update.data.rows?.decrement === 2));
});

test('real operational route meters and audits output without exposing private fields', async () => {
  const resource = definition('JobRole');
  const { db, logs, updates } = meteredDatabase(resource);
  const router = createOperationalRouter({ prismaClient: db, envConfig: { apiTokenGlobalMaxPageSize: 500, apiTokenHashKeys: { 1: key }, apiTokenActiveKeyVersion: 1 } });
  const credential = await db.apiCredential.findUnique();
  const req = { query: { limit: '2' }, requestId: 'synthetic-request', headers: {}, apiAuth: { credential, scopeCodes: new Set([resource.scope]), projectIds: new Set() } };
  const result = await new Promise((resolve, reject) => {
    const route = router.stack.find(layer => layer.route?.path === resource.path).route;
    route.stack[0].handle(req, {}, () => route.stack[1].handle(req, { json: resolve }, reject));
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.requestId, req.requestId);
  assert.ok(logs.some(log => log.operationId === resource.operationId && log.responseRows === 1));
  assert.ok(updates.some(update => update.data.rows?.increment === 2));
});
