import { ClientReviewAction, ReportStatus, ReportType } from '@prisma/client';

import prisma from './prisma.js';
import { getZapSignDocument } from './zapsign.js';

const LEGACY_RECONCILIATION_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_RECONCILIATION_LIMIT = 25;
const DEFAULT_RECONCILIATION_SCAN_LIMIT = 100;
let reconciliationTimer = null;
let reconciliationInFlight = false;
let reconciliationOffset = 0;

function normalizedStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function legacySignedTimestamp(details, now = new Date()) {
  const raw =
    details?.raw?.signed_at ||
    details?.raw?.updated_at ||
    details?.raw?.last_signed_at ||
    null;
  const parsed = raw ? new Date(raw) : now;
  return Number.isNaN(parsed.getTime()) ? now : parsed;
}

export function legacyZapSignCompletionData(report, details, now = new Date()) {
  if (!report || report.reportType !== ReportType.RDO) return null;
  if (report.deletedAt || report.project?.deletedAt) return null;
  if (report.status !== ReportStatus.APPROVED) return null;
  if (!report.zapsignDocToken || report.zapsignSignedAt) return null;
  if (normalizedStatus(details?.status) !== 'signed') return null;

  const signedUrl = String(details?.signedFile || '').trim();
  if (!signedUrl) return null;

  return {
    status: ReportStatus.SIGNED,
    zapsignSignedAt: legacySignedTimestamp(details, now),
    zapsignDocUrl: signedUrl
  };
}

async function clientUserForLegacyReport(tx, report) {
  const username = String(report?.project?.clientCnpj || '').trim();
  if (!username) return null;
  return tx.user.findFirst({
    where: {
      role: 'CLIENT',
      username: { equals: username, mode: 'insensitive' }
    },
    select: { id: true }
  });
}

export async function reconcileLegacyZapSignReport(report, {
  prismaClient = prisma,
  getDocument = getZapSignDocument,
  now = new Date()
} = {}) {
  if (!report?.zapsignDocToken || report.zapsignSignedAt || report.status !== ReportStatus.APPROVED) {
    return { reconciled: false, report };
  }

  const details = await getDocument(report.zapsignDocToken);
  const completionData = legacyZapSignCompletionData(report, details, now);
  if (!completionData) return { reconciled: false, report };

  const updated = await prismaClient.$transaction(async tx => {
    const current = await tx.report.findUnique({
      where: { id: report.id },
      include: {
        project: true,
        clientReviews: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });
    if (!current) return null;

    const currentCompletionData = legacyZapSignCompletionData(current, details, now);
    if (!currentCompletionData) return current;

    const approvedReview = (current.clientReviews || []).find(item => item.action === ClientReviewAction.APPROVED);
    const clientUser = approvedReview ? null : await clientUserForLegacyReport(tx, current);

    const signed = await tx.report.update({
      where: { id: current.id },
      data: currentCompletionData
    });

    if (!approvedReview && clientUser?.id) {
      await tx.clientReportReview.create({
        data: {
          reportId: current.id,
          clientUserId: clientUser.id,
          action: ClientReviewAction.APPROVED,
          comment: 'Assinado digitalmente via ZapSign antes da migração para assinatura interna.',
          ipAddress: null,
          userAgent: 'Legacy ZapSign Reconciliation'
        }
      });
    }

    return signed;
  });

  return {
    reconciled: !!updated && updated.status === ReportStatus.SIGNED,
    report: updated ? { ...report, ...updated } : report
  };
}

export async function processPendingLegacyZapSignReports({
  prismaClient = prisma,
  getDocument = getZapSignDocument,
  limit = DEFAULT_RECONCILIATION_LIMIT,
  scanLimit = DEFAULT_RECONCILIATION_SCAN_LIMIT
} = {}) {
  const where = {
    deletedAt: null,
    reportType: ReportType.RDO,
    status: ReportStatus.APPROVED,
    zapsignDocToken: { not: null },
    zapsignSignedAt: null,
    project: { deletedAt: null }
  };
  const totalPending = typeof prismaClient.report.count === 'function'
    ? await prismaClient.report.count({ where })
    : null;
  const safeTotal = Number.isFinite(totalPending) ? totalPending : 0;
  const windowSize = Math.max(scanLimit, limit);
  const skip = safeTotal > windowSize ? reconciliationOffset % Math.max(safeTotal, 1) : 0;
  const take = safeTotal > windowSize
    ? Math.min(windowSize, safeTotal - skip)
    : windowSize;

  let reports = await prismaClient.report.findMany({
    where: {
      ...where
    },
    include: {
      project: true,
      clientReviews: {
        orderBy: { createdAt: 'desc' }
      }
    },
    orderBy: { zapsignRequestedAt: 'asc' },
    skip,
    take
  });
  if (safeTotal > windowSize && reports.length < windowSize && skip > 0) {
    const wrapped = await prismaClient.report.findMany({
      where: {
        ...where
      },
      include: {
        project: true,
        clientReviews: {
          orderBy: { createdAt: 'desc' }
        }
      },
      orderBy: { zapsignRequestedAt: 'asc' },
      take: windowSize - reports.length
    });
    reports = [...reports, ...wrapped];
  }
  if (safeTotal > 0) {
    reconciliationOffset = (skip + windowSize) % safeTotal;
  }

  let reconciled = 0;
  let checked = 0;
  const maxChecks = Math.max(limit, reports.length);
  for (const report of reports) {
    if (checked >= maxChecks) break;
    checked += 1;
    try {
      const result = await reconcileLegacyZapSignReport(report, { prismaClient, getDocument });
      if (result.reconciled) reconciled += 1;
    } catch (error) {
      if (error?.statusCode === 503) {
        console.warn('Reconciliação legada ZapSign ignorada: credenciais de download não configuradas.');
        break;
      }
      console.error('Falha ao reconciliar assinatura legada ZapSign.', { reportId: report.id, error });
    }
  }

  return { checked, reconciled };
}

export function startLegacyZapSignReconciliationJob() {
  if (reconciliationTimer) return reconciliationTimer;

  const run = () => {
    if (reconciliationInFlight) return;
    reconciliationInFlight = true;
    processPendingLegacyZapSignReports()
      .catch(error => {
        console.error('Falha no job de reconciliação legada ZapSign.', error);
      })
      .finally(() => {
        reconciliationInFlight = false;
      });
  };

  const initialTimer = setTimeout(run, 30_000);
  if (typeof initialTimer.unref === 'function') initialTimer.unref();
  reconciliationTimer = setInterval(run, LEGACY_RECONCILIATION_INTERVAL_MS);
  if (typeof reconciliationTimer.unref === 'function') reconciliationTimer.unref();
  return reconciliationTimer;
}
