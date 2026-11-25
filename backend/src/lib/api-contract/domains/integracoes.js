import { API_OPERATIONS } from '../../api-credentials/catalog.js';
import { FILE } from './rdo.js';
import { jsonResponseSchema, libValidatedBodySchema } from './efetivo.js';

// Contratos da API de integração v1 (/api/integracoes/v1, spec 042, fase 5b).
// A v1 já tem contrato público próprio, mais detalhado, em
// specs/015-api-token-playground/contracts/openapi.yaml, conferido contra o
// catálogo de operações por test/api-openapi-contract.test.js. Aqui o contrato
// interno só amarra cada rota real à sua operação do catálogo (autenticação por
// token, escopos, rótulo) e aponta para o contrato público; por isso essas rotas
// não entram em docs/api/openapi.internal.json (ver openapi.js).
//
// A entrada é validada pela própria operação: `requireApiOperation` confere o
// escopo e os validadores de lib/api-credentials (ou lib/qualidade, lib/conecta-rh)
// conferem consulta, caminho e corpo antes de tocar no banco.

export const INTEGRATION_PUBLIC_CONTRACT = 'specs/015-api-token-playground/contracts/openapi.yaml';

const OPERATIONS = new Map(API_OPERATIONS.map(operation => [operation.operationId, operation]));

// Respostas de sucesso que não são o 200 padrão.
const SUCCESS_STATUSES = {
  'rh.conecta.events.post': [202],
  'logistics.unloadings.create': [201],
  'quality.records.create': [201],
  'efetivo.projects.create': [200, 201],
  'efetivo.projects.commercialFact.post': [200, 201],
  'efetivo.projects.document.post': [200, 201],
  'acompanhamento.opportunities.post': [200, 201]
};

function isDownload(operation) {
  return /\/(?:download|pdf)$/.test(operation.path);
}

// integrationRoute('GET /registros', 'quality.records.list') → contrato para
// defineRoute. O caminho é o do router (sem o prefixo de montagem); o método e o
// fim do caminho precisam bater com o catálogo.
export function integrationRoute(key, operationId, overrides = {}) {
  const [verb, path] = key.split(' ');
  const operation = OPERATIONS.get(operationId);
  if (!operation) throw new Error(`integrationRoute ${key}: operação ${operationId} fora do catálogo da API v1.`);
  if (operation.method !== verb || !operation.path.endsWith(path)) {
    throw new Error(`integrationRoute ${key}: o catálogo declara ${operationId} como ${operation.method} ${operation.path}.`);
  }
  const write = verb !== 'GET';
  const success = isDownload(operation) ? { 200: FILE }
    : Object.fromEntries((SUCCESS_STATUSES[operationId] || [200]).map(status => [status, jsonResponseSchema]));
  return {
    method: verb.toLowerCase(),
    path,
    summary: `Integração v1: ${operation.label || operationId}`,
    auth: 'apiToken',
    tags: ['integracoes-v1'],
    ...(write ? { body: libValidatedBodySchema } : {}),
    validateInput: 'handler',
    validatedBy: `requireApiOperation('${operationId}') + validador da operação`,
    responses: success,
    errors: write ? [400, 401, 403, 404, 409, 429] : [400, 401, 403, 404, 429],
    externalContract: { spec: INTEGRATION_PUBLIC_CONTRACT, operationId: operation.openApiOperationId },
    scopes: [...(operation.requiredScopes || [])],
    ...overrides
  };
}
