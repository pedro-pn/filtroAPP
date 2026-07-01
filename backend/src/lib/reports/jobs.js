import prisma from '../prisma.js';

export const REPORT_APPROVAL_JOB_STATUS = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  FAILED: 'FAILED',
  COMPLETED: 'COMPLETED',
  SKIPPED: 'SKIPPED'
};

const REPORT_APPROVAL_JOB_STALE_MS = 15 * 60 * 1000;
const REPORT_APPROVAL_JOB_INTERVAL_MS = 10 * 1000;

let reportApprovalJobRunning = false;
let reportApprovalJobScheduled = false;
let reportApprovalJobProcessor = null;

export function configureReportApprovalPostProcessingProcessor(processor) {
  if (typeof processor !== 'function') {
    throw new TypeError('Report approval post-processing processor must be a function.');
  }
  reportApprovalJobProcessor = processor;
}

function approvalJobRunnableWhere(staleCutoff) {
  return {
    OR: [
      { status: REPORT_APPROVAL_JOB_STATUS.PENDING },
      {
        status: REPORT_APPROVAL_JOB_STATUS.FAILED,
        OR: [
          { lockedAt: null },
          { lockedAt: { lt: staleCutoff } }
        ]
      },
      {
        status: REPORT_APPROVAL_JOB_STATUS.RUNNING,
        lockedAt: { lt: staleCutoff }
      }
    ]
  };
}

export function reportApprovalJobErrorText(error) {
  return String(error?.stack || error?.message || error || 'Falha no pós-processamento da aprovação.').slice(0, 4000);
}

export async function enqueueReportApprovalPostProcessingJob(client, {
  reportId,
  approvedTransition,
  wasClientRejection,
  reviewedByUserId,
  evidence
}) {
  await client.reportApprovalPostProcessingJob.upsert({
    where: { reportId },
    create: {
      reportId,
      approvedTransition,
      wasClientRejection,
      reviewedByUserId,
      evidence: evidence || {},
      status: REPORT_APPROVAL_JOB_STATUS.PENDING
    },
    update: {
      approvedTransition,
      wasClientRejection,
      reviewedByUserId,
      evidence: evidence || {},
      status: REPORT_APPROVAL_JOB_STATUS.PENDING,
      lockedAt: null,
      completedAt: null,
      error: null,
      attempts: 0
    }
  });
}

async function claimReportApprovalPostProcessingJob(now = new Date()) {
  const where = approvalJobRunnableWhere(new Date(now.getTime() - REPORT_APPROVAL_JOB_STALE_MS));
  const candidate = await prisma.reportApprovalPostProcessingJob.findFirst({
    where,
    orderBy: [{ createdAt: 'asc' }]
  });
  if (!candidate) return null;

  const claimed = await prisma.reportApprovalPostProcessingJob.updateMany({
    where: { id: candidate.id, ...where },
    data: {
      status: REPORT_APPROVAL_JOB_STATUS.RUNNING,
      lockedAt: now,
      error: null,
      attempts: { increment: 1 }
    }
  });
  if (claimed.count !== 1) return null;

  return prisma.reportApprovalPostProcessingJob.findUnique({ where: { id: candidate.id } });
}

export async function completeReportApprovalPostProcessingJob(job, status, data = {}) {
  await prisma.reportApprovalPostProcessingJob.update({
    where: { id: job.id },
    data: {
      status,
      lockedAt: status === REPORT_APPROVAL_JOB_STATUS.FAILED ? new Date() : null,
      completedAt: status === REPORT_APPROVAL_JOB_STATUS.COMPLETED || status === REPORT_APPROVAL_JOB_STATUS.SKIPPED
        ? new Date()
        : null,
      ...data
    }
  });
}

export async function runReportApprovalPostProcessingQueue({ maxJobs = 5 } = {}) {
  if (reportApprovalJobRunning) return 0;
  if (!reportApprovalJobProcessor) {
    throw new Error('Report approval post-processing processor is not configured.');
  }

  reportApprovalJobRunning = true;
  let processed = 0;
  try {
    while (processed < maxJobs) {
      const job = await claimReportApprovalPostProcessingJob();
      if (!job) break;
      await reportApprovalJobProcessor(job);
      processed += 1;
    }
  } finally {
    reportApprovalJobRunning = false;
  }
  return processed;
}

export function scheduleReportApprovalPostProcessing() {
  if (reportApprovalJobScheduled) return;
  reportApprovalJobScheduled = true;
  setImmediate(async () => {
    reportApprovalJobScheduled = false;
    try {
      await runReportApprovalPostProcessingQueue();
    } catch (error) {
      console.error('Falha ao executar fila de pós-processamento de aprovação.', error);
    }
  });
}

export function startReportApprovalPostProcessingJob({ intervalMs = REPORT_APPROVAL_JOB_INTERVAL_MS } = {}) {
  scheduleReportApprovalPostProcessing();
  const timer = setInterval(scheduleReportApprovalPostProcessing, intervalMs);
  timer.unref?.();
  return timer;
}
