import { ClientReviewAction, ReportStatus } from '@prisma/client';
import { Router } from 'express';

import asyncHandler from '../../lib/async-handler.js';
import prisma from '../../lib/prisma.js';
import { getZapSignDocument, verifyWebhookSignature } from '../../lib/zapsign.js';

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

  if (finalStatus !== 'signed') {
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
        zapsignDocUrl: details?.signedFile || report.zapsignDocUrl || null
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
  });

  res.json({ ok: true });
}));

export default router;
