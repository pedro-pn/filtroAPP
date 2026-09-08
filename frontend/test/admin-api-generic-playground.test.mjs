import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { API_SCOPES, publicApiOperations } from '../../backend/src/lib/api-credentials/catalog.js';
import { makePlaygroundParameterSchema, buildPlaygroundInput, playgroundParameterDefaults } from '../../shared/schemas/playground-parameters.js';
import { operationsForScope } from '../src/components/admin/api-tokens/apiOperations.ts';
import { redactedRequestPreview } from '../src/components/admin/api-tokens/apiRequestFormatting.ts';

const operations = publicApiOperations();
const operation = id => operations.find(op => op.operationId === id);
const schema = (op, scopes = API_SCOPES.map(scope => scope.code)) => makePlaygroundParameterSchema(z, op.parameters, { maxPageSize: 3, scopes });

test('all implemented permissions select matching operations, including optional quality and downloads', () => {
  for (const scope of API_SCOPES) {
    const matches = operationsForScope(operations, scope.code);
    assert.ok(matches.length, scope.code);
    assert.ok(matches.every(op => [...op.requiredScopes, ...op.optionalScopes].includes(scope.code)));
  }
  assert.equal(operationsForScope(operations, '').length, 35);
  assert.equal(operationsForScope(operations, 'rdo.anexos.download')[0].responseKind, 'DOWNLOAD_CHECK');
  assert.equal(operationsForScope(operations, 'ponto.resumos.read').length, 0);
});

test('dynamic forms cover all fields and only resource operations require an individual ID', () => {
  for (const op of operations) {
    const initial = playgroundParameterDefaults(op, 3);
    const result = schema(op).safeParse(initial);
    assert.equal(result.success, !op.pathParams.length, op.operationId);
    if (op.pathParams.length) {
      assert.equal(schema(op).safeParse({ id: 'record-demo' }).success, true);
      assert.equal(schema(op).safeParse({ id: ' ' }).success, false);
      assert.equal(schema(op).safeParse({ id: 'x'.repeat(101) }).success, false);
    }
    assert.equal(schema(op).safeParse({ ...initial, url: 'http://private' }).success, false);
  }
});

test('generic query builder converts types and dates, keeps filters out of path and omits unrelated values', () => {
  const op = operation('quality.records.list');
  const values = { limit: '3', updatedSince: '2026-09-08T09:30:00-03:00', status: 'ABERTO, FECHADO', type: 'DESVIO', includeDeleted: 'false', projectId: ' p1 ', cursor: 'cursor-demo', snapshotAt: '2026-09-08T18:00:00Z' };
  const parsed = schema(op, ['qualidade.registros.read']).parse(values);
  assert.deepEqual(buildPlaygroundInput(op, { ...parsed, id: 'ignored' }), { operationId: op.operationId, pathParams: {}, query: { limit: 3, updatedSince: '2026-09-08T12:30:00.000Z', status: ['ABERTO', 'FECHADO'], type: ['DESVIO'], includeDeleted: false, projectId: 'p1', cursor: 'cursor-demo', snapshotAt: '2026-09-08T18:00:00.000Z' } });
  for (const patch of [{ limit: 4 }, { limit: 1.5 }, { updatedSince: 'invalid' }, { status: 'unknown' }, { eventDateFrom: '2026-02-31' }, { includeDeleted: 'true' }]) {
    assert.equal(schema(op, ['qualidade.registros.read']).safeParse({ ...values, ...patch }).success, false);
  }
});

test('defaults do not leak prior IDs/filters and optional scopes are enabled only when granted', () => {
  const op = operation('quality.records.list');
  assert.deepEqual(playgroundParameterDefaults(op, 3, 'qualidade.excluidos.read', ['qualidade.excluidos.read']), { limit: '3', includeDeleted: 'true' });
  assert.deepEqual(playgroundParameterDefaults(op, 3, 'qualidade.excluidos.read', []), { limit: '3' });
  assert.deepEqual(playgroundParameterDefaults(operation('operational.StockItemDocument.download'), 3), {});
  const input = buildPlaygroundInput(operation('operational.StockItemDocument.download'), { id: ' doc-1 ', itemId: 'ignored' });
  assert.deepEqual(input, { operationId: 'operational.StockItemDocument.download', query: {}, pathParams: { id: 'doc-1' } });
});

test('download console builds binary curl without reusing the supplied curl command', () => {
  const preview = redactedRequestPreview({ request: { method: 'GET', path: '/api/integracoes/v1/rdo/anexos/demo/download', authorization: 'Bearer ••••demo', curl: 'untrusted' }, response: { status: 200, body: { kind: 'DOWNLOAD_CHECK' } } });
  assert.match(preview.curl, /--output "arquivo-baixado.bin"/);
  assert.match(preview.curl, /\$FILTRO_API_TOKEN/);
  assert.match(preview.curl, /\$FILTRO_API_BASE_URL\/api\/integracoes\/v1/);
  assert.doesNotMatch(preview.curl, /Accept: application\/json|untrusted/);
});
