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
