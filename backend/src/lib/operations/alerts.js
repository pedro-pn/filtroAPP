import { createHash } from 'node:crypto';

import env from '../../config/env.js';
import { appVersion } from './app-version.js';
import { runTrackedJob } from '../jobs/runner.js';
import prisma from '../prisma.js';
import { buildOperationalEmailTemplate } from '../email-templates.js';
import {
  alertEmailRecipients,
  environmentDisplayName,
  formatAlertDateTime,
  panelUrl,
  redactPersonalData,
  sendOperationalStatusEmail
} from './alert-email.js';
import { getOperationalStatus } from './status.js';

export const OPERATIONAL_ALERT_JOB_NAME = 'operational-alert-check';
const WEBHOOK_TIMEOUT_MS = 5000;

function problemLine(problem) {
  const parts = [problem.message];
  if (problem.job && JOB_LABELS[problem.job]) parts.push(`(${JOB_LABELS[problem.job]})`);
  if (problem.job) parts.push(`job=${problem.job}`);
  if (problem.integration) parts.push(`integration=${problem.integration}`);
  if (problem.scope) parts.push(`scope=${problem.scope}`);
  if (problem.source) parts.push(`source=${problem.source}`);
  if (problem.backup?.status) parts.push(`backup=${problem.backup.status}`);
  if (problem.restore?.status) parts.push(`restore=${problem.restore.status}`);
  if (problem.deploy?.status) {
    parts.push(`deploy=${problem.deploy.status}`);
    if (problem.deploy.shortPreviousSha) parts.push(`no_ar=${problem.deploy.shortPreviousSha}`);
    if (problem.deploy.finishedAt) parts.push(`em=${problem.deploy.finishedAt}`);
    if (problem.deploy.message) parts.push(`motivo="${String(problem.deploy.message).slice(0, 200)}"`);
  }
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
      problem.restore?.status,
      problem.deploy?.status,
      problem.deploy?.sha
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
  const first = status.problems?.[0];
  const detail = count === 1 && first ? ` — ${problemTitle(first)}` : '';
  return `[filtroAPP ${environment}] Alerta operacional: ${count} problema(s)${detail}`;
}

const JOB_LABELS = {
  'assinaturas:finalization': 'Finalização de assinaturas avulsas',
  'assinaturas:file-purge': 'Limpeza de arquivos de assinaturas avulsas',
  'survey-reminders': 'Lembretes de pesquisa de satisfação',
  'signature-reminders': 'Lembretes de assinatura de RDO',
  'calibration-reminders': 'Lembretes de calibração',
  'monthly-allocation-report': 'Relatório mensal de alocação',
  'legacy-zapsign-reconciliation': 'Conciliação ZapSign',
  'pontomais-sync': 'Sincronização Pontomais',
  'omie-sync': 'Sincronização Omie',
  'data-retention': 'Retenção de dados (LGPD)',
  'report-approval-post-processing': 'Pós-processamento de aprovação de RDO',
  'commercial-access-import': 'Recebimento do banco comercial'
};

const OMIE_SCOPE_LABELS = {
  projects: 'Projetos',
  categories: 'Categorias',
  purchases: 'Compras (contas a pagar)',
  invoices: 'Notas fiscais de serviço',
  receivables: 'Contas a receber'
};

function jobLabel(job) {
  return JOB_LABELS[job] || job;
}

function formatDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return '';
  const minutes = Math.round(value / 60000);
  if (minutes < 90) return `${minutes} min`;
  const hours = Math.round(value / 3_600_000);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(value / 86_400_000)} dias`;
}

function fileStatusRows(label, data) {
  if (!data?.status) return [];
  const rows = [[label, data.status]];
  if (data.finishedAt) rows.push([`${label} — fim`, formatAlertDateTime(data.finishedAt)]);
  if (data.message) rows.push([`${label} — detalhe`, redactPersonalData(String(data.message).slice(0, 200))]);
  return rows;
}

function problemTitle(problem) {
  if (problem.job) return jobLabel(problem.job);
  if (problem.scope === 'abuse') return 'Uso fora do normal';
  if (problem.scope === 'openai-budget') return 'Teto da OpenAI';
  if (problem.scope === 'database-role') return 'Papel do banco de dados';
  if (problem.backup) return 'Backup';
  if (problem.restore) return 'Teste de restore';
  if (problem.deploy) return 'Deploy';
  return 'Problema operacional';
}

export function operationalProblemSection(problem) {
  const rows = [];
  if (problem.integration === 'OMIE' && problem.scope) {
    rows.push(['Escopo', OMIE_SCOPE_LABELS[problem.scope] || problem.scope]);
  }
  if (problem.job) rows.push(['Identificador', problem.job]);
  if (Number.isFinite(problem.ageMs)) {
    rows.push(['Última execução', `há ${formatDuration(problem.ageMs)} (limite ${formatDuration(problem.maxAgeMs)})`]);
  }
  if (Number.isFinite(problem.runningForMs)) {
    rows.push(['Rodando há', `${formatDuration(problem.runningForMs)} (limite ${formatDuration(problem.maxAgeMs)})`]);
  }
  if (problem.failed) rows.push(['Itens com falha', String(problem.failed)]);
  if (problem.source && problem.scope !== 'abuse') rows.push(['Origem', problem.source]);
  rows.push(...fileStatusRows('Backup', problem.backup));
  rows.push(...fileStatusRows('Restore', problem.restore));
  if (problem.deploy?.status) {
    rows.push(['Deploy', problem.deploy.status]);
    if (problem.deploy.shortSha) rows.push(['Versão tentada', problem.deploy.shortSha]);
    if (problem.deploy.shortPreviousSha) rows.push(['Versão no ar', problem.deploy.shortPreviousSha]);
    if (problem.deploy.finishedAt) rows.push(['Quando', formatAlertDateTime(problem.deploy.finishedAt)]);
    if (problem.deploy.message) rows.push(['Motivo', redactPersonalData(String(problem.deploy.message).slice(0, 200))]);
  }
  if (problem.error) rows.push(['Mensagem', redactPersonalData(String(problem.error).split('\n')[0].slice(0, 300))]);
  return { title: problemTitle(problem), description: problem.message, rows };
}

function emailHtmlTemplate(status, kind, config, { subject, text }) {
  const problems = status.problems || [];
  const recovered = kind === 'recovered';
  return buildOperationalEmailTemplate({
    subject,
    text,
    tone: recovered ? 'ok' : 'alert',
    title: recovered ? 'Status operacional normalizado' : 'Alerta operacional',
    intro: recovered
      ? 'Os problemas do alerta anterior não aparecem mais no status operacional. Nenhuma ação é necessária.'
      : `${problems.length} problema(s) encontrado(s) na verificação periódica do filtroAPP.`,
    summaryRows: [
      ['Verificado em', formatAlertDateTime(status.generatedAt)],
      ['Ambiente', environmentDisplayName(config)],
      ['Versão', String(appVersion()).slice(0, 12)]
    ],
    sections: problems.map(operationalProblemSection),
    actionUrl: panelUrl(config),
    footer: recovered
      ? 'Aviso gerado automaticamente pelo filtroAPP.'
      : `Enquanto o problema persistir, o aviso se repete a cada ${formatDuration(config.operationsAlertRepeatMs) || 'intervalo configurado'}. Ao normalizar, você recebe um e-mail de confirmação.`
  });
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
      // Um webhook lento não pode segurar o job nem o tratamento do erro.
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
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
      ? emailSender(emailHtmlTemplate(status, kind, config, {
        subject: emailSubject(status, kind, config),
        text: emailText(status, kind, config)
      }), { recipients, logger })
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
