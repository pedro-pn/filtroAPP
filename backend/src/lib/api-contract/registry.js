import { z } from 'zod';

// Registro de contratos da API interna (spec 042, D1). Cada rota migrada é
// declarada com `defineRoute`, que monta a rota no router do Express e prende o
// contrato ao layer criado. O mesmo contrato:
//   - valida body/params/query antes do handler final (ZodError → 400 padrão);
//   - alimenta o OpenAPI gerado (docs/api/openapi.internal.json);
//   - é conferido no CI contra as rotas reais (test/internal-api-contract.test.js).

export const CONTRACT_KEY = Symbol.for('filtrovali.apiContract');

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const WRITE_METHODS = new Set(['post', 'put', 'patch', 'delete']);
export const AUTH_KINDS = new Set(['public', 'session', 'publicToken', 'apiToken']);
// Como a entrada declarada é validada (spec 042):
//   - 'replace' (padrão): o contrato valida e entrega ao handler o valor validado;
//   - 'check': o contrato valida, mas o handler recebe a entrada original
//     (para rotas antigas que normalizam o corpo à mão depois);
//   - 'handler': o contrato só documenta; o próprio handler valida com o mesmo
//     schema (`validatedBy` diz onde). Usado na migração dos domínios antigos para
//     não mudar a ordem das respostas (ex.: 403 de papel antes do 400 de dados).
export const VALIDATE_MODES = new Set(['replace', 'check', 'handler']);
const BODY_CONTENT_TYPES = new Set(['application/json', 'multipart/form-data']);

function isZodSchema(value) {
  return value instanceof z.ZodType;
}

function assertSpec(spec) {
  const where = `${String(spec?.method || '?').toUpperCase()} ${spec?.path || '?'}`;
  if (!spec || typeof spec !== 'object') throw new TypeError('defineRoute: contrato ausente.');
  if (!METHODS.has(spec.method)) throw new TypeError(`defineRoute ${where}: método inválido.`);
  if (typeof spec.path !== 'string' || !spec.path.startsWith('/')) throw new TypeError(`defineRoute ${where}: path deve ser string iniciada por /.`);
  if (typeof spec.summary !== 'string' || !spec.summary.trim()) throw new TypeError(`defineRoute ${where}: summary obrigatório.`);
  if (!AUTH_KINDS.has(spec.auth)) throw new TypeError(`defineRoute ${where}: auth deve ser ${[...AUTH_KINDS].join(', ')}.`);
  for (const key of ['body', 'params', 'query']) {
    if (spec[key] !== undefined && !isZodSchema(spec[key])) throw new TypeError(`defineRoute ${where}: ${key} deve ser um schema zod.`);
  }
  if (WRITE_METHODS.has(spec.method) && spec.body === undefined && !spec.noBody) {
    throw new TypeError(`defineRoute ${where}: escrita sem body precisa de noBody com o motivo.`);
  }
  if (!spec.responses || typeof spec.responses !== 'object' || !Object.keys(spec.responses).length) {
    throw new TypeError(`defineRoute ${where}: responses obrigatório.`);
  }
  for (const [status, schema] of Object.entries(spec.responses)) {
    if (!/^[1-5]\d\d$/.test(status)) throw new TypeError(`defineRoute ${where}: status de resposta inválido (${status}).`);
    if (schema !== null && !isZodSchema(schema)) throw new TypeError(`defineRoute ${where}: resposta ${status} deve ser schema zod ou null.`);
  }
  if (spec.errors !== undefined && !Array.isArray(spec.errors)) throw new TypeError(`defineRoute ${where}: errors deve ser lista.`);
  if (spec.validateInput !== undefined && !VALIDATE_MODES.has(spec.validateInput)) {
    throw new TypeError(`defineRoute ${where}: validateInput deve ser ${[...VALIDATE_MODES].join(', ')}.`);
  }
  if (spec.validateInput === 'handler' && !spec.validatedBy) {
    throw new TypeError(`defineRoute ${where}: validateInput 'handler' exige validatedBy (onde a entrada é validada).`);
  }
  if (spec.bodyContentType !== undefined && !BODY_CONTENT_TYPES.has(spec.bodyContentType)) {
    throw new TypeError(`defineRoute ${where}: bodyContentType deve ser ${[...BODY_CONTENT_TYPES].join(', ')}.`);
  }
  if (spec.bodyFiles !== undefined && (typeof spec.bodyFiles !== 'object' || spec.bodyContentType !== 'multipart/form-data')) {
    throw new TypeError(`defineRoute ${where}: bodyFiles só vale com bodyContentType multipart/form-data.`);
  }
}

// Valida a entrada declarada. `req.body` recebe o valor já validado (com
// defaults do zod); `req.query` é só leitura no Express 5, então a query
// validada fica em `req.validatedQuery`.
function contractValidator(spec) {
  const mode = spec.validateInput || 'replace';
  return function validateContract(req, _res, next) {
    if (mode === 'handler') return next();
    const params = spec.params ? spec.params.parse(req.params || {}) : undefined;
    const query = spec.query ? spec.query.parse(req.query || {}) : undefined;
    const body = spec.body ? spec.body.parse(spec.bodyOptional ? (req.body ?? {}) : req.body) : undefined;
    if (query !== undefined) req.validatedQuery = query;
    if (mode === 'replace') {
      if (params !== undefined) req.params = params;
      if (body !== undefined) req.body = body;
    }
    next();
  };
}

// defineRoute(router, contrato, ...handlers): os middlewares (auth, limites)
// rodam na ordem dada; a validação entra logo antes do último handler, para
// que limitadores e requireAuth continuem vindo primeiro.
export function defineRoute(router, spec, ...handlers) {
  assertSpec(spec);
  if (!handlers.length) throw new TypeError(`defineRoute ${spec.method.toUpperCase()} ${spec.path}: handler obrigatório.`);
  const frozen = Object.freeze({ ...spec, errors: Object.freeze([...(spec.errors || [])]) });
  const finalHandler = handlers[handlers.length - 1];
  const before = router.stack.length;
  router[spec.method](spec.path, ...handlers.slice(0, -1), contractValidator(frozen), finalHandler);
  const layer = router.stack[before];
  if (!layer?.route) throw new Error(`defineRoute ${spec.method.toUpperCase()} ${spec.path}: não foi possível localizar a rota criada.`);
  const contracts = layer.route[CONTRACT_KEY] || {};
  contracts[spec.method] = frozen;
  layer.route[CONTRACT_KEY] = contracts;
  return router;
}

export function contractOfRoute(route, method) {
  return route?.[CONTRACT_KEY]?.[method] || null;
}

export function isWriteMethod(method) {
  return WRITE_METHODS.has(method);
}
