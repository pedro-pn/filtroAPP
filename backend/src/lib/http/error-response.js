import { randomUUID } from 'node:crypto';

// Formato único de erro da API interna (spec 042, D6):
//   { error: string, code: string, requestId: string, details?: object }
// `error` continua sendo a mensagem em texto que o frontend já mostra
// (frontend/src/api/client.ts lê `response.data.error`); `code` é sempre
// presente; `requestId` é o mesmo do cabeçalho `X-Request-Id`, para cruzar com
// o log. A API pública v1 (/api/integracoes/v1) mantém o formato dela.

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,100}$/;

const CODE_BY_STATUS = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  410: 'GONE',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  423: 'LOCKED',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_ERROR',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
  504: 'GATEWAY_TIMEOUT'
};

export function errorCodeForStatus(status) {
  const numeric = Number(status) || 500;
  if (CODE_BY_STATUS[numeric]) return CODE_BY_STATUS[numeric];
  return numeric >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST';
}

// Garante um id por requisição: reaproveita um `X-Request-Id` válido do cliente
// ou do proxy, senão gera um. Devolve sempre o mesmo id no cabeçalho.
export function requestIdMiddleware(req, res, next) {
  if (!req.requestId) {
    const incoming = String(req.get('x-request-id') || '');
    req.requestId = REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
  }
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

function isV1IntegrationPath(req) {
  return /^\/api\/integracoes\/v1(\/|$)/.test(req.originalUrl || '');
}

// Completa `code` e `requestId` em toda resposta de erro em JSON da API interna
// que já traga `error` em texto — sem mudar a mensagem nem os campos existentes.
export function standardErrorBodyMiddleware(req, res, next) {
  if (isV1IntegrationPath(req)) return next();
  const originalJson = res.json.bind(res);
  res.json = body => {
    if (res.statusCode >= 400 && body && typeof body === 'object' && !Array.isArray(body) && typeof body.error === 'string') {
      return originalJson({
        ...body,
        code: body.code || errorCodeForStatus(res.statusCode),
        requestId: body.requestId || req.requestId || res.getHeader('X-Request-Id') || randomUUID()
      });
    }
    return originalJson(body);
  };
  next();
}

// Para handlers novos ou migrados: um único jeito de responder erro.
export function sendError(res, status, code, message, details) {
  return res.status(status).json({
    error: message,
    code: code || errorCodeForStatus(status),
    ...(details === undefined ? {} : { details })
  });
}
