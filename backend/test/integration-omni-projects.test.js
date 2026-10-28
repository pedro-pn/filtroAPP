import assert from 'node:assert/strict';
import test from 'node:test';
import { API_SCOPES, publicApiOperations } from '../src/lib/api-credentials/catalog.js';
import { OPERATIONAL_RESOURCES } from '../src/lib/api-credentials/operational-resources.js';
import { listOperationalResources } from '../src/lib/api-credentials/operational-service.js';
import { corporateEmail } from '../src/lib/api-credentials/project-projection.js';
import { projectEfetivoStatus } from '../src/lib/api-credentials/efetivo-project-status.js';
import { getProjectWorkflow } from '../src/lib/efetivo/project-workflow/service.js';
import { createOperationalRouter } from '../src/routes/integrations/v1/operational.js';
import { executePlaygroundOperation, validatePlaygroundRequest } from '../src/lib/api-credentials/playground.js';
import { buildPlaygroundInput } from '../../shared/schemas/playground-parameters.js';

const projectOp = 'operational.Project.list';
const responsibleOp = 'operational.ProjectResponsible.list';
const statusOp = 'efetivo.projects.status.list';
const stamp = new Date('2026-10-01T12:00:00Z');
const workflowStamp = new Date('2026-10-20T12:00:00Z');
const snapshot = '2026-10-28T12:00:00.000Z';
const cursorKey = 'synthetic-omni-test-cursor-key-32-characters';
const ctx = (extra = {}) => ({ scopes: new Set(['projetos.read', 'projetos.responsaveis.read', 'efetivo.projetos.status.read']),
  projectAccessMode: 'SELECTED', projectIds: new Set(['p1']), projectCodes: new Set(['05776']),
  maxPageSize: 100, cursorKey, snapshotAt: new Date(snapshot), ...extra });
const user = (id, email = `${id}@filtrovali.com.br`) => ({ id, name: `Pessoa ${id}`, email, username: 'PRIVATE', passwordHash: 'PRIVATE', phone: 'PRIVATE' });
const workflow = (extra = {}) => ({ stage: 'EXECUTION', version: 3, updatedAt: workflowStamp,
  leaderUserId: 'leader', plannerUserId: 'planner', leader: user('leader'), planner: user('planner'),
  plannedMobilizationDate: stamp, plannedExecutionStartDate: stamp, plannedExecutionEndDate: workflowStamp,
  commercialExpectedMobilizationDate: stamp, commercialExpectedStartDate: stamp, commercialExpectedDurationDays: 20,
  actualMobilizationDate: stamp, executedAtHeadquarters: false,
  issues: [{ id: 'issue', status: 'OPEN', criticality: 'HIGH', description: 'PRIVATE' }], ...extra });
const project = (extra = {}) => ({ id: 'p1', code: '05776', name: 'Projeto fictício', createdAt: stamp, updatedAt: stamp,
  deletedAt: null, isActive: true, managerOnly: false, clientName: 'Cliente fictício', clientCnpj: '12.345.678/0001-95',
  clientEmailPrimary: 'PRIVATE', commercialProposalCode: '1234', location: 'Itajaí', clientSegment: null,
  mobilizationDate: stamp, demobilizationDate: null, startDate: stamp, endDate: workflowStamp,
  includesSaturday: true, includesSunday: false, workdayHours: '09:00', weekendWorkdayHours: '08:00',
  operatorId: 'collaborator', operator: { id: 'collaborator', name: 'Operador fictício', email: 'PRIVATE', cpf: 'PRIVATE', user: user('operator') },
  workflow: workflow(), plannedServices: [], efetivoMissionPlans: [], documents: [], manualProgressPct: 42, proposalPercentage: 100, ...extra });

// Prisma double evaluates the actual where/order/take supplied by the service and
// deliberately returns extra fields, exercising the independent output allowlist.
function matches(row, where) {
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'AND') return expected.every(part => matches(row, part));
    if (key === 'OR') return expected.some(part => matches(row, part));
    const actual = row?.[key] ?? null;
    if (expected === null || typeof expected !== 'object' || expected instanceof Date) {
      return actual instanceof Date && expected instanceof Date ? +actual === +expected : actual === expected;
    }
    return Object.entries(expected).every(([op, target]) => {
      if (op === 'in') return target.includes(actual);
      if (op === 'notIn') return !target.includes(actual);
      if (op === 'not') return actual !== target;
      if (op === 'is') return target === null ? actual === null : actual !== null && matches(actual, target);
      if (op === 'isNot') return target === null ? actual !== null : !matches(actual, target);
      if (op === 'gt') return actual > target;
      if (op === 'gte') return actual >= target;
      if (op === 'lte') return actual <= target;
      return actual !== null && matches(actual, { [op]: target });
    });
  });
}

function database(rows) {
  const calls = [], logs = [], updates = [], events = [];
  const db = {
    project: {
      async findMany(args) {
        calls.push(args);
        const order = (args.orderBy || []).flatMap(part => Object.keys(part));
        return rows.filter(row => matches(row, args.where)).sort((a, b) => {
          for (const field of order) if (a[field] < b[field]) return -1; else if (a[field] > b[field]) return 1;
          return 0;
        }).slice(0, args.take);
      },
      async findFirst(args) { return rows.find(row => matches(row, args.where)) || null; }
    },
    projectPlannedService: { async findMany() { return []; } },
    projectWorkflowEvent: { async findMany() { return []; } },
    apiUsageBucket: {
      async upsert({ create }) { return { id: create.windowKind }; },
      async updateMany(args) { updates.push(args); return { count: 1 }; },
      async update(args) { updates.push(args); return args; }
    },
    apiRequestLog: { async create({ data }) { logs.push(data); } },
    apiCredentialEvent: { async create({ data }) { events.push(data); } },
    apiCredential: {
      async findUnique() { return { id: 'synthetic-omni-token', projectAccessMode: 'SELECTED', maxPageSize: 2,
        requestsPerMinute: 60, requestsPerDay: 1000, rowsPerDay: 10000,
        scopes: [...ctx().scopes].map(scopeCode => ({ scopeCode })), projects: [{ projectId: 'p1', project: { code: '05776' } }] }; },
      async updateMany() { return { count: 1 }; }
    },
    async $transaction(action) { return typeof action === 'function' ? action(db) : Promise.all(action); }
  };
  return { db, calls, logs, updates, events };
}

test('projects add exactly the nine requested fields, normalize CNPJ and retain the old contract', async () => {
  const original = ['id', 'createdAt', 'updatedAt', 'code', 'name', 'isActive', 'location', 'clientSegment', 'mobilizationDate', 'demobilizationDate', 'startDate'];
  const added = ['clientName', 'clientCnpj', 'commercialProposalCode', 'endDate', 'includesSaturday', 'includesSunday', 'workdayHours', 'weekendWorkdayHours', 'executedAtHeadquarters'];
  const { db } = database([project(), project({ id: 'p2', code: '9999' }), project({ id: 'deleted', deletedAt: stamp })]);
  const { items } = await listOperationalResources(db, projectOp, { projectCode: '05776', updatedSince: stamp.toISOString() }, ctx());
  assert.equal(items.length, 1);
  assert.deepEqual(Object.keys(items[0]).sort(), [...original, ...added].sort());
  assert.equal(items[0].clientCnpj, '12345678000195');
  assert.equal(items[0].executedAtHeadquarters, false);
  assert.equal(items[0].endDate, workflowStamp.toISOString());
  assert.doesNotMatch(JSON.stringify(items), /PRIVATE|passwordHash|workflow|operator/);
  const missing = await listOperationalResources(database([project({ workflow: null, clientCnpj: 'invalid' })]).db, projectOp, {}, ctx());
  assert.equal(missing.items[0].clientCnpj, null);
  assert.equal(missing.items[0].executedAtHeadquarters, null);
});

test('responsibles map each role correctly, minimize PII and allow only the exact corporate domain', async () => {
  const { db } = database([project()]);
  const result = await listOperationalResources(db, responsibleOp, {}, ctx());
  assert.deepEqual(result.items.map(row => [row.role, row.userId, row.collaboratorId]), [
    ['FIELD_OPERATOR', 'operator', 'collaborator'], ['LEADER', 'leader', null], ['PLANNER', 'planner', null]
  ]);
  for (const row of result.items) {
    assert.equal(row.updatedAt, workflowStamp.toISOString());
    assert.deepEqual(Object.keys(row).sort(), ['projectId', 'projectCode', 'role', 'userId', 'collaboratorId', 'name', 'email', 'updatedAt'].sort());
  }
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|username|passwordHash|cpf|phone|client/);
  for (const email of [null, '', 'personal@gmail.com', 'a@filtrovali.com', 'a@sub.filtrovali.com.br', 'a@filtrovali.com.br.evil.test', 'a@@filtrovali.com.br', 'Name <a@filtrovali.com.br>']) assert.equal(corporateEmail(email), null);
  assert.equal(corporateEmail(' Pessoa@FILTROVALI.COM.BR '), 'Pessoa@FILTROVALI.COM.BR');
  const personal = await listOperationalResources(database([project({ workflow: workflow({ leader: user('leader', 'private@gmail.com') }),
    operator: { id: 'collaborator', name: 'Sem usuário', email: 'collaborator@filtrovali.com.br', user: null } })]).db, responsibleOp, {}, ctx());
  assert.equal(personal.items.find(row => row.role === 'LEADER').email, null);
  assert.equal(personal.items.find(row => row.role === 'FIELD_OPERATOR').email, null);
  assert.equal(personal.items.find(row => row.role === 'FIELD_OPERATOR').userId, null);
});

test('responsibles omit unassigned roles, deleted projects and projects outside the token', async () => {
  const { db } = database([
    project({ workflow: null }), project({ id: 'p2', code: '9999' }), project({ id: 'deleted', deletedAt: stamp })
  ]);
  const result = await listOperationalResources(db, responsibleOp, {}, ctx());
  assert.deepEqual(result.items.map(row => [row.projectId, row.role]), [['p1', 'FIELD_OPERATOR']]);
  assert.equal((await listOperationalResources(database([project({ workflow: null, operatorId: null, operator: null })]).db, responsibleOp, {}, ctx())).items.length, 0);
  assert.equal((await listOperationalResources(database([project({ workflow: workflow({ plannerUserId: null, planner: null }) })]).db, responsibleOp, {}, ctx())).items.length, 2);
});

test('responsible pagination cuts inside a project, is bounded, and binds filters/policy/operation/snapshot', async () => {
  const { db, calls } = database([project(), project({ id: 'p2', code: '9999' })]);
  const all = ctx({ projectAccessMode: 'ALL' });
  const seen = [];
  let cursor;
  do {
    const result = await listOperationalResources(db, responsibleOp, { limit: 1, ...(cursor ? { cursor } : {}) }, all);
    seen.push(...result.items.map(row => `${row.projectId}:${row.role}`));
    assert.equal(result.page.snapshotAt, snapshot);
    cursor = result.page.nextCursor;
  } while (cursor);
  assert.deepEqual(seen, ['p1:FIELD_OPERATOR', 'p1:LEADER', 'p1:PLANNER', 'p2:FIELD_OPERATOR', 'p2:LEADER', 'p2:PLANNER']);
  assert.ok(calls.every(call => call.take === 2));
  const first = await listOperationalResources(db, responsibleOp, { limit: 1, projectCode: '05776' }, ctx());
  for (const [op, query, context] of [
    [responsibleOp, { cursor: `${first.page.nextCursor}broken`, projectCode: '05776' }, ctx()],
    [responsibleOp, { cursor: first.page.nextCursor }, ctx()],
    [responsibleOp, { cursor: first.page.nextCursor, projectCode: '05776' }, all],
    [responsibleOp, { cursor: first.page.nextCursor, projectCode: '05776', snapshotAt: stamp.toISOString() }, ctx()],
    [statusOp, { cursor: first.page.nextCursor, projectCode: '05776' }, ctx()]
  ]) await assert.rejects(() => listOperationalResources({}, op, query, context), error => error.code === 'INVALID_CURSOR');
});

test('responsible incremental watermark is max(Project.updatedAt, Workflow.updatedAt), inclusive and bounded by snapshot', async () => {
  const cases = [
    [project(), 3],
    [project({ updatedAt: workflowStamp, workflow: workflow({ updatedAt: stamp }) }), 3],
    [project({ workflow: workflow({ updatedAt: stamp }) }), 0],
    [project({ workflow: workflow({ updatedAt: new Date('2026-10-29Z') }) }), 0],
    [project({ workflow: null, updatedAt: workflowStamp }), 1]
  ];
  for (const [row, expected] of cases) {
    const result = await listOperationalResources(database([row]).db, responsibleOp, { updatedSince: workflowStamp.toISOString() }, ctx());
    assert.equal(result.items.length, expected);
    if (expected) assert.equal(result.items[0].updatedAt, workflowStamp.toISOString());
  }
  for (const query of [{ updatedSince: '2030-01-01T00:00:00Z' }, { snapshotAt: '2030-01-01T00:00:00Z' }]) {
    await assert.rejects(() => listOperationalResources({}, responsibleOp, query, ctx()), error => error.code === 'INVALID_SNAPSHOT');
  }
});

test('all three operations enforce missing scope and project restrictions before database access', async () => {
  for (const op of [projectOp, responsibleOp, statusOp]) {
    await assert.rejects(() => listOperationalResources({}, op, {}, ctx({ scopes: new Set() })), error => error.statusCode === 403 && error.code === 'INSUFFICIENT_SCOPE');
    for (const query of [{ projectId: 'p2' }, { projectCode: '9999' }]) {
      await assert.rejects(() => listOperationalResources({}, op, query, ctx()), error => error.code === 'PROJECT_NOT_ALLOWED');
    }
    await assert.rejects(() => listOperationalResources({}, op, {}, ctx({ projectIds: new Set() })), error => error.code === 'PROJECT_NOT_ALLOWED');
    await assert.rejects(() => listOperationalResources({}, op, { projectId: 'p1', projectCode: '05776' }, ctx()));
    await assert.rejects(() => listOperationalResources({}, op, { limit: 3 }, ctx({ maxPageSize: 2 })), error => error.code === 'INVALID_LIMIT');
    const route = createOperationalRouter().stack.find(layer => layer.route?.path === OPERATIONAL_RESOURCES.find(r => r.operationId === op).path).route;
    const response = { setHeader() {}, status(code) { this.code = code; return this; }, json() {} };
    route.stack[0].handle({ query: {}, apiAuth: { scopeCodes: new Set() } }, response, () => assert.fail('unauthorized'));
    assert.equal(response.code, 403);
  }
});

test('status collection reuses individual summary and adds exactly four fields, without changing individual projection', async () => {
  const row = project();
  const { db } = database([row]);
  const { items } = await listOperationalResources(db, statusOp, {}, ctx());
  const detail = await getProjectWorkflow('p1', {}, { database: db });
  const individual = projectEfetivoStatus(detail, { progressPct: 42, progressMethod: 'MANUAL' });
  const { commercialExpectedMobilizationDate, commercialExpectedStartDate, commercialExpectedDurationDays, actualMobilizationDate, ...same } = items[0];
  assert.deepEqual(same, individual);
  assert.deepEqual([commercialExpectedMobilizationDate, commercialExpectedStartDate, commercialExpectedDurationDays, actualMobilizationDate], ['2026-10-01', '2026-10-01', 20, '2026-10-01']);
  assert.equal(individual.commercialExpectedDurationDays, undefined);
  assert.doesNotMatch(JSON.stringify(items), /PRIVATE|email|leader|operator|description|document|amount|client/);
  row.manualProgressPct = 75;
  const changed = await listOperationalResources(db, statusOp, {}, ctx());
  assert.equal(changed.items[0].progressPercent, 75);
  assert.equal(changed.items[0].workflowVersion, individual.workflowVersion);
});

test('status active/stage/project filters, no-workflow projection and pagination include eligible inactive projects', async () => {
  const { db } = database([project(), project({ id: 'p2', code: '9999', isActive: false, workflow: null }),
    project({ id: 'excluded', deletedAt: stamp }), project({ id: 'manager', managerOnly: true }), project({ id: 'sede', code: '5002' })]);
  const all = ctx({ projectAccessMode: 'ALL' });
  const first = await listOperationalResources(db, statusOp, { limit: 1 }, all);
  assert.equal(first.items[0].projectId, 'p1');
  const last = await listOperationalResources(db, statusOp, { limit: 1, cursor: first.page.nextCursor }, all);
  assert.equal(last.items[0].projectId, 'p2');
  assert.equal(last.items[0].workflowStarted, false);
  assert.equal(last.items[0].commercialExpectedDurationDays, null);
  assert.equal(last.page.hasMore, false);
  for (const [query, ids] of [[{ active: 'false' }, ['p2']], [{ active: 'true', stage: 'EXECUTION' }, ['p1']], [{ projectCode: '05776' }, ['p1']], [{ projectId: 'p2' }, ['p2']]]) {
    assert.deepEqual((await listOperationalResources(db, statusOp, query, all)).items.map(row => row.projectId), ids);
  }
  for (const query of [{ updatedSince: stamp.toISOString() }, { createdSince: stamp.toISOString() }, { stage: 'INVALID' }, { stage: 'EXECUTION,FINISHED' }]) {
    await assert.rejects(() => listOperationalResources({}, statusOp, query, all));
  }
});

test('status refreshes RDO progress even when Project/Workflow timestamps and version do not change', async () => {
  const row = project();
  const { db } = database([row]);
  db.projectPlannedService.findMany = async () => [{ projectId: 'p1', serviceType: 'LIMPEZA_QUIMICA', weight: 1,
    systems: [{ systemType: 'TUBULACAO', quantity: 100, unit: 'M' }] }];
  const service = { id: 'service-1', finalized: true, serviceType: 'LIMPEZA_QUIMICA',
    extraData: { tubes: [{ c: '25', lengthUnit: 'm' }] },
    report: { id: 'rdo-1', projectId: 'p1', reportType: 'RDO', status: 'APPROVED', reportDate: stamp, specialConditions: {} } };
  db.reportService = { async findMany() { return [service]; } };
  db.historicalServiceReport = { async findMany() { return []; } };
  db.projectRealizedCorrection = { async findMany() { return []; } };
  const first = (await listOperationalResources(db, statusOp, {}, ctx())).items[0];
  service.extraData.tubes[0].c = '75';
  const next = (await listOperationalResources(db, statusOp, {}, ctx())).items[0];
  assert.equal(first.progressMethod, 'RDO');
  assert.equal(first.progressPercent, 25);
  assert.equal(next.progressPercent, 75);
  assert.equal(next.workflowVersion, first.workflowVersion);
  assert.equal(row.updatedAt, stamp);
  assert.equal(row.workflow.updatedAt, workflowStamp);
});

test('new scope is AVAILABLE/PERSONAL and playground serializes stage as a single code', () => {
  const scope = API_SCOPES.find(scope => scope.code === 'projetos.responsaveis.read');
  assert.equal(scope.status, 'AVAILABLE');
  assert.equal(scope.sensitivity, 'PERSONAL');
  assert.ok(scope.exposedFields.includes('email'));
  const operations = publicApiOperations();
  for (const op of [responsibleOp, statusOp]) assert.ok(operations.some(item => item.operationId === op));
  const status = operations.find(item => item.operationId === statusOp);
  assert.ok(!status.queryParams.includes('updatedSince'));
  const input = buildPlaygroundInput(status, { stage: 'EXECUTION', projectCode: '05776' });
  assert.equal(validatePlaygroundRequest(input).query.stage, 'EXECUTION');
});

for (const op of [responsibleOp, statusOp]) test(`${op}: real route and playground meter returned rows and preserve envelope`, async () => {
  const { db, logs, updates, events } = database([project()]);
  const credential = await db.apiCredential.findUnique();
  const resource = OPERATIONAL_RESOURCES.find(item => item.operationId === op);
  const router = createOperationalRouter({ prismaClient: db, envConfig: { apiTokenGlobalMaxPageSize: 500, apiTokenHashKeys: { 1: cursorKey }, apiTokenActiveKeyVersion: 1 } });
  const route = router.stack.find(layer => layer.route?.path === resource.path).route;
  const req = { query: { limit: '1' }, requestId: 'synthetic-request', headers: {}, apiAuth: { credential, scopeCodes: ctx().scopes, projectIds: ctx().projectIds, projectCodes: ctx().projectCodes } };
  const result = await new Promise((resolve, reject) => route.stack[0].handle(req, {}, () => route.stack[1].handle(req, { json: resolve }, reject)));
  assert.equal(result.items.length, 1);
  assert.equal(result.schemaVersion, '1.0');
  assert.equal(result.requestId, req.requestId);
  assert.ok(logs.some(log => log.operationId === op && log.responseRows === 1));
  assert.ok(updates.some(update => update.data.rows?.increment === 1));
  assert.doesNotMatch(JSON.stringify(logs), /filtrovali.com.br|PRIVATE/);
  const playground = await executePlaygroundOperation(db, credential.id, { operationId: op, pathParams: {}, query: { limit: 1 } }, { cursorKey });
  assert.equal(playground.response.body.schemaVersion, '1.0');
  assert.equal(playground.response.body.items.length, 1);
  assert.ok(events.some(event => event.type === 'TESTED'));
});
