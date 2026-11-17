import env from '../../config/env.js';
import prisma from '../prisma.js';
import { runTrackedJob } from '../jobs/runner.js';
import { clearCollaboratorDerivedCaches } from '../resource-list-cache.js';
import { reconcileConectaCompany } from './service.js';
import { syncConectaRh } from './sync.js';

export async function runConectaRhJob({ database = prisma, config = env } = {}) {
  if (!config.conectaRhCompanyId) return;
  return runTrackedJob('conecta-rh', async () => {
    try {
      if (config.conectaRhApiUrl && config.conectaRhReadToken) {
        await syncConectaRh({ database, companyId: config.conectaRhCompanyId, apiUrl: config.conectaRhApiUrl,
          token: config.conectaRhReadToken, production: config.nodeEnv === 'production' });
      }
      await database.$transaction(tx => reconcileConectaCompany(tx, config.conectaRhCompanyId), { isolationLevel: 'Serializable', timeout: 15_000 });
      clearCollaboratorDerivedCaches();
      return { summary: 'Recepção de RH conciliada.' };
    } catch {
      // Erros Prisma/fetch podem conter dados de origem; o job registra só texto fixo.
      throw new Error('Falha ao sincronizar RH do Conecta. Verifique configuração e recebimentos pendentes.');
    }
  }, { prismaClient: database, lockTtlMs: 3 * 60 * 60_000 });
}

export function startConectaRhJob() {
  if (!env.conectaRhCompanyId) return;
  const run = () => runConectaRhJob().catch(() => console.error('[conecta-rh] Falha na sincronização. Consulte o estado do job.'));
  const timer = setInterval(run, 5 * 60_000);
  timer.unref();
  void run();
}
