// Chamadas HTTP a serviços externos com prazo máximo e, quando a operação é
// segura para repetir, nova tentativa com intervalo crescente.

const RETRYABLE_STATUS = new Set([502, 503, 504]);
const DEFAULT_RETRY_DELAYS_MS = [1000, 3000];

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function isTimeoutError(error) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError';
}

function hostOf(url) {
  try {
    return new URL(String(url)).host;
  } catch {
    return 'serviço externo';
  }
}

function timeoutError(url, timeoutMs, cause) {
  const error = new Error(`Tempo esgotado (${timeoutMs} ms) ao chamar ${hostOf(url)}.`);
  error.name = 'OutboundTimeoutError';
  error.code = 'OUTBOUND_TIMEOUT';
  error.statusCode = 504;
  error.cause = cause;
  return error;
}

/**
 * fetch com prazo. O sinal cobre a requisição e a leitura do corpo, então o
 * chamador deve ler a resposta logo em seguida.
 *
 * @param {string|URL} url
 * @param {RequestInit} [init]
 * @param {object} [options]
 * @param {number} options.timeoutMs  prazo por tentativa
 * @param {number} [options.retries=0]  novas tentativas (só para operações idempotentes)
 * @param {number[]} [options.retryDelaysMs]  espera antes de cada nova tentativa
 * @param {(response: Response) => boolean} [options.retryOnResponse]  repetir também nessa resposta
 */
export async function fetchWithTimeout(url, init = {}, {
  timeoutMs,
  retries = 0,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  retryOnResponse = response => RETRYABLE_STATUS.has(response.status),
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('fetchWithTimeout exige timeoutMs positivo.');
  }

  const maxAttempts = 1 + Math.max(0, retries);
  for (let attempt = 1; ; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
    let response;
    try {
      response = await fetchImpl(url, { ...init, signal });
    } catch (error) {
      // Cancelamento pedido pelo chamador não é repetido.
      if (init.signal?.aborted) throw error;
      const normalized = isTimeoutError(error) ? timeoutError(url, timeoutMs, error) : error;
      if (attempt >= maxAttempts) throw normalized;
      await sleep(retryDelaysMs[Math.min(attempt - 1, retryDelaysMs.length - 1)] ?? 0);
      continue;
    }

    if (attempt < maxAttempts && retryOnResponse(response)) {
      await response.body?.cancel?.().catch(() => {});
      await sleep(retryDelaysMs[Math.min(attempt - 1, retryDelaysMs.length - 1)] ?? 0);
      continue;
    }
    return response;
  }
}

// --- Nova tentativa genérica (spec 042, critério 7.5) -------------------------

const RETRYABLE_ERROR_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE', 'ENOTFOUND',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'OUTBOUND_TIMEOUT']);
export const RETRYABLE_HTTP_STATUS = new Set([429, 502, 503, 504]);

/**
 * Falha transitória: rede, prazo esgotado ou HTTP 429/502/503/504. Erros 4xx
 * (exceto 429) e erros de contrato nunca são repetidos.
 */
export function isRetryableError(error) {
  if (!error) return false;
  if (RETRYABLE_HTTP_STATUS.has(Number(error.statusCode ?? error.status))) return true;
  if (Number.isFinite(Number(error.statusCode ?? error.status))) return false;
  if (['TimeoutError', 'OutboundTimeoutError'].includes(error.name)) return true;
  const code = error.code || error.cause?.code;
  if (RETRYABLE_ERROR_CODES.has(code)) return true;
  // fetch do Node sinaliza falha de rede como TypeError("fetch failed").
  return error.name === 'TypeError' && /fetch failed/i.test(String(error.message));
}

/** Retry-After (segundos ou data HTTP) em milissegundos, ou null. */
export function retryAfterMs(value, now = Date.now()) {
  if (value === null || value === undefined || value === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(String(value));
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function backoffDelay(attempt, { baseMs, maxMs, jitter, random }) {
  const exponential = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  // "Equal jitter": metade fixa + metade aleatória, para não sincronizar vários processos.
  return jitter ? exponential / 2 + random() * (exponential / 2) : exponential;
}

/**
 * Repete `fn` em falha transitória, com espera exponencial e jitter.
 *
 * - `retryOnError(error)`: padrão isRetryableError (não repete 4xx, exceto 429);
 * - `retryOnResult(result)`: repete também quando o resultado indica falha
 *   transitória (ex.: Response 503). Na última tentativa o resultado é devolvido
 *   como veio, para o chamador tratar o erro do jeito de sempre;
 * - `discardResult(result)`: libera o resultado descartado (ex.: cancelar o corpo);
 * - Retry-After (em `error.retryAfterMs` ou no cabeçalho da Response) aumenta a
 *   espera, limitada a `maxMs`;
 * - um `signal` abortado pelo chamador interrompe sem nova tentativa.
 */
export async function withRetry(fn, {
  attempts = 3,
  baseMs = 500,
  maxMs = 5000,
  jitter = true,
  retryOnError = isRetryableError,
  retryOnResult = null,
  discardResult = null,
  signal = null,
  sleep = defaultSleep,
  random = Math.random,
  onRetry = null
} = {}) {
  const maxAttempts = Math.max(1, Math.floor(attempts));
  for (let attempt = 1; ; attempt += 1) {
    let result;
    try {
      result = await fn(attempt);
    } catch (error) {
      if (attempt >= maxAttempts || signal?.aborted || !retryOnError(error)) throw error;
      const wait = Math.max(backoffDelay(attempt, { baseMs, maxMs, jitter, random }), Math.min(maxMs, error.retryAfterMs ?? 0));
      onRetry?.({ attempt, wait, error });
      await sleep(wait);
      continue;
    }
    if (retryOnResult && attempt < maxAttempts && !signal?.aborted && retryOnResult(result)) {
      const hinted = retryAfterMs(result?.headers?.get?.('retry-after'));
      await discardResult?.(result);
      const wait = Math.max(backoffDelay(attempt, { baseMs, maxMs, jitter, random }), Math.min(maxMs, hinted ?? 0));
      onRetry?.({ attempt, wait, status: result?.status });
      await sleep(wait);
      continue;
    }
    return result;
  }
}
