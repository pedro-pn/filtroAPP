import { startWorkerHealthReporter } from './lib/operations/worker-health.js';
import env from './config/env.js';
import { startBackgroundJobs } from './jobs/background-jobs.js';
import { captureOperationalError } from './lib/operations/error-tracking.js';
import prisma from './lib/prisma.js';
import { warnIfPrivilegedDatabaseRole } from './lib/operations/database-role.js';
// The reports module owns the approval processor implementation and registers it
// during module initialization. The API loads it through the router tree; the
// standalone worker must load it explicitly before starting the queue.
import './routes/resources/reports.js';

function reportProcessError(error, source) {
  captureOperationalError(error, {
    source,
    context: { process: 'worker' }
  }).catch(captureError => {
    console.warn('Falha ao reportar erro operacional do worker.', captureError);
  });
}

process.on('unhandledRejection', reason => {
  reportProcessError(reason instanceof Error ? reason : new Error(String(reason)), 'worker.unhandledRejection');
});

// Com o monitor, o processo caía antes de o alerta sair. Agora o erro é
// reportado (prazo de 5 s) e só então o processo
// encerra com código 1, como antes; o Docker reinicia o container.
const UNCAUGHT_REPORT_TIMEOUT_MS = 5000;
process.on('uncaughtException', error => {
  console.error('[worker] exceção não tratada; encerrando.', error);
  const deadline = new Promise(resolve => setTimeout(resolve, UNCAUGHT_REPORT_TIMEOUT_MS));
  const report = captureOperationalError(error, {
    source: 'worker.uncaughtException',
    context: { process: 'worker' }
  }).catch(() => null);
  Promise.race([report, deadline]).finally(() => process.exit(1));
});

let stopHealthReporter;
async function shutdown(signal) {
  stopHealthReporter?.();
  console.log(`[worker] encerrando por ${signal}`);
  await prisma.$disconnect().catch(error => console.error('[worker] falha ao desconectar do banco', error));
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

stopHealthReporter = startWorkerHealthReporter();
startBackgroundJobs({ keepAlive: true });
if (env.nodeEnv === 'production') {
  warnIfPrivilegedDatabaseRole(prisma, { processName: 'worker' })
    .catch(error => console.warn('[worker] falha ao conferir o papel do banco', error));
}
console.log(`[worker] jobs iniciados em ${env.nodeEnv}`);
