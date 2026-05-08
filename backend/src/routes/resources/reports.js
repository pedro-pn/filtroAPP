import { Router } from 'express';
import fs from 'node:fs/promises';
import AdmZip from 'adm-zip';
import { ClientReviewAction, ReportStatus, ReportType } from '@prisma/client';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import env from '../../config/env.js';
import { buildReportApprovedEmailTemplate, buildReportReapprovedEmailTemplate, buildReportRejectedByClientEmailTemplate } from '../../lib/email-templates.js';
import { getMissingMailerConfig, sendMail } from '../../lib/mailer.js';
import { saveReportDocx, organizePhotos } from '../../lib/report-docx.js';
import { saveReportPdf } from '../../lib/report-pdf-from-docx.js';
import {
  buildZapSignSignatureProgress,
  ZAPSIGN_BATCH_DOC_TOKENS_KEY,
  ZAPSIGN_BATCH_MAIN_DOC_TOKEN_KEY,
  ZAPSIGN_SIGNATURE_PROGRESS_KEY,
  ZAPSIGN_SIGNERS_KEY
} from '../../lib/zapsign-progress.js';
import { saveRtpDocx, saveRtpPdf, organizeRtpPhotos } from '../../lib/report-rtp.js';
import { saveRlqDocx, saveRlqPdf, organizeRlqPhotos } from '../../lib/report-rlq.js';
import { saveRcpDocx, saveRcpPdf, organizeRcpPhotos, calcServiceMinutes } from '../../lib/report-rcp.js';
import { saveRlmDocx, saveRlmPdf, organizeRlmPhotos } from '../../lib/report-rlm.js';
import {
  claimZapSignRequest,
  claimZapSignRequests,
  persistZapSignRequest,
  releaseZapSignRequestClaim,
  releaseZapSignRequestClaims
} from '../../lib/zapsign-request-claim.js';
import {
  resolveSignerUrlForUser,
  resolveSignerUrlFromZapSignDocument,
  resolveZapSignSigner,
  zapsignAdditionalSignersForProject
} from '../../lib/zapsign-signer.js';
import {
  addExtraDocToZapSign,
  assertZapSignEnabled,
  downloadSignedZapSignDocument,
  getZapSignDocument,
  isZapSignEnabled,
  sendToZapSign
} from '../../lib/zapsign.js';
import { calculateReportOvertime } from '../../lib/overtime.js';
import prisma from '../../lib/prisma.js';
import { buildReportFileName } from '../../lib/report-filename.js';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();
const COLLABORATOR_EDIT_NOTE = 'Editado pelo colaborador';
const CLIENT_REJECTION_KEY = '__clientRejectedAt';
const CLIENT_REJECTION_RESOLVED_KEY = '__clientRejectionResolvedAt';

function formatDatePtBr(date) {
  const value = date instanceof Date ? date.toISOString() : String(date || '');
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [, year, month, day] = match;
    return `${day}/${month}/${year}`;
  }
  return new Date(date).toLocaleDateString('pt-BR');
}

function hasActiveClientRejection(report) {
  const special = report?.specialConditions || {};
  const rejectedAt = special[CLIENT_REJECTION_KEY];
  const resolvedAt = special[CLIENT_REJECTION_RESOLVED_KEY];
  if (rejectedAt) {
    return !resolvedAt || new Date(rejectedAt).getTime() > new Date(resolvedAt).getTime();
  }
  const reviews = Array.isArray(report?.clientReviews) ? report.clientReviews : [];
  const latest = reviews[0];
  if (!latest || latest.action !== ClientReviewAction.REJECTED) return false;
  if (resolvedAt && new Date(latest.createdAt).getTime() <= new Date(resolvedAt).getTime()) return false;
  return report?.status !== ReportStatus.SIGNED;
}

function withClientRejectionCleared(specialConditions) {
  const next = { ...(specialConditions || {}) };
  delete next[CLIENT_REJECTION_KEY];
  next[CLIENT_REJECTION_RESOLVED_KEY] = new Date().toISOString();
  return next;
}

function withoutZapSignState(specialConditions) {
  const next = { ...(specialConditions || {}) };
  delete next[ZAPSIGN_SIGNERS_KEY];
  delete next[ZAPSIGN_SIGNATURE_PROGRESS_KEY];
  delete next[ZAPSIGN_BATCH_MAIN_DOC_TOKEN_KEY];
  delete next[ZAPSIGN_BATCH_DOC_TOKENS_KEY];
  return next;
}

function reportNumberLabel(report) {
  if (report.sequenceNumber == null) return '';
  return String(report.sequenceNumber);
}

function queueApprovedReportNotification(report) {
  if (report.project?.managerOnly) return;
  const primary = String(report.project?.clientEmailPrimary || '').trim().toLowerCase();
  const cc = Array.from(new Set((report.project?.clientEmailCc || [])
    .map(email => String(email || '').trim().toLowerCase())
    .filter(Boolean)
    .filter(email => email !== primary)));
  const recipients = [primary, ...cc].filter(Boolean);
  if (!recipients.length) return;

  const missingMailerConfig = getMissingMailerConfig();
  if (missingMailerConfig.length) {
    console.warn('SMTP não configurado; notificação de aprovação não enviada.', missingMailerConfig.join(', '));
    return;
  }

  const template = buildReportApprovedEmailTemplate({
    projectCode: report.project?.code || '---',
    projectName: report.project?.name || 'Sem projeto',
    clientName: report.project?.clientName || 'Cliente',
    reportType: report.reportType,
    reportNumber: reportNumberLabel(report),
    reportDate: formatDatePtBr(report.reportDate),
    appUrl: env.appUrl || ''
  });

  setImmediate(() => {
    sendMail({
      to: primary,
      ...(cc.length ? { cc } : {}),
      ...template
    }).catch(error => {
      console.error('Falha ao enviar notificação de aprovação do relatório.', {
        reportId: report.id,
        projectId: report.projectId,
        error: error?.message || error
      });
    });
  });
}

function queueReapprovedReportNotification(report) {
  if (report.project?.managerOnly) return;
  const primary = String(report.project?.clientEmailPrimary || '').trim().toLowerCase();
  const cc = Array.from(new Set((report.project?.clientEmailCc || [])
    .map(email => String(email || '').trim().toLowerCase())
    .filter(Boolean)
    .filter(email => email !== primary)));
  const recipients = [primary, ...cc].filter(Boolean);
  if (!recipients.length) return;

  const missingMailerConfig = getMissingMailerConfig();
  if (missingMailerConfig.length) {
    console.warn('SMTP não configurado; notificação de reaprovação não enviada.', missingMailerConfig.join(', '));
    return;
  }

  const template = buildReportReapprovedEmailTemplate({
    projectCode: report.project?.code || '---',
    projectName: report.project?.name || 'Sem projeto',
    clientName: report.project?.clientName || 'Cliente',
    reportType: report.reportType,
    reportNumber: reportNumberLabel(report),
    reportDate: formatDatePtBr(report.reportDate),
    appUrl: env.appUrl || ''
  });

  setImmediate(() => {
    sendMail({
      to: primary,
      ...(cc.length ? { cc } : {}),
      ...template
    }).catch(error => {
      console.error('Falha ao enviar notificação de reaprovação do relatório.', {
        reportId: report.id,
        projectId: report.projectId,
        error: error?.message || error
      });
    });
  });
}

function queueClientRejectionNotification(report, comment) {
  const managerEmail = String(report.reviewedBy?.email || '').trim().toLowerCase();
  if (!managerEmail) return;

  const missingMailerConfig = getMissingMailerConfig();
  if (missingMailerConfig.length) {
    console.warn('SMTP não configurado; notificação de reprovação não enviada.', missingMailerConfig.join(', '));
    return;
  }

  const template = buildReportRejectedByClientEmailTemplate({
    projectCode: report.project?.code || '---',
    projectName: report.project?.name || 'Sem projeto',
    reportType: report.reportType,
    reportNumber: reportNumberLabel(report),
    reportDate: formatDatePtBr(report.reportDate),
    comment: comment || '',
    appUrl: env.appUrl || ''
  });

  setImmediate(() => {
    sendMail({ to: managerEmail, ...template }).catch(error => {
      console.error('Falha ao enviar notificação de reprovação do relatório.', {
        reportId: report.id,
        error: error?.message || error
      });
    });
  });
}

function contentDisposition(fileName) {
  const ascii = fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ._\-]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

const include = {
  project: {
    include: {
      operator: true
    }
  },
  createdBy: {
    include: {
      collaborator: true
    }
  },
  reviewedBy: {
    include: {
      collaborator: true
    }
  },
  collaborators: { include: { collaborator: true } },
  services: {
    include: {
      equipment: true,
      attachments: true
    }
  },
  attachments: true,
  clientReviews: {
    orderBy: { createdAt: 'desc' }
  }
};

function clientCanAccessProject(auth, project) {
  if (project?.managerOnly) return false;
  if (project?.clientCnpj === auth.user.username) return true;
  const userEmail = String(auth.user.email || '').trim().toLowerCase();
  if (!userEmail) return false;
  if (String(project?.clientEmailPrimary || '').trim().toLowerCase() === userEmail) return true;
  return Array.isArray(project?.clientEmailCc)
    && project.clientEmailCc.some(cc => cc.toLowerCase() === userEmail);
}

async function collaboratorProjectIdsForAuth(auth) {
  const collaboratorId = auth.rawUser?.collaboratorId || auth.user?.collaboratorId;
  if (!collaboratorId) return [];

  const projects = await prisma.project.findMany({
    where: {
      isActive: true,
      visibleToCollaborators: true,
      managerOnly: false,
      operatorId: collaboratorId
    },
    select: { id: true }
  });

  return projects.map(project => project.id);
}

async function canAccessReport(auth, report) {
  if (auth.user.role === 'MANAGER') return true;
  if (report.project?.managerOnly) return false;
  if (auth.user.role === 'COORDINATOR') return true;
  if (auth.user.role === 'CLIENT') return clientCanAccessProject(auth, report.project);
  if (report.createdByUserId === auth.user.id) return true;
  const collabId = auth.rawUser?.collaboratorId;
  if (collabId && report.project?.operatorId === collabId) return true;
  if (collabId && Array.isArray(report.collaborators)) {
    if (report.collaborators.some(rc => rc.collaboratorId === collabId)) return true;
  }
  return false;
}

function canClientSeeReport(report, allReportsById) {
  if (!report || !report.project?.clientCnpj) return false;
  if (report.reportType === ReportType.RDO) {
    return report.status === ReportStatus.APPROVED || report.status === ReportStatus.SIGNED || hasActiveClientRejection(report);
  }
  if (report.specialConditions?.serviceOnly === true) {
    return report.status === ReportStatus.APPROVED || report.status === ReportStatus.SIGNED;
  }
  const parentId = report.specialConditions?.parentRdoId;
  if (!parentId) return false;
  const parent = allReportsById.get(parentId);
  return !!(parent && parent.status === ReportStatus.SIGNED);
}

async function resolveSignerUrlFromZapSign(docToken, authUser, project) {
  const zapDoc = await getZapSignDocument(docToken);
  return resolveSignerUrlFromZapSignDocument(zapDoc, authUser, project);
}

function assertReportMutable(report) {
  if (report.status === ReportStatus.SIGNED) {
    const error = new Error('Relatório assinado não pode mais ser alterado.');
    error.statusCode = 409;
    throw error;
  }
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.ip || null;
}

function reportPdfFileName(report, saved) {
  if (saved?.fileName) return saved.fileName;
  return buildReportFileName(report, 'pdf');
}

async function withCurrentServiceLeaderSnapshot(report) {
  const parentRdoId = report?.specialConditions?.parentRdoId;
  if (!parentRdoId || report.reportType === ReportType.RDO) return report;

  const parent = await prisma.report.findUnique({
    where: { id: parentRdoId },
    include: {
      project: { include: { operator: true } },
      createdBy: { include: { collaborator: true } }
    }
  });
  if (!parent) return report;

  const leaderSnapshot = projectLeaderSnapshot(parent.project) || parent.specialConditions?.__leaderSnapshot || null;
  return {
    ...report,
    specialConditions: {
      ...(report.specialConditions || {}),
      __leaderSnapshot: leaderSnapshot
    }
  };
}

async function generateReportPdfAsset(report) {
  report = await withCurrentServiceLeaderSnapshot(report);
  report = withServiceUploadFields(report);
  if (report.reportType === 'RTP') return saveRtpPdf(report);
  if (report.reportType === 'RLQ') return saveRlqPdf(report);
  if (report.reportType === 'RCPU') return saveRcpPdf(report);
  if (report.reportType === 'RLM') return saveRlmPdf(report);
  return saveReportPdf(report);
}

async function generateReportDocxAsset(report) {
  report = await withCurrentServiceLeaderSnapshot(report);
  report = withServiceUploadFields(report);
  if (report.reportType === 'RTP') return saveRtpDocx(report);
  if (report.reportType === 'RLQ') return saveRlqDocx(report);
  if (report.reportType === 'RCPU') return saveRcpDocx(report);
  if (report.reportType === 'RLM') return saveRlmDocx(report);
  return saveReportDocx(report);
}

async function refreshDerivedReportSource(report) {
  if (![ReportType.RTP, ReportType.RLQ, ReportType.RCPU, ReportType.RLM].includes(report.reportType)) {
    return report;
  }
  const parentRdoId = report.specialConditions?.parentRdoId;
  if (!parentRdoId) return report;

  await prisma.$transaction(async tx => {
    const parent = await tx.report.findUnique({
      where: { id: parentRdoId },
      include
    });
    if (!parent || parent.reportType !== ReportType.RDO || parent.status !== ReportStatus.APPROVED) return;
    if (report.reportType === ReportType.RTP) await syncApprovedRtpReports(tx, parent);
    if (report.reportType === ReportType.RLQ) await syncApprovedRlqReports(tx, parent);
    if (report.reportType === ReportType.RCPU) await syncApprovedRcpReports(tx, parent);
    if (report.reportType === ReportType.RLM) await syncApprovedRlmReports(tx, parent);
  });

  return prisma.report.findUniqueOrThrow({
    where: { id: report.id },
    include
  });
}

function buildZapSignWebhookUrl() {
  const base = String(env.appUrl || '').replace(/\/+$/, '');
  if (!base) {
    const error = new Error('APP_URL não configurado para receber webhook do ZapSign.');
    error.statusCode = 503;
    throw error;
  }
  return `${base}/api/webhooks/zapsign`;
}

async function resolveSignedPdf(report) {
  if (!report?.zapsignDocToken) {
    const error = new Error('Relatório assinado sem referência do documento ZapSign.');
    error.statusCode = 409;
    throw error;
  }

  let signedUrl = String(report.zapsignDocUrl || '').trim();

  if (!signedUrl) {
    const details = await getZapSignDocument(report.zapsignDocToken);
    signedUrl = String(details?.signedFile || '').trim();
    if (!signedUrl) {
      const error = new Error('Documento assinado ainda não disponível na ZapSign.');
      error.statusCode = 409;
      throw error;
    }

    await prisma.report.update({
      where: { id: report.id },
      data: {
        zapsignDocUrl: signedUrl,
        ...(report.zapsignSignedAt ? {} : { zapsignSignedAt: new Date() })
      }
    });
  }

  const fileName = buildReportFileName(report, 'pdf');
  let buffer;
  try {
    buffer = await downloadSignedZapSignDocument(signedUrl);
  } catch (error) {
    if (error?.statusCode !== 403) {
      throw error;
    }

    const details = await getZapSignDocument(report.zapsignDocToken);
    const refreshedSignedUrl = String(details?.signedFile || '').trim();
    if (!refreshedSignedUrl || refreshedSignedUrl === signedUrl) {
      throw error;
    }

    await prisma.report.update({
      where: { id: report.id },
      data: {
        zapsignDocUrl: refreshedSignedUrl,
        ...(report.zapsignSignedAt ? {} : { zapsignSignedAt: new Date() })
      }
    });

    buffer = await downloadSignedZapSignDocument(refreshedSignedUrl);
  }
  return { fileName, buffer };
}

async function getReportPdfDownload(report) {
  if (report.status === ReportStatus.SIGNED && report.reportType === ReportType.RDO && report.zapsignDocToken) {
    return resolveSignedPdf(report);
  }

  const saved = await generateReportPdfAsset(report);
  return {
    fileName: saved.fileName,
    buffer: await fs.readFile(saved.targetPath)
  };
}

async function getReportDocxDownload(report) {
  const saved = await generateReportDocxAsset(report);
  return {
    fileName: saved.fileName,
    buffer: await fs.readFile(saved.targetPath)
  };
}

async function fetchReportsForIds(ids) {
  const items = await prisma.report.findMany({
    where: { id: { in: ids } },
    include,
    orderBy: [{ reportDate: 'desc' }, { createdAt: 'desc' }]
  });
  const byId = new Map(items.map(item => [item.id, item]));
  return ids.map(id => byId.get(id)).filter(Boolean);
}

async function assertBatchAccess(auth, reports) {
  if (!reports.length) {
    const error = new Error('Nenhum relatório selecionado.');
    error.statusCode = 400;
    throw error;
  }

  const access = await Promise.all(reports.map(report => canAccessReport(auth, report)));
  if (access.some(allowed => !allowed)) {
    const error = new Error('Você não tem permissão para acessar um ou mais relatórios selecionados.');
    error.statusCode = 403;
    throw error;
  }

  if (auth.user.role === 'CLIENT') {
    const projectIds = Array.from(new Set(reports.map(report => report.projectId).filter(Boolean)));
    const projectReports = await prisma.report.findMany({
      where: { projectId: { in: projectIds } },
      include
    });
    const byId = new Map(projectReports.map(report => [report.id, report]));
    if (reports.some(report => !canClientSeeReport(report, byId))) {
      const error = new Error('Você não tem permissão para acessar um ou mais relatórios selecionados.');
      error.statusCode = 403;
      throw error;
    }
  }
}

function normalizeCommentMap(raw) {
  const out = {};
  Object.entries(raw || {}).forEach(([key, value]) => {
    out[String(key)] = String(value || '').trim();
  });
  return out;
}

const serviceSchema = z.object({
  serviceType: z.string().min(1),
  equipmentId: z.string().nullable().optional(),
  system: z.string().nullable().optional(),
  material: z.string().nullable().optional(),
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  finalized: z.boolean(),
  extraData: z.any().optional()
});

const serviceOnlyServiceSchema = serviceSchema.extend({
  finalized: z.boolean().optional()
});

const schema = z.object({
  projectId: z.string().min(1),
  createdByUserId: z.string().min(1),
  reportType: z.nativeEnum(ReportType).default(ReportType.RDO),
  status: z.nativeEnum(ReportStatus).default(ReportStatus.PENDING),
  reportDate: z.string().min(1),
  arrivalTime: z.string().min(1),
  departureTime: z.string().min(1),
  lunchBreak: z.string().min(1),
  daytimeCount: z.number().int().nonnegative(),
  overtimeReason: z.string().optional().nullable(),
  dailyDescription: z.string().optional().nullable(),
  specialConditions: z.any().optional(),
  collaboratorIds: z.array(z.string()).default([]),
  services: z.array(serviceSchema).default([])
});

const serviceOnlySchema = z.object({
  projectId: z.string().min(1),
  createdByUserId: z.string().min(1),
  reportDate: z.string().min(1),
  collaboratorIds: z.array(z.string()).default([]),
  services: z.array(serviceOnlyServiceSchema).min(1)
});

const positiveIntSchema = z.coerce.number().int().positive();

const updateSchema = schema.omit({
  createdByUserId: true,
  status: true
}).extend({
  sequenceNumber: positiveIntSchema.optional()
});

const statusSchema = z.object({
  status: z.nativeEnum(ReportStatus),
  reviewNotes: z.string().nullable().optional()
});
const sequenceSchema = z.object({
  sequenceNumber: positiveIntSchema
});
const clientReviewSchema = z.object({
  action: z.enum(['APPROVED', 'REJECTED']),
  comment: z.string().trim().max(4000).optional().nullable()
});
const requestSignatureSchema = z.object({
  comment: z.string().trim().max(4000).optional().nullable()
});
const batchDownloadSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
  format: z.enum(['pdf', 'docx'])
});
const batchSignatureSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(15),
  commentsById: z.record(z.string(), z.any()).optional()
});

function uniqueIds(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function cloneJson(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function stripInternalEditState(specialConditions) {
  if (!specialConditions || typeof specialConditions !== 'object' || Array.isArray(specialConditions)) {
    return specialConditions || {};
  }

  const cleaned = cloneJson(specialConditions) || {};
  delete cleaned.__editOriginalSnapshot;
  delete cleaned.__editMeta;
  return cleaned;
}

function extractInternalEditState(specialConditions) {
  if (!specialConditions || typeof specialConditions !== 'object' || Array.isArray(specialConditions)) {
    return {};
  }

  const state = {};
  if (specialConditions.__editOriginalSnapshot) state.__editOriginalSnapshot = cloneJson(specialConditions.__editOriginalSnapshot);
  if (specialConditions.__editMeta) state.__editMeta = cloneJson(specialConditions.__editMeta);
  return state;
}

function buildReportSnapshot(report) {
  return {
    projectId: report.projectId,
    createdByUserId: report.createdByUserId || null,
    reportType: report.reportType,
    status: report.status,
    reportDate: report.reportDate ? new Date(report.reportDate).toISOString().slice(0, 10) : null,
    arrivalTime: report.arrivalTime,
    departureTime: report.departureTime,
    lunchBreak: report.lunchBreak,
    daytimeCount: report.daytimeCount,
    overtimeReason: report.overtimeReason || null,
    dailyDescription: report.dailyDescription || null,
    reviewNotes: report.reviewNotes || null,
    reviewedByUserId: report.reviewedByUserId || null,
    approvedAt: report.approvedAt ? new Date(report.approvedAt).toISOString() : null,
    returnedAt: report.returnedAt ? new Date(report.returnedAt).toISOString() : null,
    specialConditions: stripInternalEditState(report.specialConditions || {}),
    collaboratorIds: (report.collaborators || []).map(link => link.collaboratorId).filter(Boolean),
    collaborators: (report.collaborators || []).map(link => ({
      collaboratorId: link.collaboratorId,
      name: link.collaborator?.name || null,
      role: link.collaborator?.role || null
    })),
    services: (report.services || []).map(service => ({
      serviceType: service.serviceType,
      equipmentId: service.equipmentId || null,
      system: service.system || null,
      material: service.material || null,
      startTime: service.startTime || null,
      endTime: service.endTime || null,
      finalized: typeof service.finalized === 'boolean' ? service.finalized : null,
      extraData: cloneJson(service.extraData || {})
    }))
  };
}

function buildReportUpdateFromSnapshot(project, snapshot) {
  const overtime = calculateReportOvertime(project, snapshot);
  return {
    projectId: snapshot.projectId,
    reportType: snapshot.reportType,
    status: snapshot.status || ReportStatus.APPROVED,
    reportDate: new Date(snapshot.reportDate),
    arrivalTime: snapshot.arrivalTime,
    departureTime: snapshot.departureTime,
    lunchBreak: snapshot.lunchBreak,
    daytimeCount: snapshot.daytimeCount,
    daytimeWorkedMinutes: overtime.daytimeWorkedMinutes,
    nighttimeWorkedMinutes: overtime.nighttimeWorkedMinutes,
    daytimeOvertimeMinutes: overtime.daytimeOvertimeMinutes,
    nighttimeOvertimeMinutes: overtime.nighttimeOvertimeMinutes,
    totalOvertimeMinutes: overtime.totalOvertimeMinutes,
    overtimeReason: snapshot.overtimeReason || null,
    dailyDescription: snapshot.dailyDescription || null,
    reviewNotes: snapshot.reviewNotes || null,
    reviewedByUserId: snapshot.reviewedByUserId || null,
    approvedAt: snapshot.approvedAt ? new Date(snapshot.approvedAt) : null,
    returnedAt: snapshot.returnedAt ? new Date(snapshot.returnedAt) : null,
    specialConditions: {
      ...(stripInternalEditState(snapshot.specialConditions || {})),
      overtimeSummary: overtime
    },
    pendingDerivedTypes: collectPendingDerivedTypes(snapshot.services || []),
    collaborators: {
      create: uniqueIds(snapshot.collaboratorIds).map(collaboratorId => ({ collaboratorId }))
    },
    services: {
      create: (snapshot.services || []).map(service => ({
        serviceType: service.serviceType,
        equipmentId: service.equipmentId || null,
        system: service.system || null,
        material: service.material || null,
        startTime: service.startTime || null,
        endTime: service.endTime || null,
        finalized: typeof service.finalized === 'boolean' ? service.finalized : null,
        extraData: service.extraData || {}
      }))
    }
  };
}

async function restoreReportFromSnapshot(tx, reportId, originalSnapshot) {
  const project = await tx.project.findUniqueOrThrow({
    where: { id: originalSnapshot.projectId }
  });

  await tx.reportCollaborator.deleteMany({ where: { reportId } });
  await tx.reportService.deleteMany({ where: { reportId } });

  const restored = await tx.report.update({
    where: { id: reportId },
    data: buildReportUpdateFromSnapshot(project, originalSnapshot),
    include
  });

  await syncApprovedRtpReports(tx, restored);
  await syncApprovedRlqReports(tx, restored);
  await syncApprovedRcpReports(tx, restored);
  await syncApprovedRlmReports(tx, restored);
  return restored;
}

function resolveCollaboratorsByShift(report, collaborators) {
  const daytimeIds = new Set((report.collaborators || []).map(link => link.collaboratorId).filter(Boolean));
  const nighttimeIds = new Set(
    (((report.specialConditions || {}).noturnoDetails || {}).collaboratorIds || []).filter(Boolean)
  );

  return collaborators.flatMap(c => {
    const inDay = daytimeIds.has(c.id);
    const inNight = nighttimeIds.has(c.id);
    if (!inDay && !inNight) return [];
    const shift = inDay && inNight ? 'Diurno e Noturno' : (inNight ? 'Noturno' : 'Diurno');
    return [{ id: c.id, name: c.name, role: c.role, shift }];
  });
}

function safePathLocal(value) {
  return String(value ?? '').replace(/[<>:"/\\|?*\n\r]/g, '_').trim();
}

function applyUrlMap(obj, urlMap) {
  if (!urlMap || !urlMap.size) return obj;
  let json = JSON.stringify(obj);
  for (const [oldUrl, newUrl] of urlMap.entries()) {
    const escapedOld = JSON.stringify(oldUrl).slice(1, -1);
    const escapedNew = JSON.stringify(newUrl).slice(1, -1);
    json = json.split(escapedOld).join(escapedNew);
  }
  try { return JSON.parse(json); } catch { return obj; }
}

function expandUploadGroupsInServiceData(serviceData, fallbackData) {
  const next = cloneJson(serviceData || {}) || {};
  const groups = [];
  [fallbackData, serviceData].forEach(source => {
    if (Array.isArray(source?.__uploads__)) groups.push(...source.__uploads__);
  });

  groups.forEach(group => {
    if (!group || typeof group !== 'object' || Array.isArray(group)) return;
    const label = String(group.label || '').trim();
    const files = Array.isArray(group.files) ? group.files.filter(Boolean) : [];
    if (!label || !files.length) return;
    if (!hasReportFieldValue(next[label])) next[label] = files;
    if (label === 'Foto do laudo' && !hasReportFieldValue(next['Foto do laudo do contador'])) {
      next['Foto do laudo do contador'] = files;
    }
  });

  return next;
}

function withServiceUploadFields(report) {
  if (!report || report.reportType === ReportType.RDO) return report;
  const specialConditions = report.specialConditions || {};
  const serviceData = specialConditions.serviceData || {};
  const serviceExtraData = report.services?.[0]?.extraData || {};
  return {
    ...report,
    specialConditions: {
      ...specialConditions,
      serviceData: expandUploadGroupsInServiceData(serviceData, serviceExtraData)
    }
  };
}

async function organizeAndPersist(report) {
  report = withServiceUploadFields(report);
  const projectFolderName = safePathLocal(`Missão ${report.project.code} - ${report.project.name}`);
  let urlMap;
  if (report.reportType === 'RTP') {
    urlMap = await organizeRtpPhotos(report, projectFolderName);
  } else if (report.reportType === 'RLQ') {
    urlMap = await organizeRlqPhotos(report, projectFolderName);
  } else if (report.reportType === 'RCPU') {
    urlMap = await organizeRcpPhotos(report, projectFolderName);
  } else if (report.reportType === 'RLM') {
    urlMap = await organizeRlmPhotos(report, projectFolderName);
  } else {
    urlMap = await organizePhotos(report, projectFolderName);
  }
  if (urlMap && urlMap.size > 0) {
    const newSC = applyUrlMap(report.specialConditions, urlMap);
    await prisma.report.update({ where: { id: report.id }, data: { specialConditions: newSC } });

    if (report.specialConditions?.serviceOnly === true) {
      for (const service of (report.services || [])) {
        if (!service.id) continue;
        const newExtraData = applyUrlMap(service.extraData, urlMap);
        await prisma.reportService.update({
          where: { id: service.id },
          data: { extraData: newExtraData }
        });
      }
    }

    // Para RTP/RLQ, também atualiza o extraData do serviço-fonte do RDO para que
    // re-edições do RDO não percam as URLs organizadas das fotos.
    const sourceServiceId = report.specialConditions?.serviceId;
    if (sourceServiceId && (report.reportType === 'RTP' || report.reportType === 'RLQ' || report.reportType === 'RCPU' || report.reportType === 'RLM')) {
      try {
        const sourceService = await prisma.reportService.findUnique({
          where: { id: sourceServiceId },
          select: { id: true, extraData: true }
        });
        if (sourceService) {
          const newExtraData = applyUrlMap(sourceService.extraData, urlMap);
          await prisma.reportService.update({
            where: { id: sourceServiceId },
            data: { extraData: newExtraData }
          });
        }
      } catch { /* best effort */ }
    }
  }
}

function collectPendingDerivedTypes(services) {
  const derived = new Set();

  for (const service of services || []) {
    if (service.finalized !== true) continue;

    switch (service.serviceType) {
      case 'limpeza':
        derived.add(ReportType.RLQ);
        break;
      case 'pressao':
        derived.add(ReportType.RTP);
        break;
      case 'filtragem':
        derived.add(ReportType.RCPU);
        break;
      case 'flushing':
        derived.add(ReportType.RCPU);
        break;
      case 'mecanica':
        derived.add(ReportType.RLM);
        break;
      case 'inibicao':
        derived.add(ReportType.RLI);
        derived.add(ReportType.RLF);
        break;
      default:
        break;
    }
  }

  return Array.from(derived);
}

async function reserveSequence(tx, projectId, reportType) {
  const existing = await tx.projectReportSeq.findUnique({
    where: {
      projectId_reportType: {
        projectId,
        reportType
      }
    }
  });

  if (!existing) {
    await tx.projectReportSeq.create({
      data: {
        projectId,
        reportType,
        nextNumber: 1
      }
    });
    return 1;
  }

  const sequenceNumber = (existing.nextNumber > 0 ? existing.nextNumber : 0) + 1;

  await tx.projectReportSeq.update({
    where: {
      projectId_reportType: {
        projectId,
        reportType
      }
    },
    data: {
      nextNumber: sequenceNumber
    }
  });

  return sequenceNumber;
}

async function syncProjectReportSequence(tx, projectId, reportType, sequenceNumber) {
  if (!projectId || !reportType || !Number.isInteger(sequenceNumber) || sequenceNumber < 1) return;
  const aggregate = await tx.report.aggregate({
    where: {
      projectId,
      reportType
    },
    _max: {
      sequenceNumber: true
    }
  });
  const lastUsedNumber = Math.max(sequenceNumber, aggregate._max.sequenceNumber || 0);
  const existing = await tx.projectReportSeq.findUnique({
    where: {
      projectId_reportType: {
        projectId,
        reportType
      }
    }
  });
  if (!existing) {
    await tx.projectReportSeq.create({
      data: {
        projectId,
        reportType,
        nextNumber: lastUsedNumber
      }
    });
    return;
  }
  await tx.projectReportSeq.update({
    where: {
      projectId_reportType: {
        projectId,
        reportType
      }
    },
    data: {
      nextNumber: lastUsedNumber
    }
  });
}

async function prepareReportSequenceChange(tx, currentReport, targetProjectId, targetReportType, targetSequenceNumber) {
  if (!Number.isInteger(targetSequenceNumber) || targetSequenceNumber < 1) return null;

  const currentSequenceNumber = currentReport.sequenceNumber;
  const sameGroup = currentReport.projectId === targetProjectId && currentReport.reportType === targetReportType;
  if (sameGroup && currentSequenceNumber === targetSequenceNumber) return null;

  const conflicting = await tx.report.findFirst({
    where: {
      projectId: targetProjectId,
      reportType: targetReportType,
      sequenceNumber: targetSequenceNumber,
      id: { not: currentReport.id }
    },
    select: {
      id: true,
      status: true
    }
  });

  if (!conflicting) return null;

  if (!sameGroup || !Number.isInteger(currentSequenceNumber) || currentSequenceNumber < 1) {
    const error = new Error('Ja existe um relatorio deste projeto e tipo usando este numero.');
    error.statusCode = 409;
    throw error;
  }

  if (conflicting.status === ReportStatus.SIGNED) {
    const error = new Error('Nao e possivel trocar numeracao com um relatorio assinado.');
    error.statusCode = 409;
    throw error;
  }

  await tx.report.update({
    where: { id: conflicting.id },
    data: { sequenceNumber: null }
  });

  return {
    id: conflicting.id,
    sequenceNumber: currentSequenceNumber
  };
}

async function finishReportSequenceChange(tx, swappedReport) {
  if (!swappedReport) return;
  await tx.report.update({
    where: { id: swappedReport.id },
    data: {
      sequenceNumber: swappedReport.sequenceNumber
    }
  });
}

function projectLeaderSnapshot(project) {
  if (!project || !project.operator) return null;
  return {
    name: project.operator.name || null,
    role: project.operator.role || null,
    signatureImage: project.operator.signatureImage || null
  };
}

async function validateDerivedReportSequenceMove(tx, existingReport, targetProjectId, targetReportType) {
  if (!existingReport || existingReport.projectId === targetProjectId) return;
  if (!Number.isInteger(existingReport.sequenceNumber) || existingReport.sequenceNumber < 1) return;
  const sequenceSwap = await prepareReportSequenceChange(
    tx,
    existingReport,
    targetProjectId,
    targetReportType,
    existingReport.sequenceNumber
  );
  await finishReportSequenceChange(tx, sequenceSwap);
  await syncProjectReportSequence(tx, targetProjectId, targetReportType, existingReport.sequenceNumber);
}

async function syncApprovedRtpReports(tx, report) {
  if (!report || report.reportType !== ReportType.RDO || report.status !== ReportStatus.APPROVED) {
    return;
  }

  const pressaoServices = (report.services || []).filter(
    service => service.serviceType === 'pressao' && service.finalized === true
  );

  if (!pressaoServices.length) {
    return;
  }

  const existingRtps = await tx.report.findMany({
    where: {
      reportType: ReportType.RTP
    },
    select: {
      id: true,
      projectId: true,
      reportType: true,
      sequenceNumber: true,
      status: true,
      specialConditions: true
    }
  });

  const existingByLinkKey = new Map();
  existingRtps.forEach(item => {
    const special = item.specialConditions || {};
    if (special.parentRdoId !== report.id) {
      return;
    }
    const linkKey = String(special.serviceLinkKey || special.serviceId || '').trim();
    if (linkKey) {
      existingByLinkKey.set(linkKey, item);
    }
  });

  const allApprovedRdos = await tx.report.findMany({
    where: { projectId: report.projectId, reportType: ReportType.RDO, status: ReportStatus.APPROVED },
    orderBy: [{ reportDate: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      reportDate: true,
      createdAt: true,
      services: {
        select: { id: true, serviceType: true, startTime: true, endTime: true, extraData: true }
      }
    }
  });

  for (const service of pressaoServices) {
    const fields = service.extraData || {};
    const serviceLinkKey = serviceHistoryKey(service) || String(service.id || '').trim();
    const serviceHistory = [];
    for (const rdo of allApprovedRdos) {
      for (const svc of rdo.services || []) {
        if (svc.serviceType !== service.serviceType) continue;
        if (hasSharedServiceHistoryKey(service, svc) || svc.id === service.id) {
          serviceHistory.push({ rdo, svc, fields: svc.extraData || {} });
        }
      }
    }
    if (!serviceHistory.length) {
      serviceHistory.push({ rdo: report, svc: service, fields });
    }
    const consolidatedFields = buildHistoricalServiceData(fields, serviceHistory);

    const collabField =
      fields['Colaboradores do serviço'] ||
      fields['Colaboradores do serviÃ§o'] ||
      fields['Colaboradores do servico'];
    const collabIds = [...new Set(Array.isArray(collabField?.ids) ? collabField.ids.filter(Boolean) : [])];

    const manoField =
      fields['Manômetros utilizados'] ||
      fields['ManÃ´metros utilizados'] ||
      fields['Manometros utilizados'];
    const manoIds = Array.isArray(manoField?.ids) ? manoField.ids.filter(Boolean) : [];

    const uthField = fields['Unidade de Teste Hidrostático (UTH)'] ||
      fields['Unidade de Teste HidrostÃ¡tico (UTH)'] ||
      fields['Unidade de Teste Hidrostatico (UTH)'];
    const uthIds = Array.isArray(uthField?.ids) ? uthField.ids.filter(Boolean)
      : (uthField && typeof uthField === 'string' ? [uthField] : []);

    const [collaborators, manometers, uthUnits] = await Promise.all([
      collabIds.length ? tx.collaborator.findMany({ where: { id: { in: collabIds } } }) : Promise.resolve([]),
      manoIds.length ? tx.manometer.findMany({ where: { id: { in: manoIds } } }) : Promise.resolve([]),
      uthIds.length ? tx.unit.findMany({ where: { id: { in: uthIds } } }) : Promise.resolve([])
    ]);

    const resolvedCollaborators = resolveCollaboratorsByShift(report, collaborators);
    const resolvedManometers = manometers.map(m => ({
      id: m.id,
      code: m.code,
      scale: m.scale,
      certCode: m.calibrationCertCode,
      calibratedAt: m.calibratedAt ? m.calibratedAt.toISOString().slice(0, 10) : '',
      expiresAt: m.expiresAt ? m.expiresAt.toISOString().slice(0, 10) : ''
    }));
    const resolvedUnits = uthUnits.map(u => u.code);

    const rtpPayload = {
      projectId: report.projectId,
      createdByUserId: report.createdByUserId,
      reviewedByUserId: report.reviewedByUserId,
      reportType: ReportType.RTP,
      status: ReportStatus.APPROVED,
      reportDate: report.reportDate,
      arrivalTime: service.startTime || report.arrivalTime,
      departureTime: service.endTime || report.departureTime,
      lunchBreak: report.lunchBreak,
      daytimeCount: resolvedCollaborators.length || report.daytimeCount,
      daytimeWorkedMinutes: 0,
      nighttimeWorkedMinutes: 0,
      daytimeOvertimeMinutes: 0,
      nighttimeOvertimeMinutes: 0,
      totalOvertimeMinutes: 0,
      approvedAt: report.approvedAt || new Date(),
      specialConditions: {
        parentRdoId: report.id,
        serviceId: service.id,
        serviceLinkKey: serviceLinkKey || String(service.id),
        serviceData: consolidatedFields,
        resolvedCollaborators,
        resolvedManometers,
        resolvedUnits,
        __leaderSnapshot: report.specialConditions?.__leaderSnapshot || null
      }
    };

    const existingRtp = serviceLinkKey ? findExistingByLinkKeys(existingByLinkKey, service, service.id) : null;

    if (existingRtp) {
      await validateDerivedReportSequenceMove(tx, existingRtp, report.projectId, ReportType.RTP);
      await tx.reportCollaborator.deleteMany({ where: { reportId: existingRtp.id } });
      await tx.reportService.deleteMany({ where: { reportId: existingRtp.id } });
      await tx.report.update({
        where: { id: existingRtp.id },
        data: {
          ...rtpPayload,
          collaborators: {
            create: collabIds.map(id => ({ collaboratorId: id }))
          },
          services: {
            create: [{
              serviceType: service.serviceType,
              equipmentId: service.equipmentId || null,
              system: service.system || null,
              material: service.material || null,
              startTime: service.startTime || null,
              endTime: service.endTime || null,
              finalized: true,
              extraData: consolidatedFields
            }]
          }
        }
      });
      continue;
    }

    const rtpSeq = await reserveSequence(tx, report.projectId, ReportType.RTP);

    await tx.report.create({
      data: {
        ...rtpPayload,
        sequenceNumber: rtpSeq,
        collaborators: {
          create: collabIds.map(id => ({ collaboratorId: id }))
        },
        services: {
          create: [{
            serviceType: service.serviceType,
            equipmentId: service.equipmentId || null,
            system: service.system || null,
            material: service.material || null,
            startTime: service.startTime || null,
            endTime: service.endTime || null,
            finalized: true,
            extraData: consolidatedFields
          }]
        }
      }
    });
  }
}

async function syncApprovedRlqReports(tx, report) {
  if (!report || report.reportType !== ReportType.RDO || report.status !== ReportStatus.APPROVED) {
    return;
  }

  const limpezaServices = (report.services || []).filter(
    service => service.serviceType === 'limpeza' && service.finalized === true
  );

  if (!limpezaServices.length) {
    return;
  }

  const existingRlqs = await tx.report.findMany({
    where: {
      reportType: ReportType.RLQ
    },
    select: {
      id: true,
      projectId: true,
      reportType: true,
      sequenceNumber: true,
      status: true,
      specialConditions: true
    }
  });

  const existingByLinkKey = new Map();
  existingRlqs.forEach(item => {
    const special = item.specialConditions || {};
    const linkKey = String(special.serviceLinkKey || '').trim();
    const serviceId = String(special.serviceId || '').trim();
    if (linkKey) existingByLinkKey.set(linkKey, item);
    if (serviceId) existingByLinkKey.set(serviceId, item);
  });

  const allApprovedRdos = await tx.report.findMany({
    where: { projectId: report.projectId, reportType: ReportType.RDO, status: ReportStatus.APPROVED },
    orderBy: [{ reportDate: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      reportDate: true,
      createdAt: true,
      services: {
        select: { id: true, serviceType: true, startTime: true, endTime: true, extraData: true }
      }
    }
  });

  for (const service of limpezaServices) {
    const fields = service.extraData || {};
    const serviceLinkKey = serviceHistoryKey(service) || String(service.id || '').trim();
    const serviceHistory = [];
    for (const rdo of allApprovedRdos) {
      for (const svc of rdo.services || []) {
        if (svc.serviceType !== service.serviceType) continue;
        if (hasSharedServiceHistoryKey(service, svc) || svc.id === service.id) {
          serviceHistory.push({ rdo, svc, fields: svc.extraData || {} });
        }
      }
    }
    if (!serviceHistory.length) {
      serviceHistory.push({ rdo: report, svc: service, fields });
    }
    const consolidatedFields = buildHistoricalServiceData(fields, serviceHistory);

    const collabField =
      consolidatedFields['Colaboradores do serviço'] ||
      consolidatedFields['Colaboradores do serviÃ§o'] ||
      consolidatedFields['Colaboradores do servico'];
    const collabIds = [...new Set(Array.isArray(collabField?.ids) ? collabField.ids.filter(Boolean) : [])];

    const ulqField =
      consolidatedFields['Unidade de Limpeza Química'] ||
      consolidatedFields['Unidade de Limpeza QuÃ­mica'] ||
      consolidatedFields['Unidade de Limpeza Quimica'];
    const ulqIds = Array.isArray(ulqField?.ids) ? ulqField.ids.filter(Boolean)
      : (ulqField && typeof ulqField === 'string' ? [ulqField] : []);

    const [collaborators, ulqUnits] = await Promise.all([
      collabIds.length ? tx.collaborator.findMany({ where: { id: { in: collabIds } } }) : Promise.resolve([]),
      ulqIds.length ? tx.unit.findMany({ where: { id: { in: ulqIds } } }) : Promise.resolve([])
    ]);

    const resolvedCollaborators = resolveCollaboratorsByShift(report, collaborators);
    const resolvedUnits = ulqUnits.map(u => u.code);

    const rlqPayload = {
      projectId: report.projectId,
      createdByUserId: report.createdByUserId,
      reviewedByUserId: report.reviewedByUserId,
      reportType: ReportType.RLQ,
      status: ReportStatus.APPROVED,
      reportDate: report.reportDate,
      arrivalTime: service.startTime || report.arrivalTime,
      departureTime: service.endTime || report.departureTime,
      lunchBreak: report.lunchBreak,
      daytimeCount: resolvedCollaborators.length || report.daytimeCount,
      daytimeWorkedMinutes: 0,
      nighttimeWorkedMinutes: 0,
      daytimeOvertimeMinutes: 0,
      nighttimeOvertimeMinutes: 0,
      totalOvertimeMinutes: 0,
      approvedAt: report.approvedAt || new Date(),
      specialConditions: {
        parentRdoId: report.id,
        serviceId: service.id,
        serviceLinkKey: serviceLinkKey || String(service.id),
        serviceData: consolidatedFields,
        resolvedCollaborators,
        resolvedUnits,
        __leaderSnapshot: report.specialConditions?.__leaderSnapshot || null
      }
    };

    const existingRlq = serviceLinkKey ? findExistingByLinkKeys(existingByLinkKey, service, service.id) : null;

    if (existingRlq) {
      await validateDerivedReportSequenceMove(tx, existingRlq, report.projectId, ReportType.RLQ);
      await tx.reportCollaborator.deleteMany({ where: { reportId: existingRlq.id } });
      await tx.reportService.deleteMany({ where: { reportId: existingRlq.id } });
      await tx.report.update({
        where: { id: existingRlq.id },
        data: {
          ...rlqPayload,
          collaborators: {
            create: collabIds.map(id => ({ collaboratorId: id }))
          },
          services: {
            create: [{
              serviceType: service.serviceType,
              equipmentId: service.equipmentId || null,
              system: service.system || null,
              material: service.material || null,
              startTime: service.startTime || null,
              endTime: service.endTime || null,
              finalized: true,
              extraData: consolidatedFields
            }]
          }
        }
      });
      continue;
    }

    const rlqSeq = await reserveSequence(tx, report.projectId, ReportType.RLQ);

    await tx.report.create({
      data: {
        ...rlqPayload,
        sequenceNumber: rlqSeq,
        collaborators: {
          create: collabIds.map(id => ({ collaboratorId: id }))
        },
        services: {
          create: [{
            serviceType: service.serviceType,
            equipmentId: service.equipmentId || null,
            system: service.system || null,
            material: service.material || null,
            startTime: service.startTime || null,
            endTime: service.endTime || null,
            finalized: true,
            extraData: consolidatedFields
          }]
        }
      }
    });
  }
}

function hasReportFieldValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') {
    if (Array.isArray(value.ids)) return value.ids.filter(Boolean).length > 0;
    if (Array.isArray(value.codes)) return value.codes.filter(Boolean).length > 0;
    if (Array.isArray(value.labels)) return value.labels.filter(Boolean).length > 0;
    return Object.values(value).some(item => hasReportFieldValue(item));
  }
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function getReportField(fields, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(fields || {}, name) && hasReportFieldValue(fields[name])) {
      return fields[name];
    }
  }
  return undefined;
}

function isYesReportField(value) {
  return /sim/i.test(Array.isArray(value) ? value.filter(Boolean).join(', ') : String(value || ''));
}

function explicitServiceHistoryKey(service) {
  const fields = service?.extraData || {};
  return String(fields.__ongoingKey || fields.__serviceLinkKey || fields.__sourceServiceId || '').trim();
}

function semanticServiceHistoryKey(service) {
  const fields = service?.extraData || {};
  const equipment = getReportField(fields, ['Equipamento(s)', 'Equipamento', 'ID da embarcação', 'ID da embarcacao']) || service?.equipmentId || '';
  const system = getReportField(fields, ['Sistema']) || service?.system || '';
  return [
    service?.serviceType || '',
    String(equipment || '').trim().toLowerCase(),
    String(system || '').trim().toLowerCase()
  ].join('||');
}

function serviceHistoryKey(service) {
  return explicitServiceHistoryKey(service) || semanticServiceHistoryKey(service);
}

function serviceHistoryKeys(service) {
  const keys = new Set();
  const explicit = explicitServiceHistoryKey(service);
  if (explicit) keys.add(explicit);
  else keys.add(semanticServiceHistoryKey(service));

  return Array.from(keys).filter(Boolean);
}

function hasSharedServiceHistoryKey(left, right) {
  const leftExplicit = explicitServiceHistoryKey(left);
  const rightExplicit = explicitServiceHistoryKey(right);
  if (leftExplicit || rightExplicit) {
    return Boolean(leftExplicit && rightExplicit && leftExplicit === rightExplicit);
  }
  const rightKeys = new Set(serviceHistoryKeys(right));
  return serviceHistoryKeys(left).some(key => rightKeys.has(key));
}

function findExistingByLinkKeys(existingByLinkKey, service, serviceId) {
  for (const key of serviceHistoryKeys(service)) {
    const existing = existingByLinkKey.get(key);
    if (existing) return existing;
  }
  return serviceId ? existingByLinkKey.get(String(serviceId)) : null;
}

function buildHistoricalServiceData(currentFields, serviceHistory) {
  const data = { ...(currentFields || {}) };
  const firstField = names => {
    for (const item of serviceHistory) {
      const value = getReportField(item.fields, names);
      if (hasReportFieldValue(value)) return value;
    }
    return undefined;
  };
  const lastField = names => {
    for (let i = serviceHistory.length - 1; i >= 0; i--) {
      const value = getReportField(serviceHistory[i].fields, names);
      if (hasReportFieldValue(value)) return value;
    }
    return undefined;
  };
  const copyIfPresent = (targetKey, value) => {
    if (value !== undefined) data[targetKey] = value;
  };

  copyIfPresent('Contagem inicial NAS', firstField(['Contagem inicial NAS', 'NAS inicial', 'Valor NAS inicial']));
  copyIfPresent('Contagem inicial ISO', firstField(['Contagem inicial ISO', 'ISO inicial', 'Classe ISO inicial', 'Valor ISO inicial']));
  copyIfPresent('Contagem final NAS', lastField(['Contagem final NAS', 'NAS final', 'Valor NAS final']));
  copyIfPresent('Contagem final ISO', lastField(['Contagem final ISO', 'ISO final', 'Classe ISO final', 'Valor ISO final']));
  copyIfPresent('Umidade inicial (ppm)', firstField(['Umidade inicial (ppm)']));
  copyIfPresent('Umidade final (ppm)', lastField(['Umidade final (ppm)']));
  copyIfPresent('Contador utilizado', lastField(['Contador utilizado']));
  copyIfPresent('Foto do laudo do contador', lastField(['Foto do laudo do contador', 'Foto laudo do contador']));
  copyIfPresent('Equipamento de desidratação', lastField(['Equipamento de desidratação', 'Equipamento de desidratacao']));
  copyIfPresent('Foto análise inicial', lastField(['Foto análise inicial', 'Foto analise inicial']));
  copyIfPresent('Foto análise final', lastField(['Foto análise final', 'Foto analise final']));
  const allSteps = [];
  const seenSteps = new Set();
  for (const item of serviceHistory) {
    const steps = getReportField(item.fields, ['Etapas realizadas no dia']);
    const arr = Array.isArray(steps) ? steps : (steps ? [steps] : []);
    for (const step of arr) {
      const label = String(step || '').trim();
      const key = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (label && !seenSteps.has(key)) {
        seenSteps.add(key);
        allSteps.push(label);
      }
    }
  }
  if (allSteps.length) data['Etapas realizadas no dia'] = allSteps;

  const hasParticleData = serviceHistory.some(item => (
    isYesReportField(getReportField(item.fields, ['Houve contagem de partículas?', 'Houve contagem de particulas?'])) ||
    getReportField(item.fields, ['Contador utilizado', 'Contagem inicial NAS', 'Contagem final NAS', 'Contagem inicial ISO', 'Contagem final ISO', 'Foto do laudo do contador', 'Foto laudo do contador'])
  ));
  if (hasParticleData) data['Houve contagem de partículas?'] = 'Sim';

  const hasHumidityData = serviceHistory.some(item => (
    isYesReportField(getReportField(item.fields, ['Houve desidratação?', 'Houve desidratacao?', 'Houve análise de umidade?', 'Houve analise de umidade?'])) ||
    getReportField(item.fields, ['Umidade inicial (ppm)', 'Umidade final (ppm)', 'Equipamento de desidratação', 'Equipamento de desidratacao'])
  ));
  if (hasHumidityData) {
    data['Houve desidratação?'] = 'Sim';
    data['Houve análise de umidade?'] = 'Sim';
  }

  return data;
}

async function syncApprovedRcpReports(tx, report) {
  if (!report || report.reportType !== ReportType.RDO || report.status !== ReportStatus.APPROVED) {
    return;
  }

  const rcpServices = (report.services || []).filter(
    s => (s.serviceType === 'flushing' || s.serviceType === 'filtragem') && s.finalized === true
  );

  if (!rcpServices.length) {
    return;
  }

  // For RCPU, one report per serviceLinkKey for the whole project (not per parentRdoId).
  const existingRcps = await tx.report.findMany({
    where: { projectId: report.projectId, reportType: ReportType.RCPU },
    select: { id: true, projectId: true, reportType: true, sequenceNumber: true, status: true, specialConditions: true }
  });

  const existingByLinkKey = new Map();
  existingRcps.forEach(item => {
    const special = item.specialConditions || {};
    const linkKey = String(special.serviceLinkKey || '').trim();
    const serviceId = String(special.serviceId || '').trim();
    if (linkKey) existingByLinkKey.set(linkKey, item);
    if (serviceId) existingByLinkKey.set(serviceId, item);
  });

  // Fetch all approved RDOs once for totalMinutes calculation.
  const allApprovedRdos = await tx.report.findMany({
    where: { projectId: report.projectId, reportType: ReportType.RDO, status: ReportStatus.APPROVED },
    orderBy: [{ reportDate: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      reportDate: true,
      createdAt: true,
      services: {
        select: { id: true, serviceType: true, equipmentId: true, system: true, material: true, startTime: true, endTime: true, extraData: true }
      }
    }
  });

  for (const service of rcpServices) {
    const fields = service.extraData || {};
    const serviceLinkKey = serviceHistoryKey(service) || String(service.id || '').trim();

    const serviceHistory = [];
    for (const rdo of allApprovedRdos) {
      for (const svc of rdo.services || []) {
        if (svc.serviceType !== service.serviceType) continue;
        if (hasSharedServiceHistoryKey(service, svc) || svc.id === service.id) {
          serviceHistory.push({ rdo, svc, fields: svc.extraData || {} });
        }
      }
    }
    if (!serviceHistory.length) {
      serviceHistory.push({ rdo: report, svc: service, fields });
    }
    const consolidatedFields = buildHistoricalServiceData(fields, serviceHistory);

    const collabField =
      consolidatedFields['Colaboradores do serviço'] ||
      consolidatedFields['Colaboradores do serviÃ§o'] ||
      consolidatedFields['Colaboradores do servico'];
    const collabIds = [...new Set(Array.isArray(collabField?.ids) ? collabField.ids.filter(Boolean) : [])];

    const unitFieldVal = service.serviceType === 'filtragem'
      ? (consolidatedFields['Unidade de filtragem'] || consolidatedFields['Unidade de Filtragem'])
      : (consolidatedFields['Unidade de Flushing'] || consolidatedFields['Unidade de flushing']);
    const unitIds = Array.isArray(unitFieldVal?.ids) ? unitFieldVal.ids.filter(Boolean)
      : (unitFieldVal && typeof unitFieldVal === 'string' ? [unitFieldVal] : []);

    const thermoFieldVal =
      consolidatedFields['Equipamento de desidratação'] ||
      consolidatedFields['Equipamento de desidrataÃ§Ã£o'] ||
      consolidatedFields['Equipamento de desidratacao'];
    const thermoIds = Array.isArray(thermoFieldVal?.ids) ? thermoFieldVal.ids.filter(Boolean)
      : (thermoFieldVal && typeof thermoFieldVal === 'string' ? [thermoFieldVal] : []);

    const counterRaw = consolidatedFields['Contador utilizado'];
    const counterId = counterRaw && typeof counterRaw === 'string' ? counterRaw
      : (counterRaw?.id || null);

    const [collaborators, units, thermoUnits, counter] = await Promise.all([
      collabIds.length ? tx.collaborator.findMany({ where: { id: { in: collabIds } } }) : Promise.resolve([]),
      unitIds.length ? tx.unit.findMany({ where: { id: { in: unitIds } } }) : Promise.resolve([]),
      thermoIds.length ? tx.unit.findMany({ where: { id: { in: thermoIds } } }) : Promise.resolve([]),
      counterId ? tx.particleCounter.findUnique({ where: { id: counterId } }) : Promise.resolve(null)
    ]);

    const resolvedCollaborators = resolveCollaboratorsByShift(report, collaborators);
    const resolvedUnits = units.map(u => u.code);
    const resolvedThermoUnit = thermoUnits.length ? thermoUnits[0].code : '';
    const resolvedCounter = counter ? { code: counter.code, serialNumber: counter.serialNumber } : null;

    // Sum minutes across all approved RDOs with the same service linkKey.
    let totalMinutes = 0;
    for (const item of serviceHistory) totalMinutes += calcServiceMinutes(item.svc.startTime, item.svc.endTime);

    const rcpPayload = {
      projectId: report.projectId,
      createdByUserId: report.createdByUserId,
      reviewedByUserId: report.reviewedByUserId,
      reportType: ReportType.RCPU,
      status: ReportStatus.APPROVED,
      reportDate: report.reportDate,
      arrivalTime: service.startTime || report.arrivalTime,
      departureTime: service.endTime || report.departureTime,
      lunchBreak: report.lunchBreak,
      daytimeCount: resolvedCollaborators.length || report.daytimeCount,
      daytimeWorkedMinutes: 0,
      nighttimeWorkedMinutes: 0,
      daytimeOvertimeMinutes: 0,
      nighttimeOvertimeMinutes: 0,
      totalOvertimeMinutes: 0,
      approvedAt: report.approvedAt || new Date(),
      specialConditions: {
        parentRdoId: report.id,
        serviceId: service.id,
        serviceLinkKey: serviceLinkKey || String(service.id),
        serviceType: service.serviceType,
        serviceData: consolidatedFields,
        resolvedCollaborators,
        resolvedUnits,
        resolvedThermoUnit,
        resolvedCounter,
        totalMinutes,
        __leaderSnapshot: report.specialConditions?.__leaderSnapshot || null
      }
    };

    const existingRcp = serviceLinkKey ? findExistingByLinkKeys(existingByLinkKey, service, service.id) : null;

    if (existingRcp) {
      await validateDerivedReportSequenceMove(tx, existingRcp, report.projectId, ReportType.RCPU);
      await tx.reportCollaborator.deleteMany({ where: { reportId: existingRcp.id } });
      await tx.reportService.deleteMany({ where: { reportId: existingRcp.id } });
      await tx.report.update({
        where: { id: existingRcp.id },
        data: {
          ...rcpPayload,
          collaborators: {
            create: collabIds.map(id => ({ collaboratorId: id }))
          },
          services: {
            create: [{
              serviceType: service.serviceType,
              equipmentId: service.equipmentId || null,
              system: service.system || null,
              material: service.material || null,
              startTime: service.startTime || null,
              endTime: service.endTime || null,
              finalized: true,
              extraData: consolidatedFields
            }]
          }
        }
      });
      continue;
    }

    const rcpSeq = await reserveSequence(tx, report.projectId, ReportType.RCPU);
    await tx.report.create({
      data: {
        ...rcpPayload,
        sequenceNumber: rcpSeq,
        collaborators: {
          create: collabIds.map(id => ({ collaboratorId: id }))
        },
        services: {
          create: [{
            serviceType: service.serviceType,
            equipmentId: service.equipmentId || null,
            system: service.system || null,
            material: service.material || null,
            startTime: service.startTime || null,
            endTime: service.endTime || null,
            finalized: true,
            extraData: consolidatedFields
          }]
        }
      }
    });
  }
}

async function syncApprovedRlmReports(tx, report) {
  if (!report || report.reportType !== ReportType.RDO || report.status !== ReportStatus.APPROVED) {
    return;
  }

  const mecanicaServices = (report.services || []).filter(
    s => s.serviceType === 'mecanica' && s.finalized === true
  );

  if (!mecanicaServices.length) {
    return;
  }

  const existingRlms = await tx.report.findMany({
    where: { reportType: ReportType.RLM },
    select: { id: true, projectId: true, reportType: true, sequenceNumber: true, status: true, specialConditions: true }
  });

  const existingByLinkKey = new Map();
  existingRlms.forEach(item => {
    const special = item.specialConditions || {};
    if (special.parentRdoId !== report.id) return;
    const linkKey = String(special.serviceLinkKey || special.serviceId || '').trim();
    if (linkKey) existingByLinkKey.set(linkKey, item);
  });

  const allApprovedRdos = await tx.report.findMany({
    where: { projectId: report.projectId, reportType: ReportType.RDO, status: ReportStatus.APPROVED },
    orderBy: [{ reportDate: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      reportDate: true,
      createdAt: true,
      services: {
        select: { id: true, serviceType: true, startTime: true, endTime: true, extraData: true }
      }
    }
  });

  for (const service of mecanicaServices) {
    const fields = service.extraData || {};
    const serviceLinkKey = String(
      fields.__serviceLinkKey ||
      fields.__sourceServiceId ||
      service.id ||
      ''
    ).trim();
    const serviceHistory = [];
    for (const rdo of allApprovedRdos) {
      for (const svc of rdo.services || []) {
        if (svc.serviceType !== service.serviceType) continue;
        if (hasSharedServiceHistoryKey(service, svc) || svc.id === service.id) {
          serviceHistory.push({ rdo, svc, fields: svc.extraData || {} });
        }
      }
    }
    if (!serviceHistory.length) {
      serviceHistory.push({ rdo: report, svc: service, fields });
    }
    const consolidatedFields = buildHistoricalServiceData(fields, serviceHistory);

    const collabField =
      fields['Colaboradores do serviço'] ||
      fields['Colaboradores do serviÃ§o'] ||
      fields['Colaboradores do servico'];
    const collabIds = [...new Set(Array.isArray(collabField?.ids) ? collabField.ids.filter(Boolean) : [])];

    const collaborators = collabIds.length
      ? await tx.collaborator.findMany({ where: { id: { in: collabIds } } })
      : [];

    const resolvedCollaborators = resolveCollaboratorsByShift(report, collaborators);

    const rlmPayload = {
      projectId: report.projectId,
      createdByUserId: report.createdByUserId,
      reviewedByUserId: report.reviewedByUserId,
      reportType: ReportType.RLM,
      status: ReportStatus.APPROVED,
      reportDate: report.reportDate,
      arrivalTime: service.startTime || report.arrivalTime,
      departureTime: service.endTime || report.departureTime,
      lunchBreak: report.lunchBreak,
      daytimeCount: resolvedCollaborators.length || report.daytimeCount,
      daytimeWorkedMinutes: 0,
      nighttimeWorkedMinutes: 0,
      daytimeOvertimeMinutes: 0,
      nighttimeOvertimeMinutes: 0,
      totalOvertimeMinutes: 0,
      approvedAt: report.approvedAt || new Date(),
      specialConditions: {
        parentRdoId: report.id,
        serviceId: service.id,
        serviceLinkKey: serviceLinkKey || String(service.id),
        serviceData: consolidatedFields,
        resolvedCollaborators,
        __leaderSnapshot: report.specialConditions?.__leaderSnapshot || null
      }
    };

    const existingRlm = serviceLinkKey ? findExistingByLinkKeys(existingByLinkKey, service, service.id) : null;

    if (existingRlm) {
      await validateDerivedReportSequenceMove(tx, existingRlm, report.projectId, ReportType.RLM);
      await tx.reportCollaborator.deleteMany({ where: { reportId: existingRlm.id } });
      await tx.reportService.deleteMany({ where: { reportId: existingRlm.id } });
      await tx.report.update({
        where: { id: existingRlm.id },
        data: {
          ...rlmPayload,
          collaborators: {
            create: collabIds.map(id => ({ collaboratorId: id }))
          },
          services: {
            create: [{
              serviceType: service.serviceType,
              equipmentId: service.equipmentId || null,
              system: service.system || null,
              material: service.material || null,
              startTime: service.startTime || null,
              endTime: service.endTime || null,
              finalized: true,
              extraData: consolidatedFields
            }]
          }
        }
      });
      continue;
    }

    const rlmSeq = await reserveSequence(tx, report.projectId, ReportType.RLM);
    await tx.report.create({
      data: {
        ...rlmPayload,
        sequenceNumber: rlmSeq,
        collaborators: {
          create: collabIds.map(id => ({ collaboratorId: id }))
        },
        services: {
          create: [{
            serviceType: service.serviceType,
            equipmentId: service.equipmentId || null,
            system: service.system || null,
            material: service.material || null,
            startTime: service.startTime || null,
            endTime: service.endTime || null,
            finalized: true,
            extraData: consolidatedFields
          }]
        }
      }
    });
  }
}

function independentReportTypesForService(service) {
  switch (service.serviceType) {
    case 'pressao':
      return [ReportType.RTP];
    case 'limpeza':
      return [ReportType.RLQ];
    case 'flushing':
    case 'filtragem':
      return [ReportType.RCPU];
    case 'mecanica':
      return [ReportType.RLM];
    default:
      return [];
  }
}

function serviceCollaboratorIds(service, fallbackIds = []) {
  const fields = service.extraData || {};
  const collabField =
    fields['Colaboradores do serviço'] ||
    fields['Colaboradores do serviÃ§o'] ||
    fields['Colaboradores do servico'];
  const ids = Array.isArray(collabField?.ids) ? collabField.ids.filter(Boolean) : [];
  return uniqueIds(ids.length ? ids : fallbackIds);
}

function serviceUnitIds(fields, names) {
  const field = getReportField(fields, names);
  if (Array.isArray(field?.ids)) return field.ids.filter(Boolean);
  if (field && typeof field === 'string') return [field];
  return [];
}

function sourceReportForIndependentService(project, data, collaboratorIds, reviewedByUserId) {
  return {
    id: null,
    projectId: data.projectId,
    createdByUserId: data.createdByUserId,
    reviewedByUserId,
    reportType: ReportType.RDO,
    status: ReportStatus.APPROVED,
    reportDate: new Date(data.reportDate),
    arrivalTime: '00:00',
    departureTime: '00:00',
    lunchBreak: '00:00:00',
    daytimeCount: collaboratorIds.length,
    approvedAt: new Date(),
    project,
    collaborators: collaboratorIds.map(collaboratorId => ({ collaboratorId })),
    specialConditions: {
      __leaderSnapshot: projectLeaderSnapshot(project)
    }
  };
}

async function buildIndependentSpecialConditions(tx, reportType, sourceReport, service) {
  const fields = expandUploadGroupsInServiceData(service.extraData || {}, service.extraData || {});
  const collabIds = serviceCollaboratorIds(service, (sourceReport.collaborators || []).map(link => link.collaboratorId));
  const collaborators = collabIds.length
    ? await tx.collaborator.findMany({ where: { id: { in: collabIds } } })
    : [];
  const resolvedCollaborators = resolveCollaboratorsByShift(sourceReport, collaborators);
  const serviceLinkKey = serviceHistoryKey(service) || String(service.id || '').trim();
  const base = {
    serviceOnly: true,
    source: 'SERVICE_ONLY',
    serviceLinkKey: serviceLinkKey || undefined,
    serviceType: service.serviceType,
    serviceData: fields,
    resolvedCollaborators,
    __leaderSnapshot: sourceReport.specialConditions?.__leaderSnapshot || null
  };

  if (reportType === ReportType.RTP) {
    const manoIds = serviceUnitIds(fields, ['Manômetros utilizados', 'ManÃ´metros utilizados', 'Manometros utilizados']);
    const uthIds = serviceUnitIds(fields, [
      'Unidade de Teste Hidrostático (UTH)',
      'Unidade de Teste HidrostÃ¡tico (UTH)',
      'Unidade de Teste Hidrostatico (UTH)'
    ]);
    const [manometers, uthUnits] = await Promise.all([
      manoIds.length ? tx.manometer.findMany({ where: { id: { in: manoIds } } }) : Promise.resolve([]),
      uthIds.length ? tx.unit.findMany({ where: { id: { in: uthIds } } }) : Promise.resolve([])
    ]);
    return {
      ...base,
      resolvedManometers: manometers.map(m => ({
        id: m.id,
        code: m.code,
        scale: m.scale,
        certCode: m.calibrationCertCode,
        calibratedAt: m.calibratedAt ? m.calibratedAt.toISOString().slice(0, 10) : '',
        expiresAt: m.expiresAt ? m.expiresAt.toISOString().slice(0, 10) : ''
      })),
      resolvedUnits: uthUnits.map(u => u.code)
    };
  }

  if (reportType === ReportType.RLQ) {
    const ulqIds = serviceUnitIds(fields, [
      'Unidade de Limpeza Química',
      'Unidade de Limpeza QuÃ­mica',
      'Unidade de Limpeza Quimica'
    ]);
    const units = ulqIds.length ? await tx.unit.findMany({ where: { id: { in: ulqIds } } }) : [];
    return { ...base, resolvedUnits: units.map(u => u.code) };
  }

  if (reportType === ReportType.RCPU) {
    const unitFieldNames = service.serviceType === 'filtragem'
      ? ['Unidade de filtragem', 'Unidade de Filtragem']
      : ['Unidade de Flushing', 'Unidade de flushing'];
    const unitIds = serviceUnitIds(fields, unitFieldNames);
    const thermoIds = serviceUnitIds(fields, [
      'Equipamento de desidratação',
      'Equipamento de desidrataÃ§Ã£o',
      'Equipamento de desidratacao'
    ]);
    const counterRaw = fields['Contador utilizado'];
    const counterId = counterRaw && typeof counterRaw === 'string' ? counterRaw : (counterRaw?.id || null);
    const [units, thermoUnits, counter] = await Promise.all([
      unitIds.length ? tx.unit.findMany({ where: { id: { in: unitIds } } }) : Promise.resolve([]),
      thermoIds.length ? tx.unit.findMany({ where: { id: { in: thermoIds } } }) : Promise.resolve([]),
      counterId ? tx.particleCounter.findUnique({ where: { id: counterId } }) : Promise.resolve(null)
    ]);
    return {
      ...base,
      resolvedUnits: units.map(u => u.code),
      resolvedThermoUnit: thermoUnits.length ? thermoUnits[0].code : '',
      resolvedCounter: counter ? { code: counter.code, serialNumber: counter.serialNumber } : null,
      totalMinutes: calcServiceMinutes(service.startTime, service.endTime)
    };
  }

  return base;
}

async function createIndependentServiceReports(tx, project, data, managerUserId) {
  const collaboratorIds = uniqueIds(data.collaboratorIds);
  const sourceReport = sourceReportForIndependentService(project, data, collaboratorIds, managerUserId);
  const createdReports = [];

  for (const service of data.services) {
    const normalizedService = {
      ...service,
      id: String(service.extraData?.__serviceLinkKey || service.extraData?.__sourceServiceId || ''),
      finalized: true,
      extraData: service.extraData || {}
    };
    const reportTypes = independentReportTypesForService(normalizedService);
    for (const reportType of reportTypes) {
      const sequenceNumber = await reserveSequence(tx, data.projectId, reportType);
      const specialConditions = await buildIndependentSpecialConditions(tx, reportType, sourceReport, normalizedService);
      const reportCollaboratorIds = serviceCollaboratorIds(normalizedService, collaboratorIds);
      const created = await tx.report.create({
        data: {
          projectId: data.projectId,
          createdByUserId: managerUserId,
          reviewedByUserId: managerUserId,
          reportType,
          sequenceNumber,
          status: ReportStatus.APPROVED,
          reportDate: new Date(data.reportDate),
          arrivalTime: normalizedService.startTime || '00:00',
          departureTime: normalizedService.endTime || '00:00',
          lunchBreak: '00:00:00',
          daytimeCount: reportCollaboratorIds.length || collaboratorIds.length,
          daytimeWorkedMinutes: 0,
          nighttimeWorkedMinutes: 0,
          daytimeOvertimeMinutes: 0,
          nighttimeOvertimeMinutes: 0,
          totalOvertimeMinutes: 0,
          approvedAt: new Date(),
          specialConditions,
          pendingDerivedTypes: [],
          collaborators: {
            create: reportCollaboratorIds.map(collaboratorId => ({ collaboratorId }))
          },
          services: {
            create: [{
              serviceType: normalizedService.serviceType,
              equipmentId: normalizedService.equipmentId || null,
              system: normalizedService.system || null,
              material: normalizedService.material || null,
              startTime: normalizedService.startTime || null,
              endTime: normalizedService.endTime || null,
              finalized: true,
              extraData: normalizedService.extraData
            }]
          }
        },
        include
      });
      createdReports.push(created);
    }
  }

  return createdReports;
}

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const where = {};

  if (req.query.status) {
    where.status = req.query.status;
  }

  if (req.query.projectId) {
    where.projectId = String(req.query.projectId);
  }

  if (req.query.createdByUserId) {
    where.createdByUserId = String(req.query.createdByUserId);
  }

  if (req.auth.user.role === 'CLIENT') {
    const userEmail = String(req.auth.user.email || '').trim().toLowerCase();
    where.project = {
      managerOnly: false,
      OR: [
        { clientCnpj: req.auth.user.username },
        ...(userEmail ? [
          { clientEmailPrimary: { equals: userEmail, mode: 'insensitive' } },
          { clientEmailCc: { has: userEmail } }
        ] : [])
      ]
    };
  } else if (req.auth.user.role === 'COORDINATOR') {
    where.project = { managerOnly: false };
  } else if (req.query.mine === 'true') {
    const me = await prisma.user.findUnique({
      where: { id: req.auth.user.id },
      select: { collaboratorId: true }
    });
    const collabId = me?.collaboratorId;
    if (collabId) {
      const projectIds = await collaboratorProjectIdsForAuth({
        ...req.auth,
        rawUser: { ...req.auth.rawUser, collaboratorId: collabId }
      });
      where.OR = [
        { createdByUserId: req.auth.user.id },
        { collaborators: { some: { collaboratorId: collabId } } },
        ...(projectIds.length ? [{ projectId: { in: projectIds } }] : [])
      ];
      where.project = { managerOnly: false };
    } else {
      where.createdByUserId = req.auth.user.id;
      where.project = { managerOnly: false };
    }
  }
  if (req.auth.user.role !== 'MANAGER' && !where.project) {
    where.project = { managerOnly: false };
  }

  const tGet0 = Date.now();
  const items = await prisma.report.findMany({
    where,
    include,
    orderBy: [{ reportDate: 'desc' }, { createdAt: 'desc' }]
  });
  console.log('[TIMING] GET /reports', { queryMs: Date.now() - tGet0, count: items.length, role: req.auth.user.role });
  if (req.auth.user.role === 'CLIENT') {
    const byId = new Map(items.map(item => [item.id, item]));
    return res.json(items.filter(item => canClientSeeReport(item, byId)));
  }
  res.json(items);
}));

router.post('/batch-download', requireAuth, asyncHandler(async (req, res) => {
  const data = batchDownloadSchema.parse(req.body);
  if (data.format === 'docx' && req.auth.user.role !== 'MANAGER') {
    return res.status(403).json({ error: 'Apenas o gestor pode baixar DOCX em lote.' });
  }

  const ids = uniqueIds(data.ids);
  const reports = await fetchReportsForIds(ids);
  if (reports.length !== ids.length) {
    return res.status(404).json({ error: 'Um ou mais relatórios selecionados não foram encontrados.' });
  }
  await assertBatchAccess(req.auth, reports);

  const zip = new AdmZip();
  for (const report of reports) {
    const file = data.format === 'docx'
      ? await getReportDocxDownload(report)
      : await getReportPdfDownload(report);
    zip.addFile(file.fileName, file.buffer);
  }

  const archiveName = `relatorios_${data.format}_${new Date().toISOString().slice(0, 10)}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', contentDisposition(archiveName));
  res.send(zip.toBuffer());
}));

router.post('/batch-request-signature', requireAuth, asyncHandler(async (req, res) => {
  if (req.auth.user.role !== 'CLIENT') {
    return res.status(403).json({ error: 'Apenas o cliente pode solicitar assinatura digital em lote.' });
  }

  assertZapSignEnabled();
  const data = batchSignatureSchema.parse(req.body || {});
  const ids = uniqueIds(data.ids);
  const reports = await fetchReportsForIds(ids);
  if (reports.length !== ids.length) {
    return res.status(404).json({ error: 'Um ou mais relatórios selecionados não foram encontrados.' });
  }
  await assertBatchAccess(req.auth, reports);

  const projectIds = Array.from(new Set(reports.map(report => report.projectId).filter(Boolean)));
  if (projectIds.length !== 1) {
    return res.status(409).json({ error: 'A assinatura em lote do cliente exige relatórios do mesmo projeto.' });
  }
  if (reports.some(report => report.reportType !== ReportType.RDO || report.status !== ReportStatus.APPROVED || report.status === ReportStatus.SIGNED)) {
    return res.status(409).json({ error: 'A assinatura em lote aceita apenas RDOs aprovados pelo gestor e ainda não assinados.' });
  }
  if (reports.some(report => hasActiveClientRejection(report))) {
    return res.status(409).json({ error: 'Há relatórios reprovados pelo cliente que precisam ser alterados pelo gestor antes da assinatura.' });
  }

  const { signerName, signerEmail } = resolveZapSignSigner(reports[0], req.auth.user);
  const additionalSigners = zapsignAdditionalSignersForProject(reports[0].project, signerEmail);
  const pendingAlready = reports.find(report => report.zapsignDocToken && !report.zapsignSignedAt);
  if (pendingAlready) {
    let signUrl = resolveSignerUrlForUser(pendingAlready, req.auth.user);
    if (!signUrl) {
      signUrl = await resolveSignerUrlFromZapSign(pendingAlready.zapsignDocToken, req.auth.user, pendingAlready.project);
    }
    if (signUrl) {
      return res.json({ ok: true, signUrl, reportIds: reports.map(report => report.id) });
    }
    return res.status(409).json({ error: 'Seu link de assinatura não foi encontrado para estes relatórios. Contate o gestor.' });
  }

  const { claimed, claimTime } = await claimZapSignRequests(prisma, ids);
  if (!claimed) {
    await releaseZapSignRequestClaims(prisma, ids, claimTime);
    const currentReports = await fetchReportsForIds(ids);
    const pendingExisting = currentReports.find(report => report.status === ReportStatus.APPROVED && report.zapsignDocToken && !report.zapsignSignedAt);
    if (pendingExisting) {
      let signUrl = resolveSignerUrlForUser(pendingExisting, req.auth.user);
      if (!signUrl) {
        signUrl = await resolveSignerUrlFromZapSign(pendingExisting.zapsignDocToken, req.auth.user, pendingExisting.project);
      }
      if (signUrl) {
        return res.json({ ok: true, signUrl, reportIds: currentReports.map(report => report.id) });
      }
      return res.status(409).json({ error: 'Seu link de assinatura não foi encontrado para estes relatórios. Contate o gestor.' });
    }
    return res.status(409).json({ error: 'A solicitação de assinatura em lote já está em andamento. Tente novamente em instantes.' });
  }

  const commentsById = normalizeCommentMap(data.commentsById);
  let preparedReports;
  let mainResult;
  try {
    preparedReports = await prisma.$transaction(async tx => {
      const prepared = [];
      for (const report of reports) {
        const comment = commentsById[report.id] || '';
        const approvedReview = (report.clientReviews || []).find(item => item.action === ClientReviewAction.APPROVED);
        if (approvedReview) {
          if (comment !== String(approvedReview.comment || '').trim()) {
            await tx.clientReportReview.update({
              where: { id: approvedReview.id },
              data: {
                comment: comment || null,
                ipAddress: clientIp(req),
                userAgent: String(req.headers['user-agent'] || '').slice(0, 1000) || null
              }
            });
          }
        } else {
          await tx.clientReportReview.create({
            data: {
              reportId: report.id,
              clientUserId: req.auth.user.id,
              action: ClientReviewAction.APPROVED,
              comment: comment || null,
              ipAddress: clientIp(req),
              userAgent: String(req.headers['user-agent'] || '').slice(0, 1000) || null
            }
          });
        }
        prepared.push(await tx.report.findUniqueOrThrow({ where: { id: report.id }, include }));
      }
      return prepared;
    });

    const [mainReport, ...extraReports] = preparedReports;
    if (preparedReports.some(report => report.status !== ReportStatus.APPROVED || report.zapsignDocToken || report.zapsignSignedAt)) {
      const error = new Error('A solicitação de assinatura em lote foi atualizada por outra operação.');
      error.statusCode = 409;
      throw error;
    }
    const mainFile = await getReportPdfDownload(mainReport);
    mainResult = await sendToZapSign({
      pdfBuffer: mainFile.buffer,
      fileName: reportPdfFileName(mainReport, mainFile),
      signerName,
      signerEmail,
      additionalSigners,
      externalId: mainReport.id,
      webhookUrl: buildZapSignWebhookUrl()
    });

    if (!mainResult.docToken || !mainResult.signerUrl) {
      const error = new Error('A ZapSign não retornou os dados esperados para a assinatura em lote.');
      error.statusCode = 502;
      throw error;
    }

    const initialProgress = buildZapSignSignatureProgress(mainResult.raw);
    const mainSigners = mainResult.allSigners?.length ? mainResult.allSigners : [];
    const updates = [{
      id: mainReport.id,
      docToken: mainResult.docToken,
      signerToken: mainResult.signerToken || null,
      allSigners: mainSigners
    }];

    for (const report of extraReports) {
      const file = await getReportPdfDownload(report);
      const extra = await addExtraDocToZapSign(mainResult.docToken, {
        pdfBuffer: file.buffer,
        fileName: reportPdfFileName(report, file)
      });
      if (!extra.docToken) {
        const error = new Error('A ZapSign não retornou o token de um documento extra da assinatura em lote.');
        error.statusCode = 502;
        throw error;
      }
      updates.push({ id: report.id, docToken: extra.docToken, signerToken: null, allSigners: mainSigners });
    }

    await prisma.$transaction(async tx => {
      const batchDocTokens = updates.map(item => item.docToken).filter(Boolean);
      for (const item of updates) {
        const existing = await tx.report.findUnique({ where: { id: item.id }, select: { specialConditions: true } });
        const nextSpecialConditions = {
          ...(existing?.specialConditions || {}),
          ...(item.allSigners.length ? { [ZAPSIGN_SIGNERS_KEY]: item.allSigners } : {}),
          ...(initialProgress.total ? { [ZAPSIGN_SIGNATURE_PROGRESS_KEY]: initialProgress } : {}),
          ...(batchDocTokens.length > 1 ? {
            [ZAPSIGN_BATCH_MAIN_DOC_TOKEN_KEY]: mainResult.docToken,
            [ZAPSIGN_BATCH_DOC_TOKENS_KEY]: batchDocTokens
          } : {})
        };
        const result = await tx.report.updateMany({
          where: {
            id: item.id,
            status: ReportStatus.APPROVED,
            zapsignDocToken: null,
            zapsignSignedAt: null,
            zapsignRequestedAt: claimTime
          },
          data: {
            zapsignDocToken: item.docToken,
            zapsignSignerToken: item.signerToken,
            zapsignRequestedAt: new Date(),
            zapsignSignedAt: null,
            zapsignDocUrl: null,
            specialConditions: nextSpecialConditions
          }
        });
        if (result.count !== 1) {
          const error = new Error('A solicitação de assinatura em lote foi atualizada por outra operação.');
          error.statusCode = 409;
          throw error;
        }
      }
    });
  } catch (error) {
    await releaseZapSignRequestClaims(prisma, ids, claimTime).catch(cleanupError => {
      console.error('Falha ao liberar solicitação ZapSign em lote em andamento.', cleanupError);
    });
    throw error;
  }

  const batchSignUrl = resolveSignerUrlForUser(
    { ...preparedReports[0], specialConditions: { ...(preparedReports[0].specialConditions || {}), [ZAPSIGN_SIGNERS_KEY]: mainResult.allSigners || [] }, zapsignSignerToken: mainResult.signerToken },
    req.auth.user
  ) || mainResult.signerUrl;
  res.json({
    ok: true,
    signUrl: batchSignUrl,
    reportIds: preparedReports.map(report => report.id)
  });
}));

router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const item = await prisma.report.findUniqueOrThrow({
    where: { id: req.params.id },
    include
  });

  if (!(await canAccessReport(req.auth, item))) {
    return res.status(403).json({ error: 'Você não tem permissão para acessar este relatório.' });
  }
  if (req.auth.user.role === 'CLIENT') {
    const projectReports = await prisma.report.findMany({
      where: { projectId: item.projectId },
      include
    });
    const byId = new Map(projectReports.map(report => [report.id, report]));
    if (!canClientSeeReport(item, byId)) {
      return res.status(403).json({ error: 'Você não tem permissão para acessar este relatório.' });
    }
  }

  res.json(item);
}));

router.get('/:id/pdf', requireAuth, asyncHandler(async (req, res) => {
  let item = await prisma.report.findUniqueOrThrow({
    where: { id: req.params.id },
    include
  });

  if (!(await canAccessReport(req.auth, item))) {
    return res.status(403).json({ error: 'Você não tem permissão para acessar este relatório.' });
  }
  if (req.auth.user.role === 'CLIENT') {
    const projectReports = await prisma.report.findMany({
      where: { projectId: item.projectId },
      include
    });
    const byId = new Map(projectReports.map(report => [report.id, report]));
    if (!canClientSeeReport(item, byId)) {
      return res.status(403).json({ error: 'Você não tem permissão para acessar este relatório.' });
    }
  }

  if (item.status === ReportStatus.SIGNED && item.reportType === ReportType.RDO && item.zapsignDocToken) {
    const signed = await resolveSignedPdf(item);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', contentDisposition(signed.fileName));
    res.send(signed.buffer);
    return;
  }

  item = await refreshDerivedReportSource(item);
  const saved = await generateReportPdfAsset(item);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', contentDisposition(saved.fileName));
  res.send(await fs.readFile(saved.targetPath));
}));

router.get('/:id/docx', requireAuth, asyncHandler(async (req, res) => {
  let item = await prisma.report.findUniqueOrThrow({
    where: { id: req.params.id },
    include
  });

  if (!(await canAccessReport(req.auth, item))) {
    return res.status(403).json({ error: 'Você não tem permissão para acessar este relatório.' });
  }

  if (req.auth.user.role !== 'MANAGER') {
    return res.status(403).json({ error: 'Apenas o gestor pode baixar o DOCX.' });
  }

  item = await refreshDerivedReportSource(item);
  const saved = await generateReportDocxAsset(item);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', contentDisposition(saved.fileName));
  res.send(await fs.readFile(saved.targetPath));
}));

router.delete('/:id/services/:serviceId', requireAuth, asyncHandler(async (req, res) => {
  if (req.auth.user.role === 'CLIENT' || req.auth.user.role === 'COORDINATOR') {
    return res.status(403).json({ error: `A conta ${req.auth.user.role} não pode editar relatórios.` });
  }

  const existing = await prisma.report.findUniqueOrThrow({
    where: { id: req.params.id },
    include
  });
  assertReportMutable(existing);

  if (!(await canAccessReport(req.auth, existing))) {
    return res.status(403).json({ error: 'Você não tem permissão para acessar este relatório.' });
  }

  const service = await prisma.reportService.findFirst({
    where: { id: req.params.serviceId, reportId: req.params.id },
    select: { id: true }
  });
  if (!service) {
    return res.status(404).json({ error: 'Serviço não encontrado.' });
  }

  const item = await prisma.$transaction(async tx => {
    await tx.reportService.delete({ where: { id: req.params.serviceId } });
    return tx.report.findUniqueOrThrow({
      where: { id: req.params.id },
      include
    });
  });

  await organizeAndPersist(item);
  res.json(item);
}));

router.post('/service-only', requireAuth, asyncHandler(async (req, res) => {
  if (req.auth.user.role !== 'MANAGER') {
    return res.status(403).json({ error: 'Apenas o gestor pode criar relatórios somente de serviço.' });
  }

  const data = serviceOnlySchema.parse(req.body);
  const unsupportedTypes = Array.from(new Set(data.services
    .filter(service => !independentReportTypesForService(service).length)
    .map(service => service.serviceType)));
  if (unsupportedTypes.length) {
    return res.status(400).json({
      error: `Tipo de serviço sem relatório independente disponível: ${unsupportedTypes.join(', ')}.`
    });
  }

  const createdReports = await prisma.$transaction(async tx => {
    const project = await tx.project.findUniqueOrThrow({
      where: { id: data.projectId },
      include: { operator: true }
    });

    return createIndependentServiceReports(tx, project, {
      ...data,
      createdByUserId: req.auth.user.id
    }, req.auth.user.id);
  });

  for (const report of createdReports) {
    await organizeAndPersist(report);
  }

  res.status(201).json(createdReports);
}));

router.post('/', requireAuth, asyncHandler(async (req, res) => {
  if (req.auth.user.role === 'CLIENT') {
    return res.status(403).json({ error: `A conta ${req.auth.user.role} não pode criar relatórios.` });
  }
  const data = schema.parse(req.body);
  const reportStatus = req.auth.user.role === 'MANAGER' ? data.status : ReportStatus.PENDING;
  const collaboratorIds = uniqueIds(data.collaboratorIds);
  const pendingDerivedTypes = collectPendingDerivedTypes(data.services);
  const tPost0 = Date.now();
  const item = await prisma.$transaction(async tx => {
    const project = await tx.project.findUniqueOrThrow({
      where: { id: data.projectId },
      include: { operator: true }
    });
    if (project.managerOnly && req.auth.user.role !== 'MANAGER') {
      const error = new Error('Este projeto é visível somente para o gestor.');
      error.statusCode = 403;
      throw error;
    }
    const sequenceNumber = await reserveSequence(tx, data.projectId, data.reportType);
    const overtime = calculateReportOvertime(project, data);
    const leaderSnapshot = project.operator ? {
      name: project.operator.name || null,
      role: project.operator.role || null,
      signatureImage: project.operator.signatureImage || null
    } : null;

    const created = await tx.report.create({
      data: {
        projectId: data.projectId,
        createdByUserId: req.auth.user.role === 'MANAGER' ? data.createdByUserId : req.auth.user.id,
        reportType: data.reportType,
        sequenceNumber,
        status: reportStatus,
        reportDate: new Date(data.reportDate),
        arrivalTime: data.arrivalTime,
        departureTime: data.departureTime,
        lunchBreak: data.lunchBreak,
        daytimeCount: data.daytimeCount,
        daytimeWorkedMinutes: overtime.daytimeWorkedMinutes,
        nighttimeWorkedMinutes: overtime.nighttimeWorkedMinutes,
        daytimeOvertimeMinutes: overtime.daytimeOvertimeMinutes,
        nighttimeOvertimeMinutes: overtime.nighttimeOvertimeMinutes,
        totalOvertimeMinutes: overtime.totalOvertimeMinutes,
        overtimeReason: data.overtimeReason || null,
        dailyDescription: data.dailyDescription || null,
        reviewedByUserId: reportStatus === ReportStatus.APPROVED ? req.auth.user.id : null,
        approvedAt: reportStatus === ReportStatus.APPROVED ? new Date() : null,
        specialConditions: {
          ...(data.specialConditions || {}),
          overtimeSummary: overtime,
          ...(leaderSnapshot ? { __leaderSnapshot: leaderSnapshot } : {})
        },
        pendingDerivedTypes,
        collaborators: {
          create: collaboratorIds.map(collaboratorId => ({ collaboratorId }))
        },
        services: {
          create: data.services.map(service => ({
            serviceType: service.serviceType,
            equipmentId: service.equipmentId || null,
            system: service.system || null,
            material: service.material || null,
            startTime: service.startTime || null,
            endTime: service.endTime || null,
            finalized: typeof service.finalized === 'boolean' ? service.finalized : null,
            extraData: service.extraData || {}
          }))
        }
      },
      include
    });

    await syncApprovedRtpReports(tx, created);
    await syncApprovedRlqReports(tx, created);
    await syncApprovedRcpReports(tx, created);
    await syncApprovedRlmReports(tx, created);
    return created;
  });
  const tPostTx = Date.now();
  await organizeAndPersist(item);
  const tPostOrg = Date.now();
  if (item.reportType === 'RDO' && item.status === ReportStatus.APPROVED) {
    const derived = await prisma.report.findMany({
      where: { projectId: item.projectId, reportType: { in: [ReportType.RTP, ReportType.RLQ, ReportType.RCPU, ReportType.RLM] } },
      include
    });
    for (const d of derived) {
      if (d.specialConditions?.parentRdoId === item.id) await organizeAndPersist(d);
    }
  }
  console.log('[TIMING] POST /reports', { txMs: tPostTx - tPost0, organizeMs: tPostOrg - tPostTx, totalMs: Date.now() - tPost0, reportType: item.reportType, status: item.status });
  if (item.status === ReportStatus.APPROVED) queueApprovedReportNotification(item);
  res.status(201).json(item);
}));

router.put('/:id', requireAuth, asyncHandler(async (req, res) => {
  if (req.auth.user.role === 'CLIENT') {
    return res.status(403).json({ error: `A conta ${req.auth.user.role} não pode editar relatórios.` });
  }
  const data = updateSchema.parse(req.body);
  const collaboratorIds = uniqueIds(data.collaboratorIds);
  const existing = await prisma.report.findUniqueOrThrow({
    where: { id: req.params.id },
    include
  });
  const isServiceOnlyReport = existing.specialConditions?.serviceOnly === true;
  if (isServiceOnlyReport && req.auth.user.role !== 'MANAGER') {
    return res.status(403).json({ error: 'Apenas o gestor pode editar relatórios somente de serviço.' });
  }
  if (isServiceOnlyReport) {
    const firstService = data.services[0];
    if (!firstService || !independentReportTypesForService(firstService).includes(data.reportType)) {
      return res.status(400).json({ error: 'Tipo de serviço incompatível com este relatório independente.' });
    }
  }
  if (req.auth.user.role === 'COORDINATOR' && existing.createdByUserId !== req.auth.user.id) {
    return res.status(403).json({ error: 'O coordenador só pode editar relatórios criados por ele.' });
  }
  assertReportMutable(existing);
  if (!(await canAccessReport(req.auth, existing))) {
    return res.status(403).json({ error: 'Você não tem permissão para acessar este relatório.' });
  }
  if (req.auth.user.role !== 'MANAGER') {
    const targetProject = await prisma.project.findUniqueOrThrow({
      where: { id: data.projectId },
      select: { managerOnly: true }
    });
    if (targetProject.managerOnly) {
      return res.status(403).json({ error: 'Este projeto é visível somente para o gestor.' });
    }
  }
  const hasApprovedVersion = !!(existing.approvedAt || existing.status === ReportStatus.APPROVED || existing.specialConditions?.__editOriginalSnapshot);
  const isManagerFixingClientRejection = req.auth.user.role === 'MANAGER' && hasActiveClientRejection(existing);

  const tPut0 = Date.now();
  const item = await prisma.$transaction(async tx => {
    const project = await tx.project.findUniqueOrThrow({
      where: { id: data.projectId },
      include: { operator: true }
    });
    const overtime = calculateReportOvertime(project, data);
    const leaderSnapshot = projectLeaderSnapshot(project);
    const serviceOnlySpecialConditions = isServiceOnlyReport
      ? await buildIndependentSpecialConditions(
          tx,
          data.reportType,
          sourceReportForIndependentService(project, {
            ...data,
            createdByUserId: existing.createdByUserId || req.auth.user.id
          }, collaboratorIds, existing.reviewedByUserId || req.auth.user.id),
          {
            ...data.services[0],
            id: String(data.specialConditions?.serviceLinkKey || data.specialConditions?.serviceId || existing.services?.[0]?.id || ''),
            finalized: true,
            extraData: data.services[0]?.extraData || {}
          }
        )
      : null;
    const managerProvidedSequence = req.auth.user.role === 'MANAGER' && data.sequenceNumber;
    const targetSequenceNumber = managerProvidedSequence ? data.sequenceNumber : existing.sequenceNumber;
    const sequenceGroupChanged = existing.projectId !== data.projectId || existing.reportType !== data.reportType;
    const internalEditState = req.auth.user.role === 'MANAGER'
      ? extractInternalEditState(existing.specialConditions)
      : (hasApprovedVersion
          ? {
              __editOriginalSnapshot: cloneJson(existing.specialConditions?.__editOriginalSnapshot) || buildReportSnapshot(existing),
              __editMeta: {
                editedByUserId: req.auth.user.id,
                editedAt: new Date().toISOString(),
                previousStatus: existing.status
              }
            }
          : {});
    await tx.reportCollaborator.deleteMany({ where: { reportId: req.params.id } });
    await tx.reportService.deleteMany({ where: { reportId: req.params.id } });
    const sequenceSwap = (managerProvidedSequence || sequenceGroupChanged) && Number.isInteger(targetSequenceNumber)
      ? await prepareReportSequenceChange(tx, existing, data.projectId, data.reportType, targetSequenceNumber)
      : null;

    const updated = await tx.report.update({
      where: { id: req.params.id },
      data: {
        projectId: data.projectId,
        reportType: data.reportType,
        ...(managerProvidedSequence ? { sequenceNumber: data.sequenceNumber } : {}),
        reportDate: new Date(data.reportDate),
        arrivalTime: data.arrivalTime,
        departureTime: data.departureTime,
        lunchBreak: data.lunchBreak,
        daytimeCount: data.daytimeCount,
        daytimeWorkedMinutes: overtime.daytimeWorkedMinutes,
        nighttimeWorkedMinutes: overtime.nighttimeWorkedMinutes,
        daytimeOvertimeMinutes: overtime.daytimeOvertimeMinutes,
        nighttimeOvertimeMinutes: overtime.nighttimeOvertimeMinutes,
        totalOvertimeMinutes: overtime.totalOvertimeMinutes,
        overtimeReason: data.overtimeReason || null,
        dailyDescription: data.dailyDescription || null,
        specialConditions: {
          ...(req.auth.user.role === 'MANAGER'
            ? withClientRejectionCleared(stripInternalEditState(data.specialConditions || {}))
            : stripInternalEditState(data.specialConditions || {})),
          ...(serviceOnlySpecialConditions || {}),
          overtimeSummary: overtime,
          ...internalEditState,
          __leaderSnapshot: leaderSnapshot
        },
        pendingDerivedTypes: isServiceOnlyReport ? [] : collectPendingDerivedTypes(data.services),
        status: req.auth.user.role === 'MANAGER'
          ? (isManagerFixingClientRejection ? ReportStatus.APPROVED : existing.status)
          : ReportStatus.PENDING,
        reviewNotes: req.auth.user.role === 'MANAGER'
          ? existing.reviewNotes
          : (hasApprovedVersion ? COLLABORATOR_EDIT_NOTE : null),
        reviewedByUserId: req.auth.user.role === 'MANAGER'
          ? (isManagerFixingClientRejection ? req.auth.user.id : existing.reviewedByUserId)
          : null,
        returnedAt: req.auth.user.role === 'MANAGER' ? existing.returnedAt : null,
        approvedAt: req.auth.user.role === 'MANAGER'
          ? (isManagerFixingClientRejection ? new Date() : existing.approvedAt)
          : null,
        collaborators: {
          create: collaboratorIds.map(collaboratorId => ({ collaboratorId }))
        },
        services: {
          create: data.services.map(service => ({
            serviceType: service.serviceType,
            equipmentId: service.equipmentId || null,
            system: service.system || null,
            material: service.material || null,
            startTime: service.startTime || null,
            endTime: service.endTime || null,
            finalized: isServiceOnlyReport ? true : (typeof service.finalized === 'boolean' ? service.finalized : null),
            extraData: service.extraData || {}
          }))
        }
      },
      include
    });

    if ((managerProvidedSequence || sequenceGroupChanged) && Number.isInteger(targetSequenceNumber)) {
      await finishReportSequenceChange(tx, sequenceSwap);
      await syncProjectReportSequence(tx, data.projectId, data.reportType, targetSequenceNumber);
    }

    await syncApprovedRtpReports(tx, updated);
    await syncApprovedRlqReports(tx, updated);
    await syncApprovedRcpReports(tx, updated);
    await syncApprovedRlmReports(tx, updated);
    return updated;
  });
  const tPutTx = Date.now();

  await organizeAndPersist(item);
  const tPutOrg = Date.now();
  if (item.reportType === 'RDO' && item.status === ReportStatus.APPROVED) {
    const derived = await prisma.report.findMany({
      where: { projectId: item.projectId, reportType: { in: [ReportType.RTP, ReportType.RLQ, ReportType.RCPU, ReportType.RLM] } },
      include
    });
    for (const d of derived) {
      if (d.specialConditions?.parentRdoId === item.id) await organizeAndPersist(d);
    }
  }
  console.log('[TIMING] PUT /reports/:id', { txMs: tPutTx - tPut0, organizeMs: tPutOrg - tPutTx, totalMs: Date.now() - tPut0, reportType: item.reportType, status: item.status });
  if (isManagerFixingClientRejection && item.status === ReportStatus.APPROVED) queueReapprovedReportNotification(item);
  res.json(item);
}));

router.patch('/:id/sequence', requireAuth, asyncHandler(async (req, res) => {
  if (req.auth.user.role !== 'MANAGER') {
    return res.status(403).json({ error: 'Apenas o gestor pode alterar a numeração dos relatórios.' });
  }

  const data = sequenceSchema.parse(req.body);
  const existing = await prisma.report.findUniqueOrThrow({
    where: { id: req.params.id },
    include
  });
  assertReportMutable(existing);

  const item = await prisma.$transaction(async tx => {
    const sequenceSwap = await prepareReportSequenceChange(tx, existing, existing.projectId, existing.reportType, data.sequenceNumber);
    const updated = await tx.report.update({
      where: { id: req.params.id },
      data: {
        sequenceNumber: data.sequenceNumber
      },
      include
    });
    await finishReportSequenceChange(tx, sequenceSwap);
    await syncProjectReportSequence(tx, updated.projectId, updated.reportType, data.sequenceNumber);
    return updated;
  });

  await organizeAndPersist(item);
  res.json(item);
}));

router.post('/:id/cancel-edit', requireAuth, asyncHandler(async (req, res) => {
  if (req.auth.user.role === 'CLIENT' || req.auth.user.role === 'COORDINATOR') {
    return res.status(403).json({ error: `A conta ${req.auth.user.role} não pode desfazer edições de relatórios.` });
  }
  if (req.auth.user.role === 'MANAGER') {
    return res.status(403).json({ error: 'Apenas o colaborador pode desfazer a própria edição pendente.' });
  }

  const existing = await prisma.report.findUniqueOrThrow({
    where: { id: req.params.id },
    include
  });
  assertReportMutable(existing);

  if (!(await canAccessReport(req.auth, existing))) {
    return res.status(403).json({ error: 'Você não tem permissão para acessar este relatório.' });
  }

  const originalSnapshot = cloneJson(existing.specialConditions?.__editOriginalSnapshot);
  if (!originalSnapshot) {
    return res.status(400).json({ error: 'Este relatório não possui uma edição pendente para desfazer.' });
  }

  const item = await prisma.$transaction(async tx => restoreReportFromSnapshot(tx, req.params.id, originalSnapshot));

  await organizeAndPersist(item);
  if (item.reportType === 'RDO' && item.status === ReportStatus.APPROVED) {
    const derived = await prisma.report.findMany({
      where: { projectId: item.projectId, reportType: { in: [ReportType.RTP, ReportType.RLQ, ReportType.RCPU, ReportType.RLM] } },
      include
    });
    for (const d of derived) {
      if (d.specialConditions?.parentRdoId === item.id) await organizeAndPersist(d);
    }
  }

  res.json(item);
}));

router.post('/:id/discard-edit', requireAuth, asyncHandler(async (req, res) => {
  if (req.auth.user.role !== 'MANAGER') {
    return res.status(403).json({ error: 'Apenas o gestor pode descartar uma edição pendente.' });
  }

  const existing = await prisma.report.findUniqueOrThrow({
    where: { id: req.params.id },
    include
  });
  assertReportMutable(existing);

  const originalSnapshot = cloneJson(existing.specialConditions?.__editOriginalSnapshot);
  if (!originalSnapshot) {
    return res.status(400).json({ error: 'Este relatório não possui uma edição pendente para descartar.' });
  }

  const item = await prisma.$transaction(async tx => restoreReportFromSnapshot(tx, req.params.id, originalSnapshot));

  await organizeAndPersist(item);
  if (item.reportType === 'RDO' && item.status === ReportStatus.APPROVED) {
    const derived = await prisma.report.findMany({
      where: { projectId: item.projectId, reportType: { in: [ReportType.RTP, ReportType.RLQ, ReportType.RCPU, ReportType.RLM] } },
      include
    });
    for (const d of derived) {
      if (d.specialConditions?.parentRdoId === item.id) await organizeAndPersist(d);
    }
  }

  res.json(item);
}));

router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  if (req.auth.user.role !== 'MANAGER') {
    return res.status(403).json({ error: 'Apenas o gestor pode excluir relatórios.' });
  }

  const item = await prisma.report.findUniqueOrThrow({
    where: { id: req.params.id },
    include
  });
  assertReportMutable(item);

  const originalSnapshot = cloneJson(item.specialConditions?.__editOriginalSnapshot);
  if (originalSnapshot && item.status !== ReportStatus.APPROVED) {
    return res.status(409).json({
      error: 'Não é permitido excluir o relatório a partir de uma edição pendente. Use a opção de descartar edição.'
    });
  }

  await prisma.$transaction(async tx => {
    const idsToDelete = [item.id];

    if (item.reportType === ReportType.RDO) {
      const derivedReports = await tx.report.findMany({
        where: {
          projectId: item.projectId,
          reportType: { in: [ReportType.RTP, ReportType.RLQ, ReportType.RCPU, ReportType.RLM] }
        },
        select: {
          id: true,
          specialConditions: true
        }
      });

      derivedReports.forEach(report => {
        const special = report.specialConditions || {};
        if (special.parentRdoId === item.id) {
          idsToDelete.push(report.id);
        }
      });
    }

    await tx.report.deleteMany({
      where: {
        id: { in: Array.from(new Set(idsToDelete)) }
      }
    });
  });

  res.status(204).end();
}));

router.patch('/:id/status', requireAuth, asyncHandler(async (req, res) => {
  if (req.auth.user.role !== 'MANAGER') {
    return res.status(403).json({ error: 'Apenas o gestor pode revisar relatórios.' });
  }

  const data = statusSchema.parse(req.body);
  let approvedTransition = false;
  const previous = await prisma.report.findUnique({
    where: { id: req.params.id },
    select: { status: true, specialConditions: true }
  });
  if (previous?.status === ReportStatus.SIGNED) {
    return res.status(409).json({ error: 'Relatório assinado não pode mais ser alterado.' });
  }
  const wasClientRejection = hasActiveClientRejection(previous);

  const tPatch0 = Date.now();
  const item = await prisma.$transaction(async tx => {
    const nextSpecialConditions = data.status === ReportStatus.APPROVED
      ? withClientRejectionCleared(stripInternalEditState(previous?.specialConditions || {}))
      : withoutZapSignState(previous?.specialConditions || {});

    const updated = await tx.report.update({
      where: { id: req.params.id },
      data: {
        status: data.status,
        reviewNotes: data.reviewNotes || null,
        reviewedByUserId: req.auth.user.id,
        approvedAt: data.status === ReportStatus.APPROVED ? new Date() : null,
        returnedAt: data.status === ReportStatus.RETURNED ? new Date() : null,
        ...(data.status === ReportStatus.APPROVED ? {} : {
          zapsignDocToken: null,
          zapsignSignerToken: null,
          zapsignRequestedAt: null,
          zapsignSignedAt: null,
          zapsignDocUrl: null
        }),
        ...(nextSpecialConditions !== undefined ? { specialConditions: nextSpecialConditions } : {})
      },
      include
    });

    

    if (data.status === ReportStatus.APPROVED && previous?.status !== ReportStatus.APPROVED) {
      approvedTransition = true;
      await syncApprovedRtpReports(tx, updated);
      await syncApprovedRlqReports(tx, updated);
      await syncApprovedRcpReports(tx, updated);
      await syncApprovedRlmReports(tx, updated);
    }

    return updated;
  });
  const tPatchTx = Date.now();

  if (data.status === ReportStatus.APPROVED) {
    const derived = await prisma.report.findMany({
      where: { projectId: item.projectId, reportType: { in: [ReportType.RTP, ReportType.RLQ, ReportType.RCPU, ReportType.RLM] } },
      include
    });
    for (const d of derived) {
      if (d.specialConditions?.parentRdoId === item.id) await organizeAndPersist(d);
    }
    if (approvedTransition) {
      if (wasClientRejection) {
        queueReapprovedReportNotification(item);
      } else {
        queueApprovedReportNotification(item);
      }
    }
  }
  console.log('[TIMING] PATCH /reports/:id/status', { txMs: tPatchTx - tPatch0, totalMs: Date.now() - tPatch0, newStatus: data.status });
  res.json(item);
}));

router.post('/:id/request-signature', requireAuth, asyncHandler(async (req, res) => {
  if (req.auth.user.role !== 'CLIENT') {
    return res.status(403).json({ error: 'Apenas o cliente pode solicitar a assinatura digital.' });
  }

  assertZapSignEnabled();
  const data = requestSignatureSchema.parse(req.body || {});

  const existing = await prisma.report.findUniqueOrThrow({
    where: { id: req.params.id },
    include
  });

  if (!(await canAccessReport(req.auth, existing))) {
    return res.status(403).json({ error: 'Você não tem permissão para acessar este relatório.' });
  }
  if (existing.reportType !== ReportType.RDO) {
    return res.status(400).json({ error: 'Apenas RDO pode iniciar assinatura digital.' });
  }
  if (existing.status === ReportStatus.SIGNED) {
    return res.status(409).json({ error: 'Relatório já está assinado.' });
  }
  if (hasActiveClientRejection(existing)) {
    return res.status(409).json({ error: 'Relatório reprovado pelo cliente. O gestor precisa alterar o relatório antes de uma nova assinatura.' });
  }
  if (existing.status !== ReportStatus.APPROVED) {
    return res.status(409).json({ error: 'Somente relatórios aprovados pelo gestor podem ser assinados.' });
  }
  const comment = String(data.comment || '').trim();
  const { signerName, signerEmail } = resolveZapSignSigner(existing, req.auth.user);
  const { claimed, claimTime } = await claimZapSignRequest(prisma, existing.id);

  if (!claimed) {
    const current = await prisma.report.findUniqueOrThrow({
      where: { id: existing.id },
      include
    });
    if (current.status === ReportStatus.APPROVED && current.zapsignDocToken && !current.zapsignSignedAt) {
      let signUrl = resolveSignerUrlForUser(current, req.auth.user);
      if (!signUrl) {
        signUrl = await resolveSignerUrlFromZapSign(current.zapsignDocToken, req.auth.user, current.project);
      }
      if (signUrl) return res.json({ ok: true, signUrl, report: current });
      return res.status(409).json({ error: 'Seu link de assinatura não foi encontrado para este relatório. Contate o gestor.' });
    }
    return res.status(409).json({ error: 'A solicitação de assinatura já está em andamento. Tente novamente em instantes.' });
  }

  let item;
  let zapsignForResponse;
  try {
    const prepared = await prisma.$transaction(async tx => {
      const approvedReview = (existing.clientReviews || []).find(item => item.action === ClientReviewAction.APPROVED);
      if (approvedReview) {
        if (comment !== String(approvedReview.comment || '').trim()) {
          await tx.clientReportReview.update({
            where: { id: approvedReview.id },
            data: {
              comment: comment || null,
              ipAddress: clientIp(req),
              userAgent: String(req.headers['user-agent'] || '').slice(0, 1000) || null
            }
          });
        }
      } else {
        await tx.clientReportReview.create({
          data: {
            reportId: existing.id,
            clientUserId: req.auth.user.id,
            action: ClientReviewAction.APPROVED,
            comment: comment || null,
            ipAddress: clientIp(req),
            userAgent: String(req.headers['user-agent'] || '').slice(0, 1000) || null
          }
        });
      }

      return tx.report.findUniqueOrThrow({
        where: { id: existing.id },
        include
      });
    });

    if (prepared.status !== ReportStatus.APPROVED || prepared.zapsignDocToken || prepared.zapsignSignedAt) {
      const error = new Error('A solicitação de assinatura foi atualizada por outra operação.');
      error.statusCode = 409;
      throw error;
    }
    const additionalSigners = zapsignAdditionalSignersForProject(prepared.project, signerEmail);
    const tSig0 = Date.now();
    const saved = await generateReportPdfAsset(prepared);
    const pdfBuffer = await fs.readFile(saved.targetPath);
    const tSigPdf = Date.now();
    const zapsign = await sendToZapSign({
      pdfBuffer,
      fileName: reportPdfFileName(prepared, saved),
      signerName,
      signerEmail,
      additionalSigners,
      externalId: prepared.id,
      webhookUrl: buildZapSignWebhookUrl()
    });
    zapsignForResponse = zapsign;
    console.log('[TIMING] POST /reports/:id/request-signature', { pdfMs: tSigPdf - tSig0, zapMs: Date.now() - tSigPdf, totalMs: Date.now() - tSig0 });

    if (!zapsign.docToken) {
      const error = new Error('A ZapSign não retornou o token do documento.');
      error.statusCode = 502;
      throw error;
    }
    if (!zapsign.signerUrl) {
      const error = new Error('A ZapSign não retornou o link de assinatura.');
      error.statusCode = 502;
      throw error;
    }

    const nextSpecialConditions = {
      ...(prepared.specialConditions || {}),
      ...(zapsign.allSigners?.length ? { [ZAPSIGN_SIGNERS_KEY]: zapsign.allSigners } : {})
    };
    const initialProgress = buildZapSignSignatureProgress(zapsign.raw);
    if (initialProgress.total) {
      nextSpecialConditions[ZAPSIGN_SIGNATURE_PROGRESS_KEY] = initialProgress;
    }

    const persisted = await persistZapSignRequest(
      prisma,
      prepared.id,
      claimTime,
      {
        zapsignDocToken: zapsign.docToken,
        zapsignSignerToken: zapsign.signerToken || null,
        zapsignRequestedAt: new Date(),
        zapsignSignedAt: null,
        zapsignDocUrl: null,
        specialConditions: nextSpecialConditions
      }
    );

    if (!persisted) {
      const error = new Error('A solicitação de assinatura já foi atualizada por outra operação.');
      error.statusCode = 409;
      throw error;
    }

    item = await prisma.report.findUniqueOrThrow({
      where: { id: prepared.id },
      include
    });
  } catch (error) {
    await releaseZapSignRequestClaim(prisma, existing.id, claimTime).catch(cleanupError => {
      console.error('Falha ao liberar solicitação ZapSign em andamento.', cleanupError);
    });
    throw error;
  }

  const resolvedSignUrl = resolveSignerUrlForUser(item, req.auth.user) || zapsignForResponse.signerUrl;
  res.json({
    ok: true,
    signUrl: resolvedSignUrl,
    report: item
  });
}));

router.post('/:id/client-review', requireAuth, asyncHandler(async (req, res) => {
  if (req.auth.user.role !== 'CLIENT') {
    return res.status(403).json({ error: 'Apenas o cliente pode registrar esta ação.' });
  }

  const data = clientReviewSchema.parse(req.body);
  const existing = await prisma.report.findUniqueOrThrow({
    where: { id: req.params.id },
    include
  });

  if (!(await canAccessReport(req.auth, existing))) {
    return res.status(403).json({ error: 'Você não tem permissão para acessar este relatório.' });
  }
  if (existing.reportType !== ReportType.RDO) {
    return res.status(400).json({ error: 'Apenas RDO pode receber assinatura do cliente.' });
  }
  if (existing.status === ReportStatus.SIGNED) {
    return res.status(409).json({ error: 'Relatório já está assinado.' });
  }
  if (hasActiveClientRejection(existing)) {
    return res.status(409).json({ error: 'Este relatório já foi reprovado. Aguarde a alteração do gestor para avaliar novamente.' });
  }
  if (existing.status !== ReportStatus.APPROVED) {
    return res.status(409).json({ error: 'Somente relatórios aprovados pelo gestor podem ser avaliados pelo cliente.' });
  }
  if (data.action === 'APPROVED' && isZapSignEnabled()) {
    return res.status(409).json({ error: 'Use a assinatura digital do ZapSign para concluir a aprovação do relatório.' });
  }

  const item = await prisma.$transaction(async tx => {
    await tx.clientReportReview.create({
      data: {
        reportId: existing.id,
        clientUserId: req.auth.user.id,
        action: data.action === 'APPROVED' ? ClientReviewAction.APPROVED : ClientReviewAction.REJECTED,
        comment: data.comment || null,
        ipAddress: clientIp(req),
        userAgent: String(req.headers['user-agent'] || '').slice(0, 1000) || null
      }
    });

    const nextSpecialConditions = { ...(existing.specialConditions || {}) };
    if (data.action === 'REJECTED') {
      nextSpecialConditions[CLIENT_REJECTION_KEY] = new Date().toISOString();
      delete nextSpecialConditions[CLIENT_REJECTION_RESOLVED_KEY];
    }

    return tx.report.update({
      where: { id: existing.id },
      data: {
        status: data.action === 'APPROVED' ? ReportStatus.SIGNED : ReportStatus.PENDING,
        specialConditions: data.action === 'REJECTED'
          ? nextSpecialConditions
          : withClientRejectionCleared(existing.specialConditions)
      },
      include
    });
  });

  if (data.action === 'REJECTED') {
    queueClientRejectionNotification(item, data.comment || '');
  }

  res.json(item);
}));

export default router;
