import fs from 'node:fs/promises';
import { ReportSignatureStatus, ReportStatus, ReportType, ReportVersionStatus } from '@prisma/client';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import {
  ReportAuditAction,
  createSignatureAuditLog,
  hasActiveSignedInternalSignature,
  signatureEvidenceFromRequest
} from '../../lib/internal-report-signatures.js';
import prisma from '../../lib/prisma.js';
import { isManualClientReleaseActive } from '../../lib/reports/client-visibility.js';
import { clearProjectDerivedCaches } from '../../lib/resource-list-cache.js';
import { requireAuth } from '../../middleware/auth.js';

const clientReleaseSchema = z.object({ release: z.boolean() });
const physicalSignatureSchema = z.object({
  fileName: z.string().trim().min(1).max(240),
  pdfDataUrl: z.string().trim().min(1).max(30_000_000)
});

export function registerReportReleaseRoutes(router, {
  requireRdoManager,
  include,
  isReportUnavailable,
  hasActiveClientRejection,
  projectReportsForClientVisibility,
  previousRdosSignedForServiceReport,
  saveManualReportPdf,
  supersedeActiveReportVersions,
  createManualReportVersion,
  releasedServiceReportsAfterRdoSignature,
  queueReleasedServiceReportsEmailAfterRdoSignature
}) {
  router.patch('/:id/client-release', requireAuth, requireRdoManager, asyncHandler(async (req, res) => {
    const { release } = clientReleaseSchema.parse(req.body || {});
    const existing = await prisma.report.findUnique({ where: { id: req.params.id }, include });
    if (!existing || isReportUnavailable(existing)) return res.status(404).json({ error: 'Relatório não encontrado.' });
    if (existing.reportType === ReportType.RDO || existing.specialConditions?.serviceOnly === true || !existing.specialConditions?.parentRdoId) {
      return res.status(400).json({ error: 'A liberação individual é exclusiva de relatórios de serviço vinculados a um RDO.' });
    }
    if (existing.status !== ReportStatus.APPROVED && existing.status !== ReportStatus.SIGNED) {
      return res.status(409).json({ error: 'Aprove o relatório de serviço antes de liberá-lo ao cliente.' });
    }
    if (existing.project?.managerOnly || !existing.project?.clientCnpj) {
      return res.status(409).json({ error: 'O projeto precisa estar disponível para o cliente.' });
    }

    const projectReports = await projectReportsForClientVisibility(existing.projectId);
    const byId = new Map(projectReports.map(report => [report.id, report]));
    const parent = byId.get(existing.specialConditions.parentRdoId);
    if (!parent || parent.reportType !== ReportType.RDO || parent.projectId !== existing.projectId) {
      return res.status(409).json({ error: 'O RDO vinculado não está disponível.' });
    }
    if (parent.status === ReportStatus.SIGNED && previousRdosSignedForServiceReport(existing, parent, byId)) {
      return res.status(409).json({ error: 'Este relatório já está liberado pela assinatura dos RDOs.' });
    }
    if (isManualClientReleaseActive(existing) === release) return res.json(existing);

    const evidence = signatureEvidenceFromRequest(req);
    const item = await prisma.$transaction(async tx => {
      const releaseTime = new Date(Math.max(Date.now(), new Date(existing.updatedAt).getTime() + 1));
      const changed = await tx.report.updateMany({
        where: {
          id: existing.id,
          updatedAt: existing.updatedAt,
          deletedAt: null,
          status: { in: [ReportStatus.APPROVED, ReportStatus.SIGNED] }
        },
        data: {
          clientReleasedAt: release ? releaseTime : null,
          clientReleasedByUserId: release ? req.auth.user.id : null,
          updatedAt: releaseTime
        }
      });
      if (changed.count !== 1) {
        const error = new Error('O relatório foi alterado. Atualize a lista e tente novamente.');
        error.statusCode = 409;
        throw error;
      }
      await createSignatureAuditLog(tx, {
        reportId: existing.id,
        userId: req.auth.user.id,
        action: release ? ReportAuditAction.CLIENT_RELEASED : ReportAuditAction.CLIENT_RELEASE_REVOKED,
        description: release ? 'Relatorio de servico liberado individualmente para o cliente.' : 'Liberacao individual do relatorio de servico revogada.',
        evidence
      });
      return tx.report.findUniqueOrThrow({ where: { id: existing.id }, include });
    });
    clearProjectDerivedCaches();
    res.json(item);
  }));

  router.post('/:id/physical-signature', requireAuth, requireRdoManager, asyncHandler(async (req, res) => {
    const data = physicalSignatureSchema.parse(req.body || {});
    const existing = await prisma.report.findUnique({ where: { id: req.params.id }, include });
    if (!existing || isReportUnavailable(existing)) return res.status(404).json({ error: 'Relatório não encontrado.' });
    if (existing.reportType !== ReportType.RDO) {
      return res.status(400).json({ error: 'O upload de assinatura física está disponível para RDOs.' });
    }
    if (existing.status !== ReportStatus.APPROVED || hasActiveClientRejection(existing)) {
      return res.status(409).json({ error: 'Somente um RDO aprovado e sem reprovação ativa pode receber a versão assinada.' });
    }
    if (hasActiveSignedInternalSignature(existing) || existing.zapsignSignedAt) {
      return res.status(409).json({ error: 'Já há uma assinatura digital registrada neste RDO.' });
    }

    const savedPdf = await saveManualReportPdf({
      project: existing.project,
      reportType: existing.reportType,
      sequenceNumber: existing.sequenceNumber || null,
      reportDate: existing.reportDate,
      fileName: data.fileName,
      pdfDataUrl: data.pdfDataUrl,
      folder: 'assinaturas-fisicas'
    });
    const evidence = signatureEvidenceFromRequest(req);
    let item;
    try {
      item = await prisma.$transaction(async tx => {
        const changed = await tx.report.updateMany({
          where: {
            id: existing.id,
            updatedAt: existing.updatedAt,
            deletedAt: null,
            status: ReportStatus.APPROVED,
            zapsignSignedAt: null,
            reportSignatures: { none: { status: ReportSignatureStatus.SIGNED, version: { status: ReportVersionStatus.ACTIVE } } }
          },
          data: {
            status: ReportStatus.SIGNED,
            physicalSignedAt: new Date(),
            physicalSignedByUserId: req.auth.user.id,
            zapsignDocToken: null,
            zapsignSignerToken: null,
            zapsignRequestedAt: null,
            zapsignSignedAt: null,
            zapsignDocUrl: null
          }
        });
        if (changed.count !== 1) {
          const error = new Error('O RDO ou suas assinaturas foram alterados. Atualize a lista e tente novamente.');
          error.statusCode = 409;
          throw error;
        }
        await supersedeActiveReportVersions(tx, existing.id, {
          userId: req.auth.user.id,
          evidence,
          description: 'Rodada digital substituida pelo PDF assinado fisicamente.'
        });
        const version = await createManualReportVersion(tx, existing, savedPdf, {
          signed: true,
          userId: req.auth.user.id,
          evidence,
          sourceDescription: 'PDF assinado fisicamente recebido e registrado como versao final.',
          lockedDescription: 'RDO assinado fisicamente e bloqueado.'
        });
        await createSignatureAuditLog(tx, {
          reportId: existing.id,
          versionId: version.id,
          userId: req.auth.user.id,
          action: ReportAuditAction.PHYSICAL_SIGNATURE_UPLOADED,
          description: `Versao assinada fisicamente recebida: ${savedPdf.originalFileName}.`,
          evidence
        });
        return tx.report.findUniqueOrThrow({ where: { id: existing.id }, include });
      });
    } catch (error) {
      await fs.unlink(savedPdf.targetPath).catch(() => undefined);
      throw error;
    }

    const releasedServiceReports = await releasedServiceReportsAfterRdoSignature(item);
    if (releasedServiceReports.length) {
      queueReleasedServiceReportsEmailAfterRdoSignature(item, releasedServiceReports, { userId: req.auth.user.id, evidence });
    }
    clearProjectDerivedCaches();
    res.json({ report: item, releasedServiceReports });
  }));
}
