import fs from 'node:fs/promises';

import env from '../../config/env.js';
import prisma from '../prisma.js';
import { databaseRoleStatus } from './database-role.js';
import { errorTrackingStatus } from './error-tracking.js';
import { abuseFindingLabel, abuseThresholds, detectAbuse, readAbuseWindow } from '../abuse/monitor.js';
import { openAiUsageSummary } from '../abuse/openai-budget.js';
import { legacyProjectWebhookStatus } from '../integrations/legacy-project-webhook-status.js';

export const RECURRING_JOB_NAMES = [
  'assinaturas:finalization',
  'assinaturas:file-purge',
  'survey-reminders',
  'signature-reminders',
  'calibration-reminders',
  'monthly-allocation-report',
  'legacy-zapsign-reconciliation',
  'pontomais-sync'
];

const REPORT_APPROVAL_STATUSES = ['PENDING', 'RUNNING', 'FAILED', 'COMPLETED', 'SKIPPED'];
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Idade máxima aceitável da última execução, por job. Vale como piso sobre a
// regra "3× o intervalo": jobs que só rodam numa janela do dia (lembretes de
// calibração, 9h–10h em Brasília) checam de hora em hora, mas só gravam
// execução uma vez por dia — sem o piso, viravam "sem execução recente" todo
// dia ~3h depois da janela.
const RECURRING_JOB_MAX_AGE_MS = {
  'assinaturas:finalization': 5 * 60_000,
  'assinaturas:file-purge': 5 * 60_000,
  'survey-reminders': 3 * HOUR_MS,
  'signature-reminders': 3 * HOUR_MS,
  'calibration-reminders': 36 * HOUR_MS,
  'monthly-allocation-report': 3 * HOUR_MS,
  'legacy-zapsign-reconciliation': HOUR_MS,
  'pontomais-sync': HOUR_MS
};

function dateToIso(value) {
  return value instanceof Date ? value.toISOString() : value || null;
}

function publicJobRun(run) {
  if (!run) return null;
  return {
    id: run.id,
    name: run.name,
    status: run.status,
    startedAt: dateToIso(run.startedAt),
    finishedAt: dateToIso(run.finishedAt),
    durationMs: run.durationMs,
    metadata: run.metadata || null,
    result: run.result || null,
    error: run.error || null
  };
}

function publicIntegrationSyncRun(run) {
  if (!run) return null;
  return {
    id: run.id,
    integration: run.integration,
    scope: run.scope || null,
    status: run.status,
    recordsRead: run.recordsRead,
    recordsWritten: run.recordsWritten,
    error: run.error || null,
    summary: run.summary || null,
    triggeredBy: run.triggeredBy || null,
    startedAt: dateToIso(run.startedAt),
    finishedAt: dateToIso(run.finishedAt)
  };
}

function publicAccessImport(row) {
  if (!row) return null;
  return {
    id: row.id,
    fileName: row.fileName,
    source: row.source,
    status: row.status,
    rowsRead: row.rowsRead,
    created: row.created,
    updated: row.updated,
    skipped: row.skipped,
    pendingProjectsCreated: row.pendingProjectsCreated,
    error: row.error || null,
    summary: row.summary || null,
    importedByUserId: row.importedByUserId || null,
    createdAt: dateToIso(row.createdAt)
  };
}

function publicJobLock(lock) {
  return {
    name: lock.name,
    owner: lock.owner,
    lockedAt: dateToIso(lock.lockedAt),
    expiresAt: dateToIso(lock.expiresAt)
  };
}

function problem(message, details = {}) {
  return { message, ...details };
}

function dateFrom(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function ageMsSince(value, now) {
  const date = dateFrom(value);
  if (!date) return null;
  return Math.max(0, now.getTime() - date.getTime());
}

function latestRunAgeMs(run, now) {
  return ageMsSince(run?.finishedAt || run?.startedAt, now);
}

function jobMaxAgeMs(job) {
  const configuredMs = RECURRING_JOB_MAX_AGE_MS[job.name] || 0;
  const intervalMs = Number(job.latestRun?.metadata?.intervalMs || 0);
  if (Number.isFinite(intervalMs) && intervalMs > 0) {
    return Math.max(intervalMs * 3, 30 * 60 * 1000, configuredMs);
  }
  return configuredMs || 3 * HOUR_MS;
}

// Uma consulta por job (índice name+startedAt). Antes era uma única listagem
// das últimas N execuções de todos os jobs: os de 15 em 15 min empurravam os
// diários para fora da janela, o job "sumia" do status e o alerta aberto era
// dado como normalizado sem nada ter mudado.
async function latestRecurringJobRuns(prismaClient) {
  const latestRuns = await Promise.all(RECURRING_JOB_NAMES.map(async name => {
    const rows = await prismaClient.jobRun.findMany({
      where: { name },
      orderBy: { startedAt: 'desc' },
      take: 1
    });
    return (rows || []).find(row => row.name === name) || null;
  }));
  return RECURRING_JOB_NAMES.map((name, index) => ({
    name,
    latestRun: publicJobRun(latestRuns[index])
  }));
}

async function dataRetentionStatus(prismaClient) {
  const latestRun = await prismaClient.dataRetentionRun.findFirst({
    orderBy: { startedAt: 'desc' }
  });
  return {
    latestRun: latestRun
      ? {
        id: latestRun.id,
        status: latestRun.status,
        mode: latestRun.mode,
        deleteAbandonedDrafts: latestRun.deleteAbandonedDrafts,
        startedAt: dateToIso(latestRun.startedAt),
        finishedAt: dateToIso(latestRun.finishedAt),
        summary: latestRun.summary || null,
        error: latestRun.error || null
      }
      : null
  };
}

async function reportApprovalQueueStatus(prismaClient) {
  const grouped = await prismaClient.reportApprovalPostProcessingJob.groupBy({
    by: ['status'],
    _count: { _all: true }
  });
  const counts = Object.fromEntries(REPORT_APPROVAL_STATUSES.map(status => [status, 0]));
  for (const item of grouped) {
    counts[item.status] = item._count._all;
  }
  const latestFailed = await prismaClient.reportApprovalPostProcessingJob.findFirst({
    where: { status: 'FAILED' },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      reportId: true,
      attempts: true,
      lockedAt: true,
      completedAt: true,
      error: true,
      createdAt: true,
      updatedAt: true
    }
  });
  return {
    counts,
    latestFailed: latestFailed
      ? {
        ...latestFailed,
        lockedAt: dateToIso(latestFailed.lockedAt),
        completedAt: dateToIso(latestFailed.completedAt),
        createdAt: dateToIso(latestFailed.createdAt),
        updatedAt: dateToIso(latestFailed.updatedAt)
      }
      : null
  };
}

async function activeJobLocks(prismaClient, now) {
  const locks = await prismaClient.jobLock.findMany({
    where: { expiresAt: { gt: now } },
    orderBy: { expiresAt: 'asc' }
  });
  return locks.map(publicJobLock);
}

async function omieSyncStatus(prismaClient, config) {
  const rows = await prismaClient.integrationSyncRun.findMany({
    where: { integration: 'OMIE' },
    orderBy: { startedAt: 'desc' },
    distinct: ['scope']
  });
  const latestRun = rows[0] || null;
  const latestByScope = new Map();
  for (const row of rows) {
    const scope = row.scope || 'unknown';
    if (!latestByScope.has(scope)) latestByScope.set(scope, row);
  }
  const configured = Boolean(config.omieAppKey && config.omieAppSecret);
  return {
    configured,
    enabled: Boolean(config.omieSyncEnabled),
    status: latestRun?.status || (configured ? 'SEM_EXECUCAO' : 'NOT_CONFIGURED'),
    latestRun: publicIntegrationSyncRun(latestRun),
    scopes: Array.from(latestByScope.entries()).map(([scope, run]) => ({
      scope,
      latestRun: publicIntegrationSyncRun(run)
    }))
  };
}

async function commercialImportStatus(prismaClient, config) {
  const latestImport = await prismaClient.accessImport.findFirst({
    orderBy: { createdAt: 'desc' }
  });
  const configured = Boolean(config.commercialImportToken);
  return {
    configured,
    status: latestImport?.status || (configured ? 'SEM_RECEBIMENTO' : 'NOT_CONFIGURED'),
    latestImport: publicAccessImport(latestImport)
  };
}

async function readStatusFile(filePath, { readFile = fs.readFile } = {}) {
  if (!filePath) return { configured: false, status: 'NOT_CONFIGURED' };
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      configured: true,
      status: parsed.status || 'UNKNOWN',
      statusFile: filePath,
      ...parsed
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        configured: true,
        status: 'MISSING',
        statusFile: filePath,
        message: 'Arquivo de status não encontrado.'
      };
    }
    return {
      configured: true,
      status: 'INVALID',
      statusFile: filePath,
      message: error?.message || 'Arquivo de status inválido.'
    };
  }
}

function statusWithAge(rawStatus, { now, maxAgeMs }) {
  const ageMs = ageMsSince(rawStatus.finishedAt || rawStatus.startedAt, now);
  const stale = rawStatus.status === 'SUCCESS'
    && Number.isFinite(ageMs)
    && ageMs > maxAgeMs;
  return {
    ...rawStatus,
    ageMs,
    maxAgeMs,
    status: stale ? 'STALE' : rawStatus.status
  };
}

async function backupStatus({ config, now, readFile }) {
  const rawStatus = await readStatusFile(config.operationsBackupStatusFile, { readFile });
  return statusWithAge(rawStatus, {
    now,
    maxAgeMs: config.operationsBackupMaxAgeHours * HOUR_MS
  });
}

async function restoreStatus({ config, now, readFile }) {
  const rawStatus = await readStatusFile(config.operationsRestoreStatusFile, { readFile });
  return statusWithAge(rawStatus, {
    now,
    maxAgeMs: config.operationsRestoreMaxAgeDays * DAY_MS
  });
}

// Resultado do último deploy-prod.sh (deploy-latest.json). Não envelhece: um
// FAILURE/ROLLED_BACK continua sendo problema até um deploy seguinte dar certo.
async function deployStatus({ config, readFile }) {
  const rawStatus = await readStatusFile(config.operationsDeployStatusFile, { readFile });
  return {
    ...rawStatus,
    ...(rawStatus.sha ? { shortSha: String(rawStatus.sha).slice(0, 12) } : {}),
    ...(rawStatus.previousSha ? { shortPreviousSha: String(rawStatus.previousSha).slice(0, 12) } : {})
  };
}

// Sinais de abuso da janela atual e uso da OpenAI (pilar 10). A tabela
// UsageCounter pode não existir antes da migration: aí a seção fica UNAVAILABLE.
async function abuseStatus(prismaClient, config, now) {
  if (!prismaClient.usageCounter) return { status: 'UNAVAILABLE', findings: [], openai: null };
  try {
    const [rows, openai] = await Promise.all([
      readAbuseWindow({ prismaClient, now, config }),
      openAiUsageSummary({ prismaClient, now, config })
    ]);
    const thresholds = abuseThresholds(config);
    const findings = detectAbuse(rows, thresholds).map(finding => ({ ...finding, label: abuseFindingLabel(finding) }));
    const loginFailures = rows.find(row => row.kind === 'abuse.login-failure' && row.subject === 'global')?.count ?? 0;
    const rateLimited = rows.filter(row => row.kind === 'abuse.rate-limited').reduce((sum, row) => sum + row.count, 0);
    return {
      status: findings.length ? 'ALERT' : 'OK',
      windowMinutes: Math.round(thresholds.windowMs / 60000),
      thresholds,
      loginFailures,
      rateLimited,
      findings: findings.slice(0, 20),
      openai
    };
  } catch (error) {
    return { status: 'UNAVAILABLE', findings: [], openai: null, error: error?.code || 'read-failed' };
  }
}

function abuseProblems(abuse, config) {
  const problems = [];
  for (const finding of abuse?.findings || []) {
    problems.push(problem(`Uso fora do normal: ${finding.label}.`, { scope: 'abuse', source: finding.subject }));
  }
  const openai = abuse?.openai;
  for (const [period, label] of [['day', 'diário'], ['month', 'mensal']]) {
    const data = openai?.[period];
    if (data?.budget && data.tokens >= (data.budget * config.openaiBudgetAlertPercent) / 100) {
      const reached = data.tokens >= data.budget;
      problems.push(problem(reached
        ? `Teto ${label} de tokens da OpenAI atingido; a adequação por IA está bloqueada.`
        : `Uso da OpenAI acima de ${config.openaiBudgetAlertPercent}% do teto ${label}.`, { scope: 'openai-budget' }));
    }
  }
  return problems;
}

function collectProblems({
  recurringJobs,
  dataRetention,
  reportApprovalQueue,
  backup,
  restore,
  deploy = { status: 'NOT_CONFIGURED' },
  omie,
  commercialImport,
  database = { status: 'UNKNOWN' },
  config,
  now
}) {
  const problems = [];
  if (database.status === 'PRIVILEGED' && config.operationsRequireRestrictedDbRole) {
    problems.push(problem('Aplicação conectada ao banco com papel de dono/superusuário.', {
      scope: 'database-role',
      ...(database.user ? { source: database.user } : {})
    }));
  }
  for (const job of recurringJobs) {
    if (job.latestRun?.status === 'FAILED') {
      problems.push(problem('Job recorrente falhou na última execução.', { job: job.name }));
    }
    if (job.latestRun?.status === 'RUNNING') {
      const runningForMs = ageMsSince(job.latestRun.startedAt, now);
      const maxAgeMs = jobMaxAgeMs(job);
      if (Number.isFinite(runningForMs) && runningForMs > maxAgeMs) {
        problems.push(problem('Job recorrente está rodando por tempo acima do esperado.', {
          job: job.name,
          runningForMs,
          maxAgeMs
        }));
      }
    }
    const runAgeMs = latestRunAgeMs(job.latestRun, now);
    const maxAgeMs = jobMaxAgeMs(job);
    if (job.latestRun && Number.isFinite(runAgeMs) && runAgeMs > maxAgeMs) {
      problems.push(problem('Job recorrente sem execução recente.', {
        job: job.name,
        ageMs: runAgeMs,
        maxAgeMs
      }));
    }
  }
  if (dataRetention.latestRun?.status === 'FAILED') {
    problems.push(problem('Retenção de dados falhou na última execução.', { job: 'data-retention' }));
  }
  if ((reportApprovalQueue.counts.FAILED || 0) > 0) {
    problems.push(problem('Fila de pós-processamento de aprovação possui jobs com falha.', {
      job: 'report-approval-post-processing',
      failed: reportApprovalQueue.counts.FAILED
    }));
  }
  if (backup.status === 'FAILURE') {
    problems.push(problem('Backup falhou na última execução.', { backup }));
  }
  if (backup.status === 'STALE') {
    problems.push(problem('Backup está velho demais.', { backup }));
  }
  if (backup.status === 'NOT_CONFIGURED' && config.operationsRequireBackupStatus) {
    problems.push(problem('Status de backup obrigatório não está configurado.', { backup }));
  }
  if (backup.status === 'MISSING' && config.operationsRequireBackupStatus) {
    problems.push(problem('Status de backup obrigatório está ausente.', { backup }));
  }
  if (backup.status === 'INVALID') {
    problems.push(problem('Status de backup está inválido.', { backup }));
  }
  if (restore.status === 'FAILURE') {
    problems.push(problem('Teste/restore falhou na última execução.', { restore }));
  }
  if (restore.status === 'STALE') {
    problems.push(problem('Teste/restore está velho demais.', { restore }));
  }
  if (restore.status === 'NOT_CONFIGURED' && config.operationsRequireRestoreStatus) {
    problems.push(problem('Status de restore obrigatório não está configurado.', { restore }));
  }
  if (restore.status === 'MISSING' && config.operationsRequireRestoreStatus) {
    problems.push(problem('Status de restore obrigatório está ausente.', { restore }));
  }
  if (restore.status === 'INVALID') {
    problems.push(problem('Status de restore está inválido.', { restore }));
  }
  if (deploy.status === 'ROLLED_BACK') {
    problems.push(problem('Último deploy falhou e voltou automaticamente para a versão anterior.', {
      deploy,
      ...(deploy.shortSha ? { source: deploy.shortSha } : {})
    }));
  }
  if (deploy.status === 'FAILURE') {
    problems.push(problem('Último deploy falhou.', {
      deploy,
      ...(deploy.shortSha ? { source: deploy.shortSha } : {})
    }));
  }
  if (deploy.status === 'INVALID') {
    problems.push(problem('Status de deploy está inválido.', { deploy }));
  }
  if ((deploy.status === 'NOT_CONFIGURED' || deploy.status === 'MISSING') && config.operationsRequireDeployStatus) {
    problems.push(problem('Status de deploy obrigatório está ausente.', { deploy }));
  }
  for (const { latestRun } of omie.scopes) {
    if (latestRun?.status !== 'ERROR') continue;
    problems.push(problem('Sincronização Omie falhou na última execução.', {
      job: 'omie-sync',
      integration: 'OMIE',
      scope: latestRun.scope,
      error: latestRun.error
    }));
  }
  if (commercialImport.latestImport?.status === 'ERROR') {
    problems.push(problem('Recebimento do banco comercial falhou na última execução.', {
      job: 'commercial-access-import',
      source: commercialImport.latestImport.source,
      error: commercialImport.latestImport.error
    }));
  }
  if (commercialImport.latestImport?.status === 'PARTIAL') {
    problems.push(problem('Recebimento do banco comercial ficou parcial na última execução.', {
      job: 'commercial-access-import',
      source: commercialImport.latestImport.source
    }));
  }
  return problems;
}

export async function getOperationalStatus({
  prismaClient = prisma,
  now = new Date(),
  config = env,
  readFile = fs.readFile
} = {}) {
  const [
    recurringJobs,
    dataRetention,
    reportApprovalQueue,
    jobLocks,
    backup,
    restore,
    deploy,
    omie,
    commercialImport,
    database,
    abuse,
    legacyProjectWebhook
  ] = await Promise.all([
    latestRecurringJobRuns(prismaClient),
    dataRetentionStatus(prismaClient),
    reportApprovalQueueStatus(prismaClient),
    activeJobLocks(prismaClient, now),
    backupStatus({ config, now, readFile }),
    restoreStatus({ config, now, readFile }),
    deployStatus({ config, readFile }),
    omieSyncStatus(prismaClient, config),
    commercialImportStatus(prismaClient, config),
    databaseRoleStatus(prismaClient),
    abuseStatus(prismaClient, config, now),
    legacyProjectWebhookStatus(prismaClient, config, now)
  ]);

  const problems = collectProblems({
    recurringJobs,
    dataRetention,
    reportApprovalQueue,
    backup,
    restore,
    deploy,
    omie,
    commercialImport,
    database,
    config,
    now
  }).concat(abuseProblems(abuse, config));

  return {
    ok: problems.length === 0,
    generatedAt: now.toISOString(),
    problems,
    jobs: {
      recurring: recurringJobs,
      dataRetention,
      reportApprovalPostProcessing: reportApprovalQueue,
      activeLocks: jobLocks
    },
    backup,
    restore,
    deploy,
    omie,
    commercialImport,
    database,
    abuse,
    legacyProjectWebhook,
    errorTracking: errorTrackingStatus(config),
    alerting: {
      enabled: config.operationsAlertJobEnabled,
      webhookConfigured: Boolean(config.operationsAlertWebhookUrl),
      emailRecipientsConfigured: Array.isArray(config.operationsAlertEmails) ? config.operationsAlertEmails.length : 0,
      intervalMs: config.operationsAlertIntervalMs,
      repeatMs: config.operationsAlertRepeatMs ?? null
    }
  };
}
