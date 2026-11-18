import http from 'node:http';

import app from './app.js';
import env from './config/env.js';
import { captureOperationalError } from './lib/operations/error-tracking.js';

const server = http.createServer(app);

function reportProcessError(error, source) {
  captureOperationalError(error, {
    source,
    context: { process: 'backend' }
  }).catch(captureError => {
    console.warn('Falha ao reportar erro operacional do processo.', captureError);
  });
}

process.on('unhandledRejection', reason => {
  reportProcessError(reason instanceof Error ? reason : new Error(String(reason)), 'backend.unhandledRejection');
});

// Com o monitor, o processo caía antes de o alerta sair. Agora o erro é
// reportado (prazo de 5 s) e só então o processo
// encerra com código 1, como antes; o Docker reinicia o container.
const UNCAUGHT_REPORT_TIMEOUT_MS = 5000;
process.on('uncaughtException', error => {
  console.error('[backend] exceção não tratada; encerrando.', error);
  const deadline = new Promise(resolve => setTimeout(resolve, UNCAUGHT_REPORT_TIMEOUT_MS));
  const report = captureOperationalError(error, {
    source: 'backend.uncaughtException',
    context: { process: 'backend' }
  }).catch(() => null);
  Promise.race([report, deadline]).finally(() => process.exit(1));
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `Porta ${env.port} já está em uso. Pare o outro processo Node ou troque o PORT no arquivo backend/.env.`
    );
    process.exit(1);
  }

  console.error(error);
  process.exit(1);
});

server.listen(env.port, () => {
  console.log(`API running on http://localhost:${env.port}`);
  if (!env.surveyTokenSecret) {
    console.warn('[AVISO] SURVEY_TOKEN_SECRET não definido. Os tokens de pesquisa estão usando um fallback inseguro. Defina essa variável em produção.');
  }
  if (env.nodeEnv === 'production') {
    Promise.all([import('./lib/prisma.js'), import('./lib/operations/database-role.js')])
      .then(([{ default: prisma }, { warnIfPrivilegedDatabaseRole }]) => warnIfPrivilegedDatabaseRole(prisma, { processName: 'backend' }))
      .catch(error => console.warn('Falha ao conferir o papel do banco.', error));
  }
  if (env.backgroundJobsInApi) {
    import('./jobs/background-jobs.js')
      .then(({ startBackgroundJobs }) => startBackgroundJobs())
      .catch(error => reportProcessError(error, 'backend.backgroundJobs'));
  }
});
