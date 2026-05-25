import prisma from './prisma.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_JOB_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DATA_RETENTION_ADVISORY_LOCK_ID = 2026052217;
const DEFAULT_RETENTION_BATCH_SIZE = 500;
const DEFAULT_RETENTION_MAX_BATCHES_PER_TARGET = 20;

export function retentionCutoffs(now = new Date()) {
  return {
    now,
    auditLogAnonymizeBefore: new Date(now.getTime() - 730 * DAY_MS),
    surveyEvidenceAnonymizeBefore: new Date(now.getTime() - 365 * DAY_MS),
    abandonedDraftDeleteBefore: new Date(now.getTime() - 183 * DAY_MS)
  };
}

export function retentionTargets(cutoffs) {
  return {
    expiredSessions: { expiresAt: { lt: cutoffs.now } },
    expiredPasswordTokens: { expiresAt: { lt: cutoffs.now } },
    reportAuditLogs: {
      createdAt: { lt: cutoffs.auditLogAnonymizeBefore },
      OR: [{ ipAddress: { not: null } }, { userAgent: { not: null } }]
    },
    epiAuditLogs: {
      createdAt: { lt: cutoffs.auditLogAnonymizeBefore },
      OR: [{ ipAddress: { not: null } }, { userAgent: { not: null } }]
    },
    satisfactionSurveys: {
      respondedAt: { lt: cutoffs.surveyEvidenceAnonymizeBefore },
      OR: [{ submittedIp: { not: null } }, { submittedUserAgent: { not: null } }]
    },
    abandonedDrafts: { updatedAt: { lt: cutoffs.abandonedDraftDeleteBefore } }
  };
}

function normalizeIdList(value) {
  const values = Array.isArray(value) ? value : [];
  return Array.from(new Set(values.map(item => String(item || '').trim()).filter(Boolean)));
}

export function abandonedDraftExplicitDeleteWhere(targets, draftIds) {
  const ids = normalizeIdList(draftIds);
  if (!ids.length) return null;
  return {
    AND: [
      targets.abandonedDrafts,
      { id: { in: ids } }
    ]
  };
}

export async function previewDataRetention({ prismaClient = prisma, now = new Date(), abandonedDraftPreviewLimit = 100 } = {}) {
  const cutoffs = retentionCutoffs(now);
  const targets = retentionTargets(cutoffs);

  const [
    expiredSessions,
    expiredPasswordTokens,
    reportAuditLogs,
    epiAuditLogs,
    satisfactionSurveys,
    abandonedDrafts,
    abandonedDraftsToReview
  ] = await Promise.all([
    prismaClient.userSession.count({ where: targets.expiredSessions }),
    prismaClient.passwordResetToken.count({ where: targets.expiredPasswordTokens }),
    prismaClient.reportAuditLog.count({ where: targets.reportAuditLogs }),
    prismaClient.epiSignatureRequestAuditLog.count({ where: targets.epiAuditLogs }),
    prismaClient.satisfactionSurvey.count({ where: targets.satisfactionSurveys }),
    prismaClient.reportDraft.count({ where: targets.abandonedDrafts }),
    prismaClient.reportDraft.findMany({
      where: targets.abandonedDrafts,
      orderBy: { updatedAt: 'asc' },
      take: abandonedDraftPreviewLimit,
      select: {
        id: true,
        userId: true,
        projectId: true,
        title: true,
        updatedAt: true
      }
    })
  ]);

  return {
    now: cutoffs.now.toISOString(),
    auditLogAnonymizeBefore: cutoffs.auditLogAnonymizeBefore.toISOString(),
    surveyEvidenceAnonymizeBefore: cutoffs.surveyEvidenceAnonymizeBefore.toISOString(),
    abandonedDraftDeleteBefore: cutoffs.abandonedDraftDeleteBefore.toISOString(),
    expiredSessions,
    expiredPasswordTokens,
    reportAuditLogsToAnonymize: reportAuditLogs,
    epiAuditLogsToAnonymize: epiAuditLogs,
    satisfactionSurveysToAnonymize: satisfactionSurveys,
    abandonedDraftsToReview: abandonedDrafts,
    abandonedDraftPreviewLimit,
    abandonedDraftIdsToReview: abandonedDraftsToReview.map(draft => draft.id),
    abandonedDraftsToReviewSample: abandonedDraftsToReview
  };
}

function retentionRunCutoffSnapshot(cutoffs) {
  return {
    now: cutoffs.now.toISOString(),
    auditLogAnonymizeBefore: cutoffs.auditLogAnonymizeBefore.toISOString(),
    surveyEvidenceAnonymizeBefore: cutoffs.surveyEvidenceAnonymizeBefore.toISOString(),
    abandonedDraftDeleteBefore: cutoffs.abandonedDraftDeleteBefore.toISOString()
  };
}

function retentionErrorMessage(error) {
  return String(error?.message || error || 'Falha ao executar retenção de dados.').slice(0, 1000);
}

async function acquireDataRetentionLock(tx) {
  if (typeof tx.$executeRawUnsafe !== 'function') return;
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${DATA_RETENTION_ADVISORY_LOCK_ID})`);
}

function batchWhere(where, ids) {
  return {
    AND: [
      where,
      { id: { in: ids } }
    ]
  };
}

async function processRetentionBatches({
  prismaClient,
  modelName,
  where,
  orderBy,
  action,
  data,
  batchSize,
  maxBatchesPerTarget
}) {
  let count = 0;
  let batches = 0;

  for (let index = 0; index < maxBatchesPerTarget; index += 1) {
    const candidates = await prismaClient[modelName].findMany({
      where,
      orderBy,
      take: batchSize,
      select: { id: true }
    });
    const ids = candidates.map(item => item.id).filter(Boolean);
    if (!ids.length) break;

    const result = await prismaClient.$transaction(async tx => {
      await acquireDataRetentionLock(tx);
      if (action === 'delete') {
        return tx[modelName].deleteMany({ where: batchWhere(where, ids) });
      }
      return tx[modelName].updateMany({ where: batchWhere(where, ids), data });
    });
    count += result.count;
    batches += 1;
    if (ids.length < batchSize) break;
  }

  return { count, batches };
}

async function executeRetentionMutations(prismaClient, targets, {
  deleteAbandonedDrafts,
  abandonedDraftIds,
  batchSize,
  maxBatchesPerTarget
}) {
  const expiredSessions = await processRetentionBatches({
    prismaClient,
    modelName: 'userSession',
    where: targets.expiredSessions,
    orderBy: { expiresAt: 'asc' },
    action: 'delete',
    batchSize,
    maxBatchesPerTarget
  });
  const expiredPasswordTokens = await processRetentionBatches({
    prismaClient,
    modelName: 'passwordResetToken',
    where: targets.expiredPasswordTokens,
    orderBy: { expiresAt: 'asc' },
    action: 'delete',
    batchSize,
    maxBatchesPerTarget
  });
  const reportAuditLogs = await processRetentionBatches({
    prismaClient,
    modelName: 'reportAuditLog',
    where: targets.reportAuditLogs,
    orderBy: { createdAt: 'asc' },
    action: 'update',
    data: { ipAddress: null, userAgent: null },
    batchSize,
    maxBatchesPerTarget
  });
  const epiAuditLogs = await processRetentionBatches({
    prismaClient,
    modelName: 'epiSignatureRequestAuditLog',
    where: targets.epiAuditLogs,
    orderBy: { createdAt: 'asc' },
    action: 'update',
    data: { ipAddress: null, userAgent: null },
    batchSize,
    maxBatchesPerTarget
  });
  const satisfactionSurveys = await processRetentionBatches({
    prismaClient,
    modelName: 'satisfactionSurvey',
    where: targets.satisfactionSurveys,
    orderBy: { respondedAt: 'asc' },
    action: 'update',
    data: { submittedIp: null, submittedUserAgent: null },
    batchSize,
    maxBatchesPerTarget
  });
  const explicitDraftDeleteWhere = deleteAbandonedDrafts
    ? abandonedDraftExplicitDeleteWhere(targets, abandonedDraftIds)
    : null;
  const abandonedDraftsToDelete = explicitDraftDeleteWhere
    ? await prismaClient.reportDraft.findMany({
      where: explicitDraftDeleteWhere,
      orderBy: { updatedAt: 'asc' },
      take: batchSize,
      select: { id: true }
    })
    : [];
  const abandonedDraftIdsDeleted = abandonedDraftsToDelete.map(draft => draft.id);
  const abandonedDrafts = abandonedDraftIdsDeleted.length
    ? await prismaClient.$transaction(async tx => {
      await acquireDataRetentionLock(tx);
      return tx.reportDraft.deleteMany({ where: batchWhere(explicitDraftDeleteWhere, abandonedDraftIdsDeleted) });
    })
    : { count: 0 };

  const summary = {
    expiredSessions: expiredSessions.count,
    expiredPasswordTokens: expiredPasswordTokens.count,
    reportAuditLogsAnonymized: reportAuditLogs.count,
    epiAuditLogsAnonymized: epiAuditLogs.count,
    satisfactionSurveysAnonymized: satisfactionSurveys.count,
    abandonedDraftsDeleted: abandonedDrafts.count,
    abandonedDraftIdsDeleted,
    abandonedDraftDeletionRequiresExplicitIds: deleteAbandonedDrafts && !explicitDraftDeleteWhere,
    batches: {
      expiredSessions: expiredSessions.batches,
      expiredPasswordTokens: expiredPasswordTokens.batches,
      reportAuditLogs: reportAuditLogs.batches,
      epiAuditLogs: epiAuditLogs.batches,
      satisfactionSurveys: satisfactionSurveys.batches,
      abandonedDrafts: abandonedDraftIdsDeleted.length ? 1 : 0
    },
    batchSize,
    maxBatchesPerTarget
  };

  return summary;
}

export async function runDataRetention({
  prismaClient = prisma,
  now = new Date(),
  logger = console,
  deleteAbandonedDrafts = false,
  abandonedDraftIds = [],
  batchSize = DEFAULT_RETENTION_BATCH_SIZE,
  maxBatchesPerTarget = DEFAULT_RETENTION_MAX_BATCHES_PER_TARGET
} = {}) {
  if (typeof prismaClient.$transaction !== 'function') {
    throw new Error('Retenção de dados requer transação para evitar mutação parcial.');
  }

  const cutoffs = retentionCutoffs(now);
  const targets = retentionTargets(cutoffs);
  const run = await prismaClient.dataRetentionRun.create({
    data: {
      mode: 'APPLY',
      status: 'RUNNING',
      deleteAbandonedDrafts,
      summary: {
        requestedAbandonedDraftIds: normalizeIdList(abandonedDraftIds),
        batchSize,
        maxBatchesPerTarget
      },
      cutoffs: retentionRunCutoffSnapshot(cutoffs),
      startedAt: now
    }
  });

  try {
    const summary = await executeRetentionMutations(prismaClient, targets, {
      deleteAbandonedDrafts,
      abandonedDraftIds,
      batchSize,
      maxBatchesPerTarget
    });
    await prismaClient.dataRetentionRun.update({
      where: { id: run.id },
      data: {
        status: 'COMPLETED',
        finishedAt: new Date(),
        summary,
        error: null
      }
    });

    const changed = Object.values(summary).some(count => count > 0);
    if (changed) logger.info('Retenção de dados executada.', summary);
    return summary;
  } catch (error) {
    await prismaClient.dataRetentionRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        error: retentionErrorMessage(error)
      }
    }).catch(updateError => {
      logger.error('Falha ao registrar execução de retenção com erro.', updateError);
    });
    throw error;
  }
}

export function shouldStartDataRetentionJob({ enabled = false } = {}) {
  return enabled === true;
}

export function startDataRetentionJob({ logger = console, enabled = false } = {}) {
  if (!shouldStartDataRetentionJob({ enabled })) return null;

  const run = () => {
    runDataRetention({ logger }).catch(error => {
      logger.error('Falha no job de retenção de dados.', error);
    });
  };
  run();
  const timer = setInterval(run, RETENTION_JOB_INTERVAL_MS);
  timer.unref?.();
  return timer;
}
