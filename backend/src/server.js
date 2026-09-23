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

process.on('uncaughtExceptionMonitor', error => {
  reportProcessError(error, 'backend.uncaughtException');
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
  if (env.backgroundJobsInApi) {
    import('./jobs/background-jobs.js')
      .then(({ startBackgroundJobs }) => startBackgroundJobs())
      .catch(error => reportProcessError(error, 'backend.backgroundJobs'));
  }
});
