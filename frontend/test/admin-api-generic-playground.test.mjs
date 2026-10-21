import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { API_SCOPES, publicApiOperations } from '../../backend/src/lib/api-credentials/catalog.js';
import { makePlaygroundParameterSchema, buildPlaygroundInput, playgroundParameterDefaults } from '../../shared/schemas/playground-parameters.js';
import { exampleOperationForCredential, operationsForScope } from '../src/components/admin/api-tokens/apiOperations.ts';
import { redactedRequestPreview } from '../src/components/admin/api-tokens/apiRequestFormatting.ts';

const operations = publicApiOperations();
const operation = id => operations.find(op => op.operationId === id);
const schema = (op, scopes = API_SCOPES.map(scope => scope.code)) => makePlaygroundParameterSchema(z, op.parameters, { maxPageSize: 3, scopes, method: op.method });

test('one-time token example uses a collection allowed by the granted permissions in each area', () => {
  for (const [scope, path] of [
    ['projetos.read', '/projetos'],
    ['estoque.itens.read', '/estoque/itens'],
    ['rdo.relatorios.read', '/rdo/relatorios'],
    ['qualidade.naturezas.read', '/qualidade/naturezas']
  ]) {
    const example = exampleOperationForCredential(operations, [scope]);
    assert.equal(example?.path, path);
    assert.equal(schema(example, [scope]).safeParse({}).success, true);
  }
});

test('one-time token example never falls back to unauthorized queries or operations needing an ID', () => {
  assert.equal(exampleOperationForCredential(operations, []), undefined);
  assert.equal(exampleOperationForCredential([], ['projetos.read']), undefined);
  assert.equal(exampleOperationForCredential(operations, ['qualidade.evidencias.download']), undefined);
  const scopes = ['qualidade.registros.read', 'qualidade.evidencias.metadata.read', 'qualidade.evidencias.download'];
  assert.equal(exampleOperationForCredential([
    operation('quality.evidence.download'), operation('quality.records.get'), operation('quality.records.list')
  ], scopes)?.path, '/qualidade/registros');
});

test('all implemented permissions select matching operations, including optional quality and downloads', () => {
  for (const scope of API_SCOPES) {
    const matches = operationsForScope(operations, scope.code);
    assert.ok(matches.length, scope.code);
    assert.ok(matches.every(op => [...op.requiredScopes, ...op.optionalScopes].includes(scope.code)));
  }
  assert.equal(operationsForScope(operations, '').length, operations.length);
  assert.equal(operationsForScope(operations, 'rdo.anexos.download')[0].responseKind, 'DOWNLOAD_CHECK');
  assert.equal(operationsForScope(operations, 'ponto.resumos.read').length, 0);
});

test('dynamic forms validate every required path and query parameter', () => {
  for (const op of operations) {
    const initial = playgroundParameterDefaults(op, 3);
    const result = schema(op).safeParse(initial);
    assert.equal(result.success, !op.parameters.some(parameter => parameter.required), op.operationId);
    if (op.pathParams.length) {
      const requiredQuery = Object.fromEntries(op.parameters.filter(parameter => parameter.in === 'query' && parameter.required)
        .map(parameter => [parameter.name, parameter.type === 'date' ? '2026-10-15' : 'demo']));
      const path = op.pathParams[0];
      assert.equal(schema(op).safeParse({ ...initial, ...requiredQuery, [path]: 'record-demo' }).success, true);
      assert.equal(schema(op).safeParse({ [path]: ' ' }).success, false);
      assert.equal(schema(op).safeParse({ [path]: 'x'.repeat(op.parameters.find(parameter => parameter.name === path).maxLength + 1) }).success, false);
    }
    assert.equal(schema(op).safeParse({ ...initial, url: 'http://private' }).success, false);
  }
});

test('salary playground requires a cargo ID and a valid reference date and builds only those parameters', () => {
  const op = operationsForScope(operations, 'cargos.salarios.read')[0];
  assert.equal(op.operationId, 'jobRoles.salary.get');
  assert.equal(schema(op).safeParse({ id: 'role-1' }).success, false);
  assert.equal(schema(op).safeParse({ id: 'role-1', referenceDate: '2026-02-30' }).success, false);
  const values = schema(op).parse({ id: 'role-1', referenceDate: '2026-10-15' });
  assert.deepEqual(buildPlaygroundInput(op, { ...values, collaboratorId: 'ignored' }), {
    operationId: op.operationId, pathParams: { id: 'role-1' }, query: { referenceDate: '2026-10-15' }
  });
});

test('generic query builder converts types and dates, keeps filters out of path and omits unrelated values', () => {
  const op = operation('quality.records.list');
  const values = { limit: '3', updatedSince: '2026-09-08T09:30:00-03:00', status: 'ABERTO, FECHADO', type: 'DESVIO', includeDeleted: 'false', projectCode: ' 05776 ', cursor: 'cursor-demo', snapshotAt: '2026-09-08T18:00:00Z' };
  const parsed = schema(op, ['qualidade.registros.read']).parse(values);
  assert.deepEqual(buildPlaygroundInput(op, { ...parsed, id: 'ignored' }), { operationId: op.operationId, pathParams: {}, query: { limit: 3, updatedSince: '2026-09-08T12:30:00.000Z', status: ['ABERTO', 'FECHADO'], type: ['DESVIO'], includeDeleted: false, projectCode: '05776', cursor: 'cursor-demo', snapshotAt: '2026-09-08T18:00:00.000Z' } });
  for (const patch of [{ limit: 4 }, { limit: 1.5 }, { updatedSince: 'invalid' }, { status: 'unknown' }, { eventDateFrom: '2026-02-31' }, { includeDeleted: 'true' }]) {
    assert.equal(schema(op, ['qualidade.registros.read']).safeParse({ ...values, ...patch }).success, false);
  }
  assert.equal(schema(op).safeParse({ projectCode: '05776', projectId: 'p1' }).success, false);
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
  assert.equal(redactedRequestPreview({ request: { method: 'GET', path: '/api/integracoes/v1/projetos', authorization: 'Bearer segredo-completo', curl: 'untrusted' }, response: { status: 200, body: {} } }).authorization, 'Bearer ••••');
});

test('CRM POST form requires JSON and console builds a POST curl from the validated body', () => {
  const op = operation('efetivo.projects.create');
  const defaults = playgroundParameterDefaults(op);
  assert.equal(schema(op).safeParse(defaults).success, true);
  assert.equal(schema(op).safeParse({ bodyJson: '{invalid}' }).success, false);
  const input = buildPlaygroundInput(op, defaults);
  assert.equal(input.body.code, '05776');
  const preview = redactedRequestPreview({
    request: { method: 'POST', path: '/api/integracoes/v1/efetivo/projetos', authorization: 'Bearer ••••demo', curl: 'untrusted', body: input.body },
    response: { status: 201, body: { status: 'created' } }
  });
  assert.match(preview.curl, /-X POST/);
  assert.match(preview.curl, /--data-raw/);
  assert.doesNotMatch(preview.curl, /untrusted/);
});

test('planning-1.0 inclui Idempotency-Key no comando copiado do console', () => {
  const op = operation('acompanhamento.opportunities.post');
  const input = buildPlaygroundInput(op, playgroundParameterDefaults(op));
  const preview = redactedRequestPreview({ request: { method: 'POST', path: '/api/integracoes/v1/acompanhamento/oportunidades', authorization: 'Bearer ••••demo', body: input.body }, response: { status: 201, body: {} } });
  assert.ok(preview.curl.includes(`Idempotency-Key: ${input.body.eventId}`));
});
