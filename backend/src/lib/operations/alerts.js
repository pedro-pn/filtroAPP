import env from '../../config/env.js';
import { runTrackedJob } from '../jobs/runner.js';
import { getOperationalStatus } from './status.js';

function problemLine(problem) {
  const parts = [problem.message];
  if (problem.job) parts.push(`job=${problem.job}`);
  if (problem.backup?.status) parts.push(`backup=${problem.backup.status}`);
  if (problem.restore?.status) parts.push(`restore=${problem.restore.status}`);
  return `- ${parts.join(' ')}`;
}

export function operationalAlertMessage(status) {
  const header = status.ok
    ? 'Status operacional Filtrovali OK'
    : 'Alerta operacional Filtrovali';
  const lines = [
    header,
    `Gerado em: ${status.generatedAt}`
  ];
  if (status.problems?.length) {
    lines.push('', ...status.problems.map(problemLine));
  }
  return lines.join('\n');
}

export async function sendOperationalAlert(status, {
  webhookUrl = env.operationsAlertWebhookUrl,
  fetchFn = globalThis.fetch,
  logger = console
} = {}) {
  if (!webhookUrl) return { sent: false, reason: 'not-configured' };
  if (typeof fetchFn !== 'function') return { sent: false, reason: 'fetch-unavailable' };

  try {
    const response = await fetchFn(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: operationalAlertMessage(status),
        status
      })
    });
    if (!response.ok) {
      return { sent: false, reason: 'http-error', status: response.status };
    }
    return { sent: true };
  } catch (error) {
    logger.warn?.('Falha ao enviar alerta operacional.', error);
    return { sent: false, reason: 'send-error' };
  }
}

export async function runOperationalAlertCheck({
  statusProvider = getOperationalStatus,
  alertSender = sendOperationalAlert
} = {}) {
  const status = await statusProvider();
  if (status.ok) return { ok: true, sent: false, problemCount: 0 };
  const result = await alertSender(status);
  return {
    ok: false,
    sent: result.sent === true,
    reason: result.reason || null,
    problemCount: status.problems.length
  };
}

export function startOperationalAlertJob({
  enabled = env.operationsAlertJobEnabled,
  intervalMs = env.operationsAlertIntervalMs,
  logger = console
} = {}) {
  if (!enabled) return null;

  const run = () => {
    runTrackedJob('operational-alert-check', runOperationalAlertCheck, {
      lockTtlMs: intervalMs * 2,
      metadata: { intervalMs }
    }).catch(error => {
      logger.error('Falha no job de alerta operacional.', error);
    });
  };

  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}
