import { createHash } from 'node:crypto';

import env from '../../config/env.js';
import { appVersion } from './app-version.js';
import { runTrackedJob } from '../jobs/runner.js';
import prisma from '../prisma.js';
import { alertEmailRecipients, sendOperationalStatusEmail } from './alert-email.js';
import { getOperationalStatus } from './status.js';

export const OPERATIONAL_ALERT_JOB_NAME = 'operational-alert-check';

function problemLine(problem) {
  const parts = [problem.message];
  if (problem.job) parts.push(`job=${problem.job}`);
  if (problem.integration) parts.push(`integration=${problem.integration}`);
  if (problem.scope) parts.push(`scope=${problem.scope}`);
  if (problem.source) parts.push(`source=${problem.source}`);
  if (problem.backup?.status) parts.push(`backup=${problem.backup.status}`);
  if (problem.restore?.status) parts.push(`restore=${problem.restore.status}`);
  return `- ${parts.join(' ')}`;
}

export function operationalAlertMessage(status, { kind = status.ok ? 'recovered' : 'alert' } = {}) {
  const header = kind === 'recovered'
    ? 'Status operacional Filtrovali OK'
    : 'Alerta operacional Filtrovali';
  const lines = [
    header,
    `Gerado em: ${status.generatedAt}`
  ];
  if (kind === 'recovered') {
    lines.push('', 'Os problemas do alerta anterior não aparecem mais no status operacional.');
  }
  if (status.problems?.length) {
    lines.push('', ...status.problems.map(problemLine));
  }
  return lines.join('\n');
}

// Identifica o conjunto de problemas sem os campos que mudam a cada execução
// (idade, contadores), para não reenviar o mesmo alerta toda hora.
export function operationalAlertSignature(status) {
  const keys = (status?.problems || [])
    .map(problem => [
      problem.message,
      problem.job,
      problem.integration,
      problem.scope,
      problem.source,
      problem.backup?.status,
      problem.restore?.status
    ].map(value => value ?? '').join('|'))
    .sort();
  return createHash('sha256').update(keys.join('\n')).digest('hex').slice(0, 16);
}

// Decide se o status atual pede um e-mail/webhook:
// - "alert": problema novo, conjunto de problemas mudou, ou o mesmo problema
//   persiste há `repeatMs` desde o último envio;
// - "recovered": voltou ao normal depois de um alerta enviado;
// - "none": nada a avisar.
export function decideOperationalAlert({ status, previous, now = new Date(), repeatMs = env.operationsAlertRepeatMs }) {
  const previousState = previous && typeof previous === 'object' ? previous : null;
  if (status.ok) {
    if (previousState?.alerting) {
      return { action: 'recovered', state: { alerting: false, signature: null, lastSentAt: now.toISOString() } };
    }
    return { action: 'none', state: { alerting: false, signature: null, lastSentAt: previousState?.lastSentAt || null } };
  }

  const signature = operationalAlertSignature(status);
  const lastSentAtMs = Date.parse(previousState?.lastSentAt || '');
  const repeatDue = !Number.isFinite(lastSentAtMs) || now.getTime() - lastSentAtMs >= repeatMs;
  if (!previousState?.alerting || previousState.signature !== signature || repeatDue) {
    return { action: 'alert', state: { alerting: true, signature, lastSentAt: now.toISOString() } };
  }
  return { action: 'none', state: previousState };
}

function emailSubject(status, kind, config) {
  const environment = config.nodeEnv || 'unknown';
  if (kind === 'recovered') return `[filtroAPP ${environment}] Status operacional normalizado`;
  const count = status.problems?.length || 0;
  return `[filtroAPP ${environment}] Alerta operacional: ${count} problema(s)`;
}

function emailText(status, kind, config) {
  const lines = [
    operationalAlertMessage(status, { kind }),
    '',
    `Ambiente: ${config.nodeEnv || 'unknown'}`,
    `Versão: ${appVersion()}`
  ];
  if (config.appUrl) lines.push(`Painel: ${String(config.appUrl).replace(/\/+$/, '')}/operacoes`);
  return lines.join('\n');
}

async function postAlertWebhook(status, kind, { webhookUrl, fetchFn, logger }) {
  if (!webhookUrl) return { sent: false, reason: 'not-configured' };
  if (typeof fetchFn !== 'function') return { sent: false, reason: 'fetch-unavailable' };

  try {
    const response = await fetchFn(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: operationalAlertMessage(status, { kind }),
        kind,
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

export async function sendOperationalAlert(status, {
  kind = status.ok ? 'recovered' : 'alert',
  webhookUrl = env.operationsAlertWebhookUrl,
  recipients = alertEmailRecipients(),
  fetchFn = globalThis.fetch,
  emailSender = sendOperationalStatusEmail,
  logger = console,
  config = env
} = {}) {
  const [webhook, email] = await Promise.all([
    postAlertWebhook(status, kind, { webhookUrl, fetchFn, logger }),
    recipients.length
      ? emailSender({ subject: emailSubject(status, kind, config), text: emailText(status, kind, config) }, { recipients, logger })
      : Promise.resolve({ sent: false, reason: 'not-configured' })
  ]);
  const sent = webhook.sent === true || email.sent === true;
  const configured = webhook.reason !== 'not-configured' || email.reason !== 'not-configured';
  return {
    sent,
    ...(sent ? {} : { reason: configured ? (webhook.reason !== 'not-configured' ? webhook.reason : email.reason) : 'not-configured' }),
    webhook,
    email
  };
}

// Último estado gravado pelo próprio job (no resultado do JobRun), para que o
// controle de repetição sobreviva a reinícios e valha entre API e worker.
export async function latestOperationalAlertState({ prismaClient = prisma } = {}) {
  const run = await prismaClient.jobRun.findFirst({
    where: { name: OPERATIONAL_ALERT_JOB_NAME, status: 'COMPLETED' },
    orderBy: { startedAt: 'desc' },
    select: { result: true }
  });
  return run?.result?.alertState || null;
}

export async function runOperationalAlertCheck({
  statusProvider = getOperationalStatus,
  alertSender = sendOperationalAlert,
  previousStateProvider = latestOperationalAlertState,
  now = new Date(),
  repeatMs = env.operationsAlertRepeatMs,
  logger = console
} = {}) {
  const status = await statusProvider();
  let previous = null;
  try {
    previous = await previousStateProvider();
  } catch (error) {
    logger.warn?.('Não foi possível ler o último estado do alerta operacional.', error?.message || error);
  }

  const decision = decideOperationalAlert({ status, previous, now, repeatMs });
  const problemCount = status.problems?.length || 0;
  if (decision.action === 'none') {
    return { ok: status.ok, sent: false, reason: null, problemCount, alertState: decision.state };
  }

  const result = await alertSender(status, { kind: decision.action });
  const delivered = result.sent === true;
  // Se nenhum canal configurado conseguiu entregar, mantém o estado anterior
  // para tentar de novo na próxima execução.
  const keepPrevious = !delivered && result.reason !== 'not-configured';
  return {
    ok: status.ok,
    sent: delivered,
    kind: decision.action,
    reason: result.reason || null,
    problemCount,
    alertState: keepPrevious ? (previous || { alerting: false, signature: null, lastSentAt: null }) : decision.state
  };
}

export function startOperationalAlertJob({
  enabled = env.operationsAlertJobEnabled,
  intervalMs = env.operationsAlertIntervalMs,
  logger = console
} = {}) {
  if (!enabled) return null;

  const run = () => {
    runTrackedJob(OPERATIONAL_ALERT_JOB_NAME, runOperationalAlertCheck, {
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
