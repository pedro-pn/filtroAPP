import { Router } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import {
  DATA_SUBJECT_REQUEST_TYPES,
  dataSubjectProtocol,
  dataSubjectRequestPublicShape,
  deletionRequestDetails,
  normalizeDataSubjectRequestType
} from '../../lib/data-subject-requests.js';
import env from '../../config/env.js';
import {
  buildDataSubjectRequestCreatedEmailTemplate,
  buildDataSubjectRequestResponseEmailTemplate
} from '../../lib/email-templates.js';
import { publicUser } from '../../lib/auth.js';
import { getMissingMailerConfig, sendMail } from '../../lib/mailer.js';
import { hasModuleRole } from '../../lib/module-roles.js';
import prisma from '../../lib/prisma.js';
import { createMemoryRateLimit } from '../../lib/rate-limit.js';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();
const PUBLIC_REQUEST_DEDUPE_HOURS = 24;
const RESPONSE_ATTEMPT_STALE_MS = 15 * 60 * 1000;
const publicRequestLimiter = createMemoryRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Muitas solicitações. Tente novamente mais tarde.'
});

const requestSchema = z.object({
  type: z.enum(DATA_SUBJECT_REQUEST_TYPES),
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254),
  identifier: z.string().trim().max(160).optional().nullable(),
  details: z.string().trim().min(10).max(4000),
  companyWebsite: z.string().trim().max(500).optional().default('')
});
const requestResponseSchema = z.object({
  message: z.string().trim().min(10).max(4000),
  resolved: z.boolean().default(false),
  responseKind: z.enum(['ACKNOWLEDGEMENT', 'VERIFICATION_REQUEST', 'SUBSTANTIVE']).default('SUBSTANTIVE')
});
const requestStatusSchema = z.object({
  resolved: z.boolean(),
  offlineResponseEvidence: z.string().trim().min(10).max(4000).optional()
});
const identityVerificationSchema = z.object({
  evidence: z.string().trim().min(10).max(4000)
});
const requestListQuerySchema = z.object({
  status: z.enum(['ALL', 'OPEN', 'IN_REVIEW', 'COMPLETED', 'REJECTED', 'CANCELLED']).default('OPEN'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25)
});

const REQUEST_TYPE_LABELS = {
  CONFIRMATION: 'Confirmação de tratamento',
  ACCESS: 'Acesso aos dados',
  CORRECTION: 'Correção de dados',
  ANONYMIZATION: 'Anonimização',
  BLOCKING: 'Bloqueio',
  DELETION: 'Eliminação',
  PORTABILITY: 'Portabilidade',
  SHARING_INFO: 'Informações sobre compartilhamento',
  CONSENT_REVOCATION: 'Revogação de consentimento',
  OPPOSITION: 'Oposição ao tratamento',
  OTHER: 'Outro pedido'
};
const HIGH_RISK_REQUEST_TYPES = new Set([
  'CONFIRMATION',
  'ACCESS',
  'CORRECTION',
  'ANONYMIZATION',
  'BLOCKING',
  'DELETION',
  'PORTABILITY',
  'SHARING_INFO',
  'CONSENT_REVOCATION',
  'OPPOSITION',
  'OTHER'
]);

export function requirePrivacyManager(req, res, next) {
  if (!req.auth || !hasModuleRole(req.auth.user, 'privacy:admin')) {
    return res.status(403).json({ error: 'Acesso restrito ao módulo de privacidade.' });
  }
  next();
}

function requestEvidence(req) {
  return {
    ipAddress: req.ip || req.socket?.remoteAddress || null,
    userAgent: String(req.headers['user-agent'] || '').slice(0, 1000) || null
  };
}

const dataSubjectRequestAdminSelect = {
  id: true,
  protocol: true,
  type: true,
  status: true,
  name: true,
  email: true,
  identifier: true,
  details: true,
  source: true,
  responseNotes: true,
  responseEmailStatus: true,
  responseEmailSentAt: true,
  responseEmailError: true,
  identityVerifiedAt: true,
  identityVerificationEvidence: true,
  completionNotes: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  requesterUser: {
    select: {
      id: true,
      username: true,
      name: true,
      email: true
    }
  },
  completedByUser: {
    select: {
      id: true,
      username: true,
      name: true,
      email: true
    }
  },
  identityVerifiedByUser: {
    select: {
      id: true,
      username: true,
      name: true,
      email: true
    }
  },
  responseAttempts: {
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: {
      id: true,
      responseKind: true,
      resolved: true,
      status: true,
      emailTo: true,
      emailSubject: true,
      providerMessageId: true,
      error: true,
      sentAt: true,
      createdAt: true,
      createdByUser: {
        select: {
          id: true,
          username: true,
          name: true,
          email: true
        }
      }
    }
  }
};

function missingMailerError() {
  const missing = getMissingMailerConfig();
  if (!missing.length) return null;
  const error = new Error(`Configuração SMTP ausente: ${missing.join(', ')}`);
  error.statusCode = 503;
  return error;
}

function responseEmailErrorMessage(error) {
  return String(error?.message || error || 'Falha ao enviar e-mail.').slice(0, 1000);
}

function dataSubjectResponseConflictError() {
  const error = new Error('A solicitação foi alterada ou já possui envio de resposta em andamento. Recarregue antes de enviar novamente.');
  error.statusCode = 409;
  return error;
}

export function dataSubjectResponseInitialUpdateData({ message, currentStatus }) {
  return {
    responseNotes: message,
    status: currentStatus === 'COMPLETED' ? 'COMPLETED' : 'IN_REVIEW',
    responseEmailStatus: 'PENDING',
    responseEmailError: null
  };
}

export function dataSubjectResponseSentUpdateData({ currentStatus, resolved, userId, now = new Date() }) {
  const shouldComplete = currentStatus !== 'COMPLETED' && resolved;
  return {
    responseEmailStatus: 'SENT',
    responseEmailSentAt: now,
    responseEmailError: null,
    ...(shouldComplete ? {
      status: 'COMPLETED',
      completedAt: now,
      completedByUserId: userId,
      completionNotes: 'Resposta enviada por e-mail ao titular.'
    } : {})
  };
}

export function dataSubjectResponseFailedUpdateData(error) {
  return {
    responseEmailStatus: 'FAILED',
    responseEmailError: responseEmailErrorMessage(error)
  };
}

export function dataSubjectResponseNeedsReviewUpdateData(error) {
  return {
    status: 'IN_REVIEW',
    responseEmailStatus: 'NEEDS_REVIEW',
    responseEmailError: responseEmailErrorMessage(error)
  };
}

export function dataSubjectResponseClaimWhere(request) {
  return {
    id: request.id,
    updatedAt: request.updatedAt,
    OR: [
      { responseEmailStatus: null },
      { responseEmailStatus: { notIn: ['PENDING', 'SENDING'] } }
    ]
  };
}

export function dataSubjectRequiresIdentityVerification(type) {
  return HIGH_RISK_REQUEST_TYPES.has(String(type || '').toUpperCase());
}

export function dataSubjectResponseRequiresIdentityVerification({ type, responseKind, resolved }) {
  if (!dataSubjectRequiresIdentityVerification(type)) return false;
  return resolved || responseKind === 'SUBSTANTIVE';
}

export function dataSubjectCanSendResponse(request, data) {
  const requiresIdentity = dataSubjectResponseRequiresIdentityVerification({
    type: request?.type,
    responseKind: data?.responseKind || 'SUBSTANTIVE',
    resolved: !!data?.resolved
  });
  if (!requiresIdentity || request?.identityVerifiedAt) return { allowed: true };
  return {
    allowed: false,
    error: 'Verifique a identidade do titular antes de enviar resposta final ou concluir esta solicitação.'
  };
}

export function dataSubjectCompletionEvidence(request, offlineResponseEvidence = '') {
  if (dataSubjectRequiresIdentityVerification(request?.type) && !request?.identityVerifiedAt) {
    return { allowed: false, completionNotes: '' };
  }
  const evidence = String(offlineResponseEvidence || '').trim();
  if (evidence) {
    return { allowed: true, completionNotes: evidence };
  }
  if (request?.responseNotes && request?.responseEmailStatus === 'SENT') {
    return { allowed: true, completionNotes: 'Concluída com resposta enviada por e-mail ao titular.' };
  }
  return { allowed: false, completionNotes: '' };
}

export function dataSubjectStatusUpdateData({ resolved, completionEvidence, userId, now = new Date() }) {
  if (resolved) {
    return {
      status: 'COMPLETED',
      completedAt: now,
      completedByUserId: userId,
      completionNotes: completionEvidence.completionNotes
    };
  }
  return {
    status: 'IN_REVIEW',
    completedAt: null,
    completedByUserId: null,
    completionNotes: null
  };
}

export function dataSubjectResponseAttemptKey({ requestId, email, message, responseKind, resolved }) {
  return createHash('sha256')
    .update(JSON.stringify({
      requestId,
      email: String(email || '').trim().toLowerCase(),
      message: String(message || '').trim(),
      responseKind: responseKind || 'SUBSTANTIVE',
      resolved: !!resolved
    }))
    .digest('hex');
}

export function dataSubjectResponseAttemptRetryState(attempt, now = new Date()) {
  if (!attempt) return { retry: true };
  if (attempt.status === 'SENT') return { retry: false, reconcileSent: true };
  if (attempt.status === 'FAILED') return { retry: true };
  if (attempt.status !== 'SENDING') return {
    retry: false,
    error: 'Já existe uma tentativa de envio pendente para esta resposta. Aguarde ou registre evidência manual antes de tentar novamente.'
  };

  const updatedAt = new Date(attempt.updatedAt || attempt.createdAt || 0);
  if (!Number.isNaN(updatedAt.getTime()) && now.getTime() - updatedAt.getTime() >= RESPONSE_ATTEMPT_STALE_MS) {
    return {
      retry: false,
      needsReview: true,
      status: 'NEEDS_REVIEW',
      error: 'Existe uma tentativa de envio antiga em estado desconhecido. Reconcilie manualmente antes de reenviar esta resposta.'
    };
  }
  return {
    retry: false,
    error: 'Já existe uma tentativa de envio em andamento para esta resposta. Tente novamente após alguns minutos se o envio não concluir.'
  };
}

export async function prepareDataSubjectResponseAttempt({
  prismaClient = prisma,
  request,
  data,
  idempotencyKey,
  existingAttempt,
  emailSubject,
  userId
}) {
  return prismaClient.$transaction(async tx => {
    const claimed = await tx.dataSubjectRequest.updateMany({
      where: dataSubjectResponseClaimWhere(request),
      data: dataSubjectResponseInitialUpdateData({
        message: data.message,
        currentStatus: request.status
      })
    });
    if (claimed.count !== 1) throw dataSubjectResponseConflictError();

    if (existingAttempt) {
      return tx.dataSubjectRequestResponseAttempt.update({
        where: { id: existingAttempt.id },
        data: {
          status: 'PENDING',
          error: null,
          sentAt: null,
          createdByUserId: userId
        }
      });
    }
    return tx.dataSubjectRequestResponseAttempt.create({
      data: {
        requestId: request.id,
        idempotencyKey,
        message: data.message,
        responseKind: data.responseKind,
        resolved: data.resolved,
        status: 'PENDING',
        emailTo: request.email,
        emailSubject: emailSubject || null,
        createdByUserId: userId
      }
    });
  });
}

async function createDataSubjectRequest(data, options = {}) {
  const type = normalizeDataSubjectRequestType(data.type);
  const evidence = options.evidence || {};
  return prisma.dataSubjectRequest.create({
    data: {
      protocol: dataSubjectProtocol(type),
      type,
      name: data.name.trim(),
      email: data.email.trim().toLowerCase(),
      identifier: data.identifier ? data.identifier.trim() : null,
      details: data.details.trim(),
      source: options.source || 'PUBLIC_FORM',
      requesterUserId: options.requesterUserId || null,
      ipAddress: evidence.ipAddress || null,
      userAgent: evidence.userAgent || null
    }
  });
}

async function existingRecentDataSubjectRequest(data) {
  const type = normalizeDataSubjectRequestType(data.type);
  const createdAfter = new Date(Date.now() - PUBLIC_REQUEST_DEDUPE_HOURS * 60 * 60 * 1000);
  return prisma.dataSubjectRequest.findFirst({
    where: {
      type,
      email: data.email.trim().toLowerCase(),
      details: data.details.trim(),
      status: { in: ['OPEN', 'IN_REVIEW'] },
      createdAt: { gte: createdAfter }
    },
    orderBy: { createdAt: 'desc' }
  });
}

export function dataSubjectDuplicatePublicReceipt() {
  return {
    received: true,
    duplicateWindowHours: PUBLIC_REQUEST_DEDUPE_HOURS
  };
}

export function privacyAdminNotificationRecipientWhere() {
  return {
    isActive: true,
    email: { not: null },
    moduleRoles: {
      some: {
        module: 'PRIVACY',
        role: 'PRIVACY_ADMIN'
      }
    }
  };
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function parseEmailList(value) {
  return Array.from(new Set(String(value || '')
    .split(',')
    .map(normalizeEmail)
    .filter(Boolean)));
}

export async function dataSubjectRequestNotificationRecipients({
  prismaClient = prisma,
  privacyNotificationEmail = env.privacyNotificationEmail,
  smtpTestDest = env.smtpTestDest,
  nodeEnv = env.nodeEnv
} = {}) {
  const users = await prismaClient.user.findMany({
    where: privacyAdminNotificationRecipientWhere(),
    select: { email: true }
  });
  const roleRecipients = users.map(user => normalizeEmail(user.email)).filter(Boolean);
  const fallbackRecipients = parseEmailList(privacyNotificationEmail);
  const testRecipients = nodeEnv === 'production' ? [] : parseEmailList(smtpTestDest);
  return Array.from(new Set([...roleRecipients, ...fallbackRecipients, ...testRecipients]));
}

export async function dataSubjectRequestIntakeReadiness({
  prismaClient = prisma,
  getMissingMailerConfigFn = getMissingMailerConfig,
  privacyNotificationEmail = env.privacyNotificationEmail,
  smtpTestDest = env.smtpTestDest,
  nodeEnv = env.nodeEnv
} = {}) {
  const missingMailerConfig = getMissingMailerConfigFn();
  if (missingMailerConfig.length) {
    return {
      ready: false,
      statusCode: 503,
      error: 'Canal LGPD indisponível temporariamente. Tente novamente mais tarde.',
      reason: `Configuração SMTP ausente: ${missingMailerConfig.join(', ')}`
    };
  }

  const recipients = await dataSubjectRequestNotificationRecipients({
    prismaClient,
    privacyNotificationEmail,
    smtpTestDest,
    nodeEnv
  });
  if (!recipients.length) {
    return {
      ready: false,
      statusCode: 503,
      error: 'Canal LGPD indisponível temporariamente. Tente novamente mais tarde.',
      reason: 'Nenhum administrador de privacidade ou caixa operacional LGPD configurada.'
    };
  }

  return { ready: true, recipients };
}

export async function notifyDataSubjectRequestCreated(request, {
  prismaClient = prisma,
  getMissingMailerConfigFn = getMissingMailerConfig,
  sendMailFn = sendMail,
  privacyNotificationEmail = env.privacyNotificationEmail,
  smtpTestDest = env.smtpTestDest,
  nodeEnv = env.nodeEnv,
  appUrl = env.appUrl,
  logger = console
} = {}) {
  const readiness = await dataSubjectRequestIntakeReadiness({
    prismaClient,
    getMissingMailerConfigFn,
    privacyNotificationEmail,
    smtpTestDest,
    nodeEnv
  });
  if (!readiness.ready) {
    logger.error?.(`Notificação LGPD não enviada: ${readiness.reason}`);
    return;
  }
  const recipients = readiness.recipients;

  const privacyModuleUrl = appUrl ? `${appUrl.replace(/\/$/, '')}/privacidade/solicitacoes` : '';
  const template = buildDataSubjectRequestCreatedEmailTemplate({
    protocol: request.protocol,
    typeLabel: REQUEST_TYPE_LABELS[request.type] || request.type,
    requesterName: request.name,
    requesterEmail: request.email,
    identifier: request.identifier,
    details: request.details,
    appUrl: privacyModuleUrl
  });

  await sendMailFn({
    to: recipients[0],
    ...(recipients.length > 1 ? { cc: recipients.slice(1) } : {}),
    ...template
  });
}

router.post('/requests', publicRequestLimiter, asyncHandler(async (req, res) => {
  const data = requestSchema.parse(req.body || {});
  if (data.companyWebsite) {
    return res.status(201).json({
      request: dataSubjectRequestPublicShape({
        protocol: dataSubjectProtocol('OTHER'),
        type: 'OTHER',
        status: 'OPEN',
        createdAt: new Date()
      })
    });
  }
  const readiness = await dataSubjectRequestIntakeReadiness();
  if (!readiness.ready) {
    console.error(`Solicitação LGPD recusada: ${readiness.reason}`);
    return res.status(readiness.statusCode).json({ error: readiness.error });
  }
  const existing = await existingRecentDataSubjectRequest(data);
  if (existing) {
    return res.status(202).json({
      request: dataSubjectDuplicatePublicReceipt()
    });
  }
  const request = await createDataSubjectRequest(data, {
    source: 'PUBLIC_FORM',
    evidence: requestEvidence(req)
  });
  notifyDataSubjectRequestCreated(request).catch(error => {
    console.error('Falha ao enviar notificação de solicitação LGPD.', error);
  });
  res.status(201).json({ request: dataSubjectRequestPublicShape(request) });
}));

router.get('/requests', requireAuth, requirePrivacyManager, asyncHandler(async (req, res) => {
  const query = requestListQuerySchema.parse(req.query || {});
  const where = query.status === 'ALL' ? {} : { status: query.status };
  const skip = (query.page - 1) * query.pageSize;
  const [requests, total, open, inReview] = await Promise.all([
    prisma.dataSubjectRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: query.pageSize,
      select: dataSubjectRequestAdminSelect
    }),
    prisma.dataSubjectRequest.count({ where }),
    prisma.dataSubjectRequest.count({ where: { status: 'OPEN' } }),
    prisma.dataSubjectRequest.count({ where: { status: 'IN_REVIEW' } })
  ]);

  res.json({
    requests,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize))
    },
    counts: {
      open,
      inReview,
      pending: open + inReview
    }
  });
}));

router.post('/requests/:id/response', requireAuth, requirePrivacyManager, asyncHandler(async (req, res) => {
  const missing = missingMailerError();
  if (missing) throw missing;

  const data = requestResponseSchema.parse(req.body || {});
  const request = await prisma.dataSubjectRequest.findUniqueOrThrow({ where: { id: req.params.id } });
  const responseGuard = dataSubjectCanSendResponse(request, data);
  if (!responseGuard.allowed) {
    return res.status(400).json({ error: responseGuard.error });
  }
  const finalResolved = request.status === 'COMPLETED' || data.resolved;
  const template = buildDataSubjectRequestResponseEmailTemplate({
    protocol: request.protocol,
    typeLabel: REQUEST_TYPE_LABELS[request.type] || request.type,
    requesterName: request.name,
    message: data.message,
    resolved: finalResolved
  });
  const idempotencyKey = dataSubjectResponseAttemptKey({
    requestId: request.id,
    email: request.email,
    message: data.message,
    responseKind: data.responseKind,
    resolved: data.resolved
  });
  const existingAttempt = await prisma.dataSubjectRequestResponseAttempt.findUnique({ where: { idempotencyKey } });
  const attemptRetryState = dataSubjectResponseAttemptRetryState(existingAttempt);
  if (attemptRetryState.reconcileSent) {
    const updated = await prisma.dataSubjectRequest.update({
      where: { id: request.id },
      data: {
        responseNotes: existingAttempt.message,
        ...dataSubjectResponseSentUpdateData({
          currentStatus: request.status,
          resolved: existingAttempt.resolved,
          userId: existingAttempt.createdByUserId || req.auth.user.id,
          now: existingAttempt.sentAt || new Date()
        })
      },
      select: dataSubjectRequestAdminSelect
    });
    return res.json({ request: updated });
  }
  if (!attemptRetryState.retry) {
    if (attemptRetryState.needsReview && existingAttempt) {
      await prisma.$transaction(async tx => {
        await tx.dataSubjectRequestResponseAttempt.update({
          where: { id: existingAttempt.id },
          data: {
            status: attemptRetryState.status,
            error: attemptRetryState.error
          }
        });
        await tx.dataSubjectRequest.update({
          where: { id: request.id },
          data: dataSubjectResponseNeedsReviewUpdateData(attemptRetryState.error)
        });
      });
    }
    return res.status(409).json({
      error: attemptRetryState.error
    });
  }
  const attempt = await prepareDataSubjectResponseAttempt({
    request,
    data,
    idempotencyKey,
    existingAttempt,
    emailSubject: template.subject,
    userId: req.auth.user.id
  });

  await prisma.dataSubjectRequestResponseAttempt.update({
    where: { id: attempt.id },
    data: { status: 'SENDING', error: null }
  });

  let mailInfo = null;
  try {
    mailInfo = await sendMail({ to: request.email, ...template });
  } catch (error) {
    const failed = await prisma.$transaction(async tx => {
      await tx.dataSubjectRequestResponseAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'FAILED',
          error: responseEmailErrorMessage(error)
        }
      });
      return tx.dataSubjectRequest.update({
        where: { id: request.id },
        data: dataSubjectResponseFailedUpdateData(error),
        select: dataSubjectRequestAdminSelect
      });
    });
    error.statusCode = error.statusCode || 502;
    error.request = failed;
    throw error;
  }

  await prisma.dataSubjectRequestResponseAttempt.update({
    where: { id: attempt.id },
    data: {
      status: 'SENT',
      sentAt: new Date(),
      providerMessageId: mailInfo?.messageId || null,
      error: null
    }
  });

  const sentAttempt = await prisma.dataSubjectRequestResponseAttempt.findUniqueOrThrow({
    where: { id: attempt.id }
  });
  const updated = await prisma.dataSubjectRequest.update({
    where: { id: request.id },
    data: dataSubjectResponseSentUpdateData({
      currentStatus: request.status,
      resolved: data.resolved,
      userId: req.auth.user.id,
      now: sentAttempt.sentAt || new Date()
    }),
    select: dataSubjectRequestAdminSelect
  });

  res.json({ request: updated });
}));

router.patch('/requests/:id/identity-verification', requireAuth, requirePrivacyManager, asyncHandler(async (req, res) => {
  const data = identityVerificationSchema.parse(req.body || {});
  const request = await prisma.dataSubjectRequest.findUniqueOrThrow({
    where: { id: req.params.id },
    select: { status: true }
  });
  const updated = await prisma.dataSubjectRequest.update({
    where: { id: req.params.id },
    data: {
      identityVerifiedAt: new Date(),
      identityVerifiedByUserId: req.auth.user.id,
      identityVerificationEvidence: data.evidence,
      ...(request.status === 'COMPLETED' ? {} : { status: 'IN_REVIEW' })
    },
    select: dataSubjectRequestAdminSelect
  });

  res.json({ request: updated });
}));

router.patch('/requests/:id/status', requireAuth, requirePrivacyManager, asyncHandler(async (req, res) => {
  const data = requestStatusSchema.parse(req.body || {});
  const request = await prisma.dataSubjectRequest.findUniqueOrThrow({
    where: { id: req.params.id },
    select: { id: true, type: true, responseNotes: true, responseEmailStatus: true, identityVerifiedAt: true }
  });
  const completionEvidence = dataSubjectCompletionEvidence(request, data.offlineResponseEvidence);
  if (data.resolved && !completionEvidence.allowed) {
    return res.status(400).json({ error: 'Informe evidência offline ou envie a resposta por e-mail antes de concluir a solicitação.' });
  }
  const updated = await prisma.dataSubjectRequest.update({
    where: { id: req.params.id },
    data: {
      ...dataSubjectStatusUpdateData({
        resolved: data.resolved,
        completionEvidence,
        userId: req.auth.user.id
      })
    },
    select: dataSubjectRequestAdminSelect
  });

  res.json({ request: updated });
}));

router.get('/me/data-export', requireAuth, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.auth.user.id },
    include: {
      collaborator: true,
      moduleRoles: true,
      drafts: {
        select: { id: true, projectId: true, title: true, reportDate: true, createdAt: true, updatedAt: true }
      },
      clientReportReviews: {
        select: { id: true, reportId: true, action: true, comment: true, createdAt: true }
      },
      reportSignatures: {
        select: {
          id: true,
          reportId: true,
          signerName: true,
          signerEmail: true,
          status: true,
          signedAt: true,
          privacyNoticeAcceptedAt: true,
          privacyNoticeVersion: true
        }
      },
      createdReports: {
        select: { id: true, projectId: true, reportType: true, reportDate: true, status: true, createdAt: true, updatedAt: true }
      },
      sentSurveys: {
        select: { id: true, projectId: true, emailTo: true, sentAt: true, respondedAt: true, createdAt: true }
      },
      dataSubjectRequests: {
        select: { id: true, protocol: true, type: true, status: true, createdAt: true, completedAt: true }
      }
    }
  });

  res.json(await buildSelfServiceDataExport(user));
}));

function uniqueById(items) {
  const seen = new Set();
  return items.filter(item => {
    if (!item?.id) return true;
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function dataExportEmailWhere(field, emails) {
  if (!emails.length) return null;
  return {
    OR: emails.map(email => ({
      [field]: { equals: email, mode: 'insensitive' }
    }))
  };
}

export function selfServiceDataExportIdentifiers(user) {
  const emails = Array.from(new Set([
    normalizeEmail(user.email),
    String(user.username || '').includes('@') ? normalizeEmail(user.username) : ''
  ].filter(Boolean)));
  return {
    userId: user.id,
    emails,
    username: user.username || null,
    collaboratorId: user.collaboratorId || user.collaborator?.id || null,
    clientCnpj: user.clientCnpj || null
  };
}

export async function buildSelfServiceDataExport(user, {
  prismaClient = prisma,
  now = new Date()
} = {}) {
  const identifiers = selfServiceDataExportIdentifiers(user);
  const signatureEmailWhere = dataExportEmailWhere('signerEmail', identifiers.emails);
  const surveyEmailWhere = dataExportEmailWhere('emailTo', identifiers.emails);
  const requestEmailWhere = dataExportEmailWhere('email', identifiers.emails);
  const collaboratorEmailWhere = dataExportEmailWhere('email', identifiers.emails);
  const collaboratorWhere = identifiers.collaboratorId
    ? {
        OR: [
          { id: identifiers.collaboratorId },
          ...(collaboratorEmailWhere?.OR || [])
        ]
      }
    : collaboratorEmailWhere;

  const [
    reportSignaturesByEmail,
    surveyResponsesByEmail,
    dataSubjectRequestsByEmail,
    collaboratorDetails
  ] = await Promise.all([
    signatureEmailWhere ? prismaClient.reportSignature.findMany({
      where: signatureEmailWhere,
      select: {
        id: true,
        reportId: true,
        versionId: true,
        signerName: true,
        declaredSignerName: true,
        signerEmail: true,
        signerRole: true,
        signatureType: true,
        status: true,
        signedAt: true,
        rejectedAt: true,
        rejectionReason: true,
        privacyNoticeAcceptedAt: true,
        privacyNoticeVersion: true,
        createdAt: true,
        updatedAt: true
      }
    }) : [],
    surveyEmailWhere ? prismaClient.satisfactionSurvey.findMany({
      where: surveyEmailWhere,
      select: {
        id: true,
        projectId: true,
        emailTo: true,
        sentAt: true,
        respondedAt: true,
        responses: true,
        questions: true,
        followUpStatus: true,
        followUpNotes: true,
        privacyNoticeAcceptedAt: true,
        privacyNoticeVersion: true,
        createdAt: true,
        updatedAt: true
      }
    }) : [],
    requestEmailWhere ? prismaClient.dataSubjectRequest.findMany({
      where: requestEmailWhere,
      select: { id: true, protocol: true, type: true, status: true, createdAt: true, completedAt: true }
    }) : [],
    collaboratorWhere ? prismaClient.collaborator.findFirst({
      where: collaboratorWhere,
      select: {
        id: true,
        code: true,
        name: true,
        role: true,
        email: true,
        cpf: true,
        registrationNumber: true,
        admissionDate: true,
        signatureNoticeAcceptedAt: true,
        signatureNoticeVersion: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        epiRecords: {
          select: {
            id: true,
            epiName: true,
            ca: true,
            quantity: true,
            lendDate: true,
            devolutionDate: true,
            signatureSignerName: true,
            signedAt: true,
            pendingReturn: true,
            archivedAt: true,
            createdAt: true,
            updatedAt: true
          }
        },
        epiSignatureRequests: {
          select: {
            id: true,
            status: true,
            expiresAt: true,
            signedAt: true,
            signatureSignerName: true,
            privacyNoticeAcceptedAt: true,
            privacyNoticeVersion: true,
            createdAt: true,
            updatedAt: true
          }
        }
      }
    }) : null
  ]);

  return {
    exportedAt: now.toISOString(),
    identifiers,
    user: publicUser(user),
    drafts: user.drafts,
    clientReportReviews: user.clientReportReviews,
    reportSignatures: uniqueById([...(user.reportSignatures || []), ...reportSignaturesByEmail]),
    createdReports: user.createdReports,
    sentSurveys: user.sentSurveys,
    surveyResponses: surveyResponsesByEmail,
    collaboratorDetails,
    dataSubjectRequests: uniqueById([...(user.dataSubjectRequests || []), ...dataSubjectRequestsByEmail])
  };
}

router.post('/me/delete-request', requireAuth, asyncHandler(async (req, res) => {
  const readiness = await dataSubjectRequestIntakeReadiness();
  if (!readiness.ready) {
    console.error(`Solicitação LGPD autenticada recusada: ${readiness.reason}`);
    return res.status(readiness.statusCode).json({ error: readiness.error });
  }
  const user = req.auth.user;
  const request = await createDataSubjectRequest({
    type: 'DELETION',
    name: user.name || user.username,
    email: user.email || (String(user.username || '').includes('@') ? user.username : 'privacidade@filtrovali.com.br'),
    identifier: user.username,
    details: deletionRequestDetails(user)
  }, {
    source: 'AUTHENTICATED_DELETE_REQUEST',
    requesterUserId: user.id,
    evidence: requestEvidence(req)
  });
  notifyDataSubjectRequestCreated(request).catch(error => {
    console.error('Falha ao enviar notificação de solicitação LGPD.', error);
  });

  res.status(201).json({ request: dataSubjectRequestPublicShape(request) });
}));

export default router;
