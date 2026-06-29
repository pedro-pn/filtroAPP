import http from 'node:http';

import app from './app.js';
import env from './config/env.js';
import { startMonthlyAllocationReportJob } from './lib/allocation-monthly-report.js';
import { startCalibrationReminderJob } from './lib/calibration-reminders.js';
import { startDataRetentionJob } from './lib/data-retention.js';
import { syncRomaneioCatalog } from './lib/romaneio-catalog.js';
import { startSignatureReminderJob } from './lib/signature-reminders.js';
import { startSurveyReminderJob } from './lib/survey-reminders.js';
import { startLegacyZapSignReconciliationJob } from './lib/zapsign-legacy-reconciliation.js';
import { startReportApprovalPostProcessingJob } from './routes/resources/reports.js';

const server = http.createServer(app);

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
  startDataRetentionJob({ enabled: env.dataRetentionJobEnabled });
  startSurveyReminderJob();
  startSignatureReminderJob();
  startCalibrationReminderJob();
  startMonthlyAllocationReportJob();
  startLegacyZapSignReconciliationJob();
  startReportApprovalPostProcessingJob();
  syncRomaneioCatalog().catch(error => {
    console.error('Falha ao sincronizar catálogo de romaneio na inicialização.', error);
  });
});
