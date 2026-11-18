import env from '../../config/env.js';
import prisma from '../prisma.js';
import { appVersion } from './app-version.js';

// Verificação de saúde usada pelo healthcheck do Docker e pela rota pública
// /health. Confere o banco com um SELECT 1 de prazo curto. Requisições próximas
// compartilham o mesmo resultado por `cacheMs`, para que chamadas repetidas à
// rota pública não virem carga no banco.

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error('Tempo esgotado na verificação do banco.'), { code: 'HEALTH_DB_TIMEOUT' }));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function createHealthCheck({
  probe = () => prisma.$queryRaw`SELECT 1`,
  timeoutMs = env.healthDbTimeoutMs,
  cacheMs = 2000,
  nowFn = () => Date.now(),
  versionFn = appVersion
} = {}) {
  let cached = null;
  let inFlight = null;

  async function evaluate() {
    try {
      await withTimeout(Promise.resolve().then(probe), timeoutMs);
      return { ok: true, database: 'ok', version: versionFn() };
    } catch (error) {
      return {
        ok: false,
        database: error?.code === 'HEALTH_DB_TIMEOUT' ? 'timeout' : 'unavailable',
        version: versionFn()
      };
    }
  }

  return function check() {
    const now = nowFn();
    if (cached && now - cached.at < cacheMs) return Promise.resolve(cached.result);
    if (!inFlight) {
      inFlight = evaluate()
        .then(result => {
          cached = { at: now, result };
          return result;
        })
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  };
}

export const checkHealth = createHealthCheck();
