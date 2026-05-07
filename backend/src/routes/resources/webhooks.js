import { ClientReviewAction, ReportStatus } from '@prisma/client';
import { Router } from 'express';

import asyncHandler from '../../lib/async-handler.js';
import prisma from '../../lib/prisma.js';
import { getZapSignDocument, verifyWebhookSignature } from '../../lib/zapsign.js';
import { buildZapSignSignatureProgress, ZAPSIGN_BATCH_DOC_TOKENS_KEY, ZAPSIGN_SIGNATURE_PROGRESS_KEY } from '../../lib/zapsign-progress.js';

const router = Router();

function payloadDocToken(body) {
  return String(
    body?.token ||
    body?.doc_token ||
    body?.document_token ||
    body?.document?.token ||
    ''
  ).trim();
}

function payloadStatus(body) {
  return String(
    body?.status ||
    body?.event_type ||
    body?.event ||
    body?.document?.status ||
    ''
  ).trim().toLowerCase();
}

function signedTimestamp(body, details) {
  const raw =
    body?.signed_at ||
    body?.document?.signed_at ||
    details?.raw?.signed_at ||
    details?.raw?.updated_at ||
    null;
  const parsed = raw ? new Date(raw) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function persistSignatureProgress(tx, tokens, progress, extraData = {}) {
  if (!progress?.total) return;
  const uniqueTokens = Array.from(new Set(tokens.map(token => String(token || '').trim()).filter(Boolean)));
  if (!uniqueTokens.length) return;

  const reports = await tx.report.findMany({
    where: { zapsignDocToken: { in: uniqueTokens } },
    select: { id: true, specialConditions: true }
  });

  for (const item of reports) {
    await tx.report.update({
      where: { id: item.id },
      data: {
        ...extraData,
        specialConditions: {
          ...(item.specialConditions || {}),
          [ZAPSIGN_SIGNATURE_PROGRESS_KEY]: progress
        }
      }
    });
  }
}

router.post('/zapsign', asyncHandler(async (req, res) => {
  verifyWebhookSignature(req.headers);

  const docToken = payloadDocToken(req.body);
  if (!docToken) {
    return res.status(400).json({ error: 'Webhook ZapSign sem token do documento.' });
  }

  const report = await prisma.report.findFirst({
    where: { zapsignDocToken: docToken },
    include: {
      project: true,
      clientReviews: {
        orderBy: { createdAt: 'desc' }
      }
    }
  });

  if (!report) {
    return res.status(202).json({ ok: true, ignored: true });
  }

  const status = payloadStatus(req.body);
  const details = await getZapSignDocument(docToken);
  const finalStatus = String(details?.status || status).toLowerCase();
  const progress = buildZapSignSignatureProgress(details, req.body);
  const extraDocs = Array.isArray(details?.extraDocs) ? details.extraDocs : [];
  const batchTokens = Array.isArray(report.specialConditions?.[ZAPSIGN_BATCH_DOC_TOKENS_KEY])
    ? report.specialConditions[ZAPSIGN_BATCH_DOC_TOKENS_KEY]
    : [];
  const relatedTokens = [docToken, ...extraDocs.map(item => item.token), ...batchTokens];

  if (finalStatus !== 'signed') {
    await prisma.$transaction(async tx => {
      await persistSignatureProgress(tx, relatedTokens, progress);
    });
    return res.status(202).json({ ok: true, ignored: true, status: finalStatus || status || 'unknown' });
  }

  const approvedReview = (report.clientReviews || []).find(item => item.action === ClientReviewAction.APPROVED);
  const clientUser = approvedReview
    ? null
    : await prisma.user.findFirst({
        where: {
          role: 'CLIENT',
          username: { equals: report.project?.clientCnpj || '', mode: 'insensitive' }
        },
        select: { id: true }
      });

  await prisma.$transaction(async tx => {
    await tx.report.update({
      where: { id: report.id },
      data: {
        status: ReportStatus.SIGNED,
        zapsignSignedAt: signedTimestamp(req.body, details),
        zapsignDocUrl: details?.signedFile || report.zapsignDocUrl || null,
        ...(progress.total ? {
          specialConditions: {
            ...(report.specialConditions || {}),
            [ZAPSIGN_SIGNATURE_PROGRESS_KEY]: progress
          }
        } : {})
      }
    });

    if (!approvedReview && clientUser?.id) {
      await tx.clientReportReview.create({
        data: {
          reportId: report.id,
          clientUserId: clientUser.id,
          action: ClientReviewAction.APPROVED,
          comment: 'Assinado digitalmente via ZapSign.',
          ipAddress: null,
          userAgent: 'ZapSign Webhook'
        }
      });
    }

    for (const extraDoc of extraDocs) {
      const extraReports = await tx.report.findMany({
        where: { zapsignDocToken: extraDoc.token },
        select: { id: true, specialConditions: true }
      });
      for (const extraReport of extraReports) {
        await tx.report.update({
          where: { id: extraReport.id },
          data: {
            status: ReportStatus.SIGNED,
            zapsignSignedAt: signedTimestamp(req.body, details),
            zapsignDocUrl: extraDoc.signedFile || null,
            ...(progress.total ? {
              specialConditions: {
                ...(extraReport.specialConditions || {}),
                [ZAPSIGN_SIGNATURE_PROGRESS_KEY]: progress
              }
            } : {})
          }
        });
      }
    }

    await persistSignatureProgress(tx, relatedTokens, progress);
  });

  res.json({ ok: true });
}));

export default router;
