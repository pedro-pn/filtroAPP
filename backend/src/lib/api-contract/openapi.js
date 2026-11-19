import { z } from 'zod';

// Monta o OpenAPI 3.1 da API interna a partir dos contratos registrados
// (spec 042, D1/D2). Determinístico: mesma entrada → mesmo arquivo, para o CI
// conferir que docs/api/openapi.internal.json está atualizado.

const STATUS_TEXT = {
  200: 'OK', 201: 'Criado', 202: 'Aceito', 204: 'Sem conteúdo',
  400: 'Dados inválidos', 401: 'Não autenticado', 403: 'Sem permissão', 404: 'Não encontrado',
  409: 'Conflito', 413: 'Corpo grande demais', 422: 'Não processável', 429: 'Muitas requisições',
  500: 'Erro interno', 503: 'Indisponível'
};

const SECURITY_BY_AUTH = {
  session: [{ sessionCookie: [] }, { bearerSession: [] }],
  public: [],
  publicToken: [],
  apiToken: [{ bearerSession: [] }]
};

function jsonSchema(schema, io) {
  const result = z.toJSONSchema(schema, { target: 'draft-2020-12', io, unrepresentable: 'any' });
  delete result.$schema;
  return result;
}

// Express 5 → OpenAPI: `:id` → `{id}`, `*caminho` → `{caminho}`, sem `{/:opcional}`.
export function openApiPath(expressPath) {
  return expressPath
    .replace(/\{\/:([A-Za-z0-9_]+)\}/g, '/{$1}')
    .replace(/:([A-Za-z0-9_]+)/g, '{$1}')
    .replace(/\*([A-Za-z0-9_]+)/g, '{$1}');
}

function pathParameters(expressPath, paramsSchema) {
  const names = [...expressPath.matchAll(/[:*]([A-Za-z0-9_]+)/g)].map(match => match[1]);
  const shape = paramsSchema ? jsonSchema(paramsSchema, 'input') : null;
  return names.map(name => ({
    name,
    in: 'path',
    required: true,
    schema: shape?.properties?.[name] || { type: 'string' }
  }));
}

function queryParameters(querySchema) {
  if (!querySchema) return [];
  const shape = jsonSchema(querySchema, 'input');
  const required = new Set(shape.required || []);
  return Object.entries(shape.properties || {}).sort(([a], [b]) => a.localeCompare(b)).map(([name, schema]) => ({
    name,
    in: 'query',
    required: required.has(name),
    schema
  }));
}

function responsesFor(contract) {
  const responses = {};
  for (const [status, schema] of Object.entries(contract.responses)) {
    responses[status] = schema === null
      ? { description: STATUS_TEXT[status] || 'Resposta' }
      : { description: STATUS_TEXT[status] || 'Resposta', content: { 'application/json': { schema: jsonSchema(schema, 'output') } } };
  }
  for (const status of [...new Set(contract.errors)].sort((a, b) => a - b)) {
    responses[String(status)] = {
      description: STATUS_TEXT[status] || 'Erro',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
    };
  }
  return responses;
}

// Corpo JSON ou multipart. No multipart, os campos de texto vêm do schema e os
// arquivos de `bodyFiles` ({ campo: descrição }) entram como binário.
function requestBodyFor(contract) {
  const contentType = contract.bodyContentType || 'application/json';
  const schema = jsonSchema(contract.body, 'input');
  if (contentType === 'multipart/form-data' && contract.bodyFiles) {
    schema.properties ||= {};
    for (const [name, description] of Object.entries(contract.bodyFiles).sort(([a], [b]) => a.localeCompare(b))) {
      schema.properties[name] = { type: 'string', format: 'binary', description };
    }
  }
  return { required: !contract.bodyOptional, content: { [contentType]: { schema } } };
}

export function buildInternalOpenApi(routes, { version = '0' } = {}) {
  const paths = {};
  for (const route of routes) {
    const contract = route.contract;
    if (!contract) continue;
    const pathKey = openApiPath(route.path);
    paths[pathKey] ||= {};
    const operation = {
      operationId: `${route.method}${pathKey.replace(/[^A-Za-z0-9]+(.)?/g, (_m, c) => (c ? c.toUpperCase() : ''))}`,
      summary: contract.summary,
      tags: contract.tags || [],
      security: SECURITY_BY_AUTH[contract.auth],
      'x-auth': contract.auth,
      parameters: [...pathParameters(route.path, contract.params), ...queryParameters(contract.query)],
      ...(contract.body ? { requestBody: requestBodyFor(contract) } : {}),
      ...(contract.validateInput === 'handler' ? { 'x-validated-by': contract.validatedBy } : {}),
      ...(contract.noBody ? { 'x-no-body': contract.noBody } : {}),
      responses: responsesFor(contract)
    };
    if (!operation.parameters.length) delete operation.parameters;
    paths[pathKey][route.method] = operation;
  }
  const sortedPaths = Object.fromEntries(Object.keys(paths).sort().map(key => [key, paths[key]]));
  return {
    openapi: '3.1.0',
    info: {
      title: 'filtroAPP — API interna',
      version,
      description: 'Gerado de backend/src (defineRoute + schemas zod). Não editar à mão: `npm run contract:build` no backend. A API pública de integração (v1) tem contrato próprio em specs/015-api-token-playground/contracts/openapi.yaml.'
    },
    servers: [{ url: '/' }],
    paths: sortedPaths,
    components: {
      securitySchemes: {
        sessionCookie: { type: 'apiKey', in: 'cookie', name: 'fv_session' },
        bearerSession: { type: 'http', scheme: 'bearer', description: 'Só na transição para o cookie (spec 041)' }
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error', 'code', 'requestId'],
          properties: {
            error: { type: 'string', description: 'Mensagem para exibir ao usuário' },
            code: { type: 'string', description: 'Código estável do erro (ex.: VALIDATION_ERROR, TWO_FACTOR_INVALID)' },
            requestId: { type: 'string', description: 'Mesmo valor do cabeçalho X-Request-Id' },
            details: { description: 'Detalhes, como os campos inválidos' }
          },
          additionalProperties: true
        }
      }
    }
  };
}
