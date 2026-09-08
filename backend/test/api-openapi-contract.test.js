import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import YAML from 'yaml';

import { API_OPERATIONS, publicApiOperations } from '../src/lib/api-credentials/catalog.js';
import { OPERATIONAL_DOWNLOADS } from '../src/lib/api-credentials/extended-operational-resources.js';
import { OPERATIONAL_RESOURCES } from '../src/lib/api-credentials/operational-resources.js';
import { createOperationalRouter } from '../src/routes/integrations/v1/operational.js';

const contractUrl = new URL('../../specs/015-api-token-playground/contracts/openapi.yaml', import.meta.url);

function operationEntries(contract) {
  const methods = new Set(['get', 'post', 'patch', 'put', 'delete']);
  return Object.entries(contract.paths).flatMap(([path, pathItem]) => Object.entries(pathItem)
    .filter(([method]) => methods.has(method))
    .map(([method, operation]) => ({ path, method, operation })));
}

function collectRefs(value, output = []) {
  if (Array.isArray(value)) value.forEach(item => collectRefs(item, output));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === '$ref') output.push(item);
      else collectRefs(item, output);
    }
  }
  return output;
}

function resolveLocalRef(contract, ref) {
  assert.match(ref, /^#\//, `Referência externa não permitida: ${ref}`);
  return ref.slice(2).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((current, part) => current?.[part], contract);
}

test('OpenAPI parses without duplicate keys and all references resolve', async () => {
  const source = await readFile(contractUrl, 'utf8');
  const document = YAML.parseDocument(source, { uniqueKeys: true });
  assert.deepEqual(document.errors.map(error => error.message), []);
  const contract = document.toJS();
  const refs = collectRefs(contract);
  assert.ok(refs.length > 30);
  for (const ref of refs) assert.ok(resolveLocalRef(contract, ref), `Referência ausente: ${ref}`);
});

test('all administrative, quality and operational operations have unique IDs and concrete route handlers', async () => {
  const [source, adminRoutes, qualityRoutes] = await Promise.all([
    readFile(contractUrl, 'utf8'),
    readFile(new URL('../src/routes/resources/api-credentials.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/routes/integrations/v1/qualidade.js', import.meta.url), 'utf8')
  ]);
  const operations = operationEntries(YAML.parse(source));
  assert.equal(operations.length, 14 + OPERATIONAL_RESOURCES.length + OPERATIONAL_DOWNLOADS.length);
  assert.equal(new Set(operations.map(item => item.operation.operationId)).size, operations.length);

  const handlers = {
    listApiScopes: [adminRoutes, 'get', '/api-scopes'],
    listApiCredentials: [adminRoutes, 'get', '/api-credentials'],
    createApiCredential: [adminRoutes, 'post', '/api-credentials'],
    getApiCredential: [adminRoutes, 'get', '/api-credentials/:id'],
    reduceApiCredential: [adminRoutes, 'patch', '/api-credentials/:id'],
    rotateApiCredential: [adminRoutes, 'post', '/api-credentials/:id/rotate'],
    revokeApiCredential: [adminRoutes, 'post', '/api-credentials/:id/revoke'],
    listApiCredentialEvents: [adminRoutes, 'get', '/api-credentials/:id/events'],
    getApiCredentialUsage: [adminRoutes, 'get', '/api-credentials/:id/usage'],
    testApiCredentialOperation: [adminRoutes, 'post', '/api-credentials/:id/test'],
    qualityRecordsList: [qualityRoutes, 'get', '/registros'],
    qualityRecordGet: [qualityRoutes, 'get', '/registros/:id'],
    qualityNaturesList: [qualityRoutes, 'get', '/naturezas'],
    qualityEvidenceDownload: [qualityRoutes, 'get', '/evidencias/:id/download']
  };
  for (const { operation } of operations) {
    const resource = [...OPERATIONAL_RESOURCES, ...OPERATIONAL_DOWNLOADS].find(item => item.openApiOperationId === operation.operationId);
    if (resource) {
      const route = createOperationalRouter().stack.find(layer => layer.route?.path === resource.path)?.route;
      assert.equal(route?.methods.get, true, `Rota operacional ausente: ${resource.path}`);
      continue;
    }
    const handler = handlers[operation.operationId];
    assert.ok(handler, `Handler não mapeado: ${operation.operationId}`);
    const [routeSource, method, path] = handler;
    assert.ok(routeSource.includes(`router.${method}('${path}'`), `Rota real ausente para ${operation.operationId}`);
  }
});

test('operational response allowlists, query parameters and scope guards match each OpenAPI contract', async () => {
  const contract = YAML.parse(await readFile(contractUrl, 'utf8'));
  for (const resource of OPERATIONAL_RESOURCES) {
    const operation = contract.paths[`/integracoes/v1${resource.path}`].get;
    assert.deepEqual(operation['x-required-scopes'], resource.requiredScopes);
    assert.deepEqual(operation.parameters.map(parameter => parameter.name || resolveLocalRef(contract, parameter.$ref).name).sort(), [...resource.queryParams].sort());
    const schema = operation.responses['200'].content['application/json'].schema.properties.items.items;
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(Object.keys(schema.properties).sort(), Object.keys(resource.fields).sort());
    assert.deepEqual([...schema.required].sort(), Object.keys(resource.fields).sort());
  }
});

test('external operation catalog and runtime Zod schemas match the contract operations', async () => {
  const [source, qualityRoutes, adminRoutes] = await Promise.all([
    readFile(contractUrl, 'utf8'),
    readFile(new URL('../src/routes/integrations/v1/qualidade.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/routes/resources/api-credentials.js', import.meta.url), 'utf8')
  ]);
  const contract = YAML.parse(source);
  const externalIds = operationEntries(contract).filter(item => item.path.startsWith('/integracoes/')).map(item => item.operation.operationId).sort();
  assert.deepEqual(externalIds, API_OPERATIONS.map(item => item.openApiOperationId).sort());
  for (const schema of ['qualityRecordsQuery', 'qualityRecordDetailQuery', 'qualityNaturesQuery', 'idParams']) {
    assert.match(qualityRoutes, new RegExp(`schemas\\.${schema}\\.parse`));
  }
  assert.match(adminRoutes, /scopeCatalogQuerySchema\.parse/);
  assert.match(adminRoutes, /listSchema\.parse/);
});

test('generic playground metadata and request operation enum cover all implemented operations', async () => {
  const contract = YAML.parse(await readFile(contractUrl, 'utf8'));
  const publicOperations = publicApiOperations();
  const operationSchema = contract.paths['/admin/api-scopes'].get.responses['200'].content['application/json'].schema.properties.operations.items;
  const parameterSchema = contract.components.schemas.PlaygroundParameter;
  for (const operation of publicOperations) {
    assert.deepEqual(Object.keys(operation).sort(), [...operationSchema.required].sort());
    for (const param of operation.parameters) {
      assert.ok(Object.keys(param).every(key => parameterSchema.properties[key]));
      assert.ok(parameterSchema.required.every(key => key in param));
    }
  }
  const request = contract.paths['/admin/api-credentials/{credentialId}/test'].post.requestBody.content['application/json'].schema;
  assert.deepEqual([...request.properties.operationId.enum].sort(), publicOperations.map(operation => operation.operationId).sort());
});
