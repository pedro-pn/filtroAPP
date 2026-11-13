import { setTimeout as sleep } from 'node:timers/promises';

const REPEAT_INTERVAL_MS = 61_000;

export function isPurchaseNotFound(error, id) {
  const match = String(error?.body?.faultstring ?? '').match(/Lançamento não cadastrado para o Código \[(\d+)\]/iu);
  return error?.body?.faultcode === 'SOAP-ENV:Client-105' && match?.[1] === String(id);
}

export function isMissingOmiePage(error) {
  if ([401, 403, 425, 429].includes(error?.status)) return false;
  const message = String(error?.body?.faultstring ?? error?.message ?? '');
  if (/REDUNDANT|consumo.*(?:redundante|indevido)/iu.test(message)) return false;
  return /p[áa]gina.*n[ãa]o existe|n[ãa]o (?:existem|h[áa]) registros.*p[áa]gina/iu.test(message);
}

function retryDelay(error) {
  const message = String(error?.body?.faultstring ?? error?.message ?? '');
  const match = message.match(/aguarde\s+(\d+)\s+segundos?/iu);
  if (match) {
    const seconds = Number(match[1]);
    if (!Number.isSafeInteger(seconds) || seconds > 86_400) return null;
    return Math.max(REPEAT_INTERVAL_MS, (seconds + 1) * 1000);
  }
  return error?.status === 425 ? 1_801_000 : REPEAT_INTERVAL_MS;
}

// A Omie impede repetir a mesma consulta por 60 s, inclusive após falhas.
// Esperas ocorrem antes de abrir a transação de publicação do snapshot.
export function createOmiePurchaseReader({ call, requestDelayMs, wait = sleep, now = Date.now }) {
  const attemptedAt = new Map();
  const stats = { apiCalls: 0, retries: 0, cooldownWaitMs: 0 };
  const pause = async (ms, method, params, reason) => {
    stats.cooldownWaitMs += ms;
    const target = params.pagina == null ? `título ${params.codigo_lancamento_omie}` : `página ${params.pagina}`;
    console.warn(`[omie-sync] ${method} ${target}: ${reason}; aguardando ${Math.ceil(ms / 1000)} s.`);
    await wait(ms);
  };
  return {
    stats,
    async read(method, params) {
      const key = JSON.stringify([method, params]);
      for (let attempt = 0; ; attempt++) {
        if (stats.apiCalls && requestDelayMs) await wait(requestDelayMs);
        const previous = attemptedAt.get(key);
        const remaining = previous == null ? 0 : previous + REPEAT_INTERVAL_MS - now();
        if (remaining > 0) await pause(remaining, method, params, 'intervalo entre consultas idênticas');
        stats.apiCalls++;
        try {
          const result = await call('/financas/contapagar/', method, params);
          attemptedAt.set(key, now());
          return result;
        } catch (error) {
          attemptedAt.set(key, now());
          const retryable = [425, 429].includes(error?.status) || error?.status >= 500 || error?.name === 'TypeError';
          if (isPurchaseNotFound(error, params.codigo_lancamento_omie)
            || (method === 'ListarContasPagar' && isMissingOmiePage(error)) || !retryable || attempt >= 2) throw error;
          const delay = retryDelay(error);
          if (delay == null) throw error;
          stats.retries++;
          await pause(delay, method, params, `tentativa ${attempt + 2}/3 após HTTP ${error.status ?? 'indisponível'} (${error.body?.faultcode ?? error.name})`);
        }
      }
    }
  };
}
