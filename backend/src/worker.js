import env from './config/env.js';
import { startBackgroundJobs } from './jobs/background-jobs.js';
import { captureOperationalError } from './lib/operations/error-tracking.js';
import prisma from './lib/prisma.js';

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

process.on('uncaughtExceptionMonitor', error => {
  reportProcessError(error, 'worker.uncaughtException');
});

async function shutdown(signal) {
  console.log(`[worker] encerrando por ${signal}`);
  await prisma.$disconnect().catch(error => console.error('[worker] falha ao desconectar do banco', error));
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

startBackgroundJobs();
console.log(`[worker] jobs iniciados em ${env.nodeEnv}`);
