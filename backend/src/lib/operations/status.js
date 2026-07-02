import prisma from '../prisma.js';

export const RECURRING_JOB_NAMES = [
  'survey-reminders',
  'signature-reminders',
  'calibration-reminders',
  'monthly-allocation-report',
  'legacy-zapsign-reconciliation'
];

const REPORT_APPROVAL_STATUSES = ['PENDING', 'RUNNING', 'FAILED', 'COMPLETED', 'SKIPPED'];

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

function collectProblems({ recurringJobs, dataRetention, reportApprovalQueue }) {
  const problems = [];
  for (const job of recurringJobs) {
    if (job.latestRun?.status === 'FAILED') {
      problems.push(problem('Job recorrente falhou na última execução.', { job: job.name }));
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
  return problems;
}

export async function getOperationalStatus({ prismaClient = prisma, now = new Date() } = {}) {
  const [
    recurringJobs,
    dataRetention,
    reportApprovalQueue,
    jobLocks
  ] = await Promise.all([
    latestRecurringJobRuns(prismaClient),
    dataRetentionStatus(prismaClient),
    reportApprovalQueueStatus(prismaClient),
    activeJobLocks(prismaClient, now)
  ]);

  const problems = collectProblems({
    recurringJobs,
    dataRetention,
    reportApprovalQueue
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
    backup: {
      status: 'NOT_INTEGRATED',
      message: 'O backup ainda roda por script externo e não publica status consumível pela API.'
    }
  };
}
