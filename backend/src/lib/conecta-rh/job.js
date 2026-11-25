import env from '../../config/env.js';
import prisma from '../prisma.js';
import { reportJobFailure, runTrackedJob } from '../jobs/runner.js';
import { clearCollaboratorDerivedCaches } from '../resource-list-cache.js';
import { reconcileConectaCompany } from './service.js';
import { syncConectaRh } from './sync.js';

// Uma falha isolada (Conecta instável por alguns minutos) não vira e-mail: o
// alerta sai só quando as últimas N execuções concluídas falharam seguidas
// (CONECTA_RH_ALERT_AFTER_FAILURES, padrão 3 = 15 min). A nova tentativa dentro
// do ciclo fica em syncConectaRh (withRetry).
export function conectaRhFailureReporter({ database = prisma, threshold = env.conectaRhAlertAfterFailures, report = reportJobFailure } = {}) {
  const limit = Number.isInteger(threshold) && threshold > 0 ? threshold : 3;
  return (error, context) => {
    database.jobRun.findMany({
      where: { name: 'conecta-rh', status: { in: ['COMPLETED', 'FAILED'] } },
      orderBy: { startedAt: 'desc' },
      take: limit,
      select: { status: true }
    }).then(recent => {
      if (recent.length >= limit && recent.every(run => run.status === 'FAILED')) report(error, context);
    }).catch(() => report(error, context));
  };
}

export async function runConectaRhJob({ database = prisma, config = env, reportFailure = conectaRhFailureReporter({ database, threshold: config.conectaRhAlertAfterFailures }) } = {}) {
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
  }, { prismaClient: database, lockTtlMs: 3 * 60 * 60_000, reportFailure });
}

export function startConectaRhJob() {
  if (!env.conectaRhCompanyId) return;
  const run = () => runConectaRhJob().catch(() => console.error('[conecta-rh] Falha na sincronização. Consulte o estado do job.'));
  const timer = setInterval(run, 5 * 60_000);
  timer.unref();
  void run();
}
