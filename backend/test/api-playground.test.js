import assert from 'node:assert/strict';
import test from 'node:test';

import { validatePlaygroundRequest, executePlaygroundOperation } from '../src/lib/api-credentials/playground.js';
import { API_SCOPES, API_OPERATIONS, publicApiOperations } from '../src/lib/api-credentials/catalog.js';
import { projectEfetivoStatus, validateEfetivoProjectStatusRequest } from '../src/lib/api-credentials/efetivo-project-status.js';

test('every implemented scope and operation is testable with complete typed parameter descriptions', () => {
  const operations = publicApiOperations();
  assert.equal(operations.length, API_OPERATIONS.length);
  for (const scope of API_SCOPES) assert.ok(operations.some(op => [...op.requiredScopes, ...op.optionalScopes].includes(scope.code)), scope.code);
  for (const operation of operations) {
    assert.ok(operation.domain);
    assert.ok(['JSON', 'DOWNLOAD_CHECK'].includes(operation.responseKind));
    assert.deepEqual(operation.parameters.map(p => `${p.in}:${p.name}`).sort(), [...operation.queryParams.map(p => `query:${p}`), ...operation.pathParams.map(p => `path:${p}`)].sort());
    for (const param of operation.parameters) {
      assert.ok(param.label && param.type);
      if (param.in === 'query') assert.match(param.help, /Na URI:/);
    }
  }
  for (const operation of operations.filter(item => item.queryParams.includes('projectId'))) {
    assert.ok(operation.queryParams.includes('projectCode'), operation.operationId);
  }
  const reportType = operations.find(item => item.operationId === 'operational.Report.list')
    .parameters.find(parameter => parameter.name === 'reportType');
  assert.deepEqual(reportType.options, ['RDO', 'RDO_MAINTENANCE', 'RDO_PRODUCTION', 'RTP', 'RLQ', 'RCPU', 'RLM', 'RLF', 'RLI']);
  assert.match(reportType.help, /reportType=RCPU/);
  assert.equal(operations.filter(op => op.responseKind === 'DOWNLOAD_CHECK').length, 4);
});

test('playground accepts only allowlisted operationId, pathParams and query keys', () => {
  assert.deepEqual(validatePlaygroundRequest({ operationId: 'quality.records.list', query: { limit: 10, projectCode: '05776' }, pathParams: {} }).operationId, 'quality.records.list');
  for (const input of [
    { operationId: 'quality.records.list', query: {}, url: 'https://attacker.invalid' },
    { operationId: 'quality.records.list', query: {}, method: 'DELETE' },
    { operationId: 'quality.records.list', query: {}, headers: { authorization: 'secret' } },
    { operationId: 'quality.records.list', query: {}, body: { raw: true } },
    { operationId: 'quality.records.list', query: { arbitrary: 'x' } },
    { operationId: 'quality.records.list', query: { projectCode: '05776', projectId: 'p1' } },
    { operationId: 'operational.Report.list', query: { reportType: 'INVALID' } },
    { operationId: 'unknown.operation', query: {} }
  ]) assert.throws(() => validatePlaygroundRequest(input));
});

test('playground enforces credential scopes before touching data', async () => {
  const prisma = { apiCredential: { async findUnique() { return {
    id: 'cred_1', selector: 'abcdefghijklmnop', secretLastFour: 'last', projectAccessMode: 'ALL', maxPageSize: 100,
    requestsPerMinute: 60, requestsPerDay: 1000, rowsPerDay: 10000, scopes: [], projects: []
  }; } } };
  await assert.rejects(() => executePlaygroundOperation(prisma, 'cred_1', {
    operationId: 'quality.records.list', query: { limit: 10 }, pathParams: {}
  }, { actorUserId: 'admin_1', cursorKey: 'a'.repeat(40) }), error => error.code === 'INSUFFICIENT_SCOPE');
});

test('CRM project status requires an authorized project and only exposes the contracted summary', () => {
  assert.equal(validatePlaygroundRequest({ operationId: 'efetivo.projects.status.get', pathParams: { id: 'p1' }, query: {} }).pathParams.id, 'p1');
  assert.throws(() => validatePlaygroundRequest({ operationId: 'efetivo.projects.status.get', pathParams: { id: 'p1' }, query: { projectCode: '005719' } }));
  assert.throws(() => validateEfetivoProjectStatusRequest({ id: 'p2' }, {}, {
    projectAccessMode: 'SELECTED', projectIds: new Set(['p1'])
  }), error => error.code === 'PROJECT_NOT_ALLOWED');
  const status = projectEfetivoStatus({
    project: { id: 'p1', code: '005719', demobilizationDate: '2026-10-18', clientCnpj: 'private' },
    workflow: {
      stage: 'EXECUTION', version: 4, plannedMobilizationDate: '2026-10-01',
      commercialReadiness: { status: 'RELEASED' }, mobilizationGate: { ready: true },
      closureGate: { ready: false }, issues: [
        { status: 'OPEN', criticality: 'HIGH', description: 'free text' },
        { status: 'RESOLVED', criticality: 'HIGH' }
      ]
    }
  }, { progressPct: 42, progressMethod: 'RDO' });
  assert.equal(status.projectCode, '005719');
  assert.equal(status.criticalIssueCount, 1);
  assert.equal(status.progressPercent, 42);
  assert.equal(status.progressMethod, 'RDO');
  assert.equal(status.clientCnpj, undefined);
  assert.equal(JSON.stringify(status).includes('free text'), false);
  assert.deepEqual(Object.keys(status).sort(), [
    'projectId', 'projectCode', 'workflowStarted', 'stage', 'workflowVersion',
    'plannedMobilizationDate', 'plannedExecutionStartDate', 'plannedExecutionEndDate',
    'fieldCompletionDate', 'demobilizationDate', 'commercialReadiness',
    'mobilizationReady', 'closureReady', 'openIssueCount', 'criticalIssueCount',
    'progressPercent', 'progressMethod', 'closedAt'
  ].sort());
});

test('quality filters and path IDs are validated before database access; false is not truthy authorization', async () => {
  assert.equal(validatePlaygroundRequest({ operationId: 'quality.records.list', query: { includeDeleted: 'false' } }).query.includeDeleted, false);
  assert.equal(validatePlaygroundRequest({ operationId: 'quality.records.list', query: {} }).query.limit, undefined);
  for (const input of [
    { operationId: 'quality.records.list', query: { includeDeleted: 'maybe' } },
    { operationId: 'quality.records.list', query: { updatedSince: 'invalid' } },
    { operationId: 'quality.records.list', query: { status: 'unknown' } },
    { operationId: 'quality.records.get', pathParams: { id: ' ' }, query: {} },
    { operationId: 'quality.evidence.download', pathParams: { id: ' ' }, query: {} }
  ]) await assert.rejects(() => executePlaygroundOperation({}, 'synthetic-credential', input), e => e.name === 'ZodError');
});
