import fs from 'node:fs/promises';

import env from '../../config/env.js';
import prisma from '../prisma.js';
import { errorTrackingStatus } from './error-tracking.js';

export const RECURRING_JOB_NAMES = [
  'survey-reminders',
  'signature-reminders',
  'calibration-reminders',
  'monthly-allocation-report',
  'legacy-zapsign-reconciliation'
];

const REPORT_APPROVAL_STATUSES = ['PENDING', 'RUNNING', 'FAILED', 'COMPLETED', 'SKIPPED'];
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const RECURRING_JOB_MAX_AGE_MS = {
  'survey-reminders': 3 * HOUR_MS,
  'signature-reminders': 3 * HOUR_MS,
  'calibration-reminders': 36 * HOUR_MS,
  'monthly-allocation-report': 3 * HOUR_MS,
  'legacy-zapsign-reconciliation': HOUR_MS
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
  const intervalMs = Number(job.latestRun?.metadata?.intervalMs || 0);
  if (Number.isFinite(intervalMs) && intervalMs > 0) return Math.max(intervalMs * 3, 30 * 60 * 1000);
  return RECURRING_JOB_MAX_AGE_MS[job.name] || 3 * HOUR_MS;
}

async function latestRecurringJobRuns(prismaClient) {
  const rows = await prismaClient.jobRun.findMany({
    where: { name: { in: RECURRING_JOB_NAMES } },
    orderBy: { startedAt: 'desc' },
    take: RECURRING_JOB_NAMES.length * 10
  });
  const latestByName = new Map();
  for (const row of rows) {
    if (!latestByName.has(row.name)) latestByName.set(row.name, row);
  }
  return RECURRING_JOB_NAMES.map(name => ({
    name,
    latestRun: publicJobRun(latestByName.get(name) || null)
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

function collectProblems({ recurringJobs, dataRetention, reportApprovalQueue, backup, restore, config, now }) {
  const problems = [];
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
    restore
  ] = await Promise.all([
    latestRecurringJobRuns(prismaClient),
    dataRetentionStatus(prismaClient),
    reportApprovalQueueStatus(prismaClient),
    activeJobLocks(prismaClient, now),
    backupStatus({ config, now, readFile }),
    restoreStatus({ config, now, readFile })
  ]);

  const problems = collectProblems({
    recurringJobs,
    dataRetention,
    reportApprovalQueue,
    backup,
    restore,
    config,
    now
  });

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
    errorTracking: errorTrackingStatus(config),
    alerting: {
      enabled: config.operationsAlertJobEnabled,
      webhookConfigured: Boolean(config.operationsAlertWebhookUrl),
      intervalMs: config.operationsAlertIntervalMs
    }
  };
}
