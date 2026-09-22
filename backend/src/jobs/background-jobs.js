import env from '../config/env.js';
import { startMonthlyAllocationReportJob } from '../lib/allocation-monthly-report.js';
import { startAssinaturasJobs } from '../lib/assinaturas/jobs.js';
import { startCalibrationReminderJob } from '../lib/calibration-reminders.js';
import { startDataRetentionJob } from '../lib/data-retention.js';
import { startProjectWorkflowEmailAlertJob } from '../lib/efetivo/project-workflow/email-alerts.js';
import { startOmieSyncJob } from '../lib/omie/sync.js';
import { startOperationalAlertJob } from '../lib/operations/alerts.js';
import { startPontoMaisSyncJob } from '../lib/pontomais/job.js';
import { startReportApprovalPostProcessingJob } from '../lib/reports/jobs.js';
import { syncRomaneioCatalog } from '../lib/romaneio-catalog.js';
import { startSignatureReminderJob } from '../lib/signature-reminders.js';
import { startSurveyReminderJob } from '../lib/survey-reminders.js';
import { startLegacyZapSignReconciliationJob } from '../lib/zapsign-legacy-reconciliation.js';

export function startBackgroundJobs({ keepAlive = false } = {}) {
  startDataRetentionJob({ enabled: env.dataRetentionJobEnabled });
  startSurveyReminderJob();
  startSignatureReminderJob();
  startCalibrationReminderJob();
  startProjectWorkflowEmailAlertJob();
  startMonthlyAllocationReportJob();
  startLegacyZapSignReconciliationJob();
  startOmieSyncJob();
  startPontoMaisSyncJob();
  startReportApprovalPostProcessingJob({ keepAlive });
  startAssinaturasJobs();
  startOperationalAlertJob();
  syncRomaneioCatalog().catch(error => {
    console.error('Falha ao sincronizar catálogo de romaneio na inicialização.', error);
  });
}
