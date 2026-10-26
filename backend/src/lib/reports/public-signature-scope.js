import { ReportSignatureStatus, ReportStatus, ReportType, ReportVersionStatus } from '@prisma/client';
import { internalSignatureTokenHash } from '../internal-report-signatures.js';

function signerEmailValue(value) {
  return String(value || '').trim().toLowerCase();
}

export function createPublicReportSignatureScope({
  database, reportInclude, publicSignatureStatus, isFinalizationRetryableSignature
}) {
  async function publicSignatureFromToken(token, client = database) {
    return client.reportSignature.findUnique({
      where: { tokenHash: internalSignatureTokenHash(token) },
      include: {
        report: { include: reportInclude },
        version: { include: { signatures: { orderBy: { createdAt: 'asc' } } } }
      }
    });
  }

  function publicSignatureBatchScopeUnavailable(status) {
    return ['INVALID', 'UNAVAILABLE', 'EXPIRED', 'INVALIDATED', 'REJECTED'].includes(status);
  }

  function publicSignatureProjectScope(anchor) {
    if (!anchor?.report?.projectId || !signerEmailValue(anchor.signerEmail) || anchor.report.reportType !== ReportType.RDO || anchor.signerRole !== 'CLIENT') return null;
    return {
      signerEmail: { equals: signerEmailValue(anchor.signerEmail), mode: 'insensitive' },
      signerRole: 'CLIENT',
      status: { in: [ReportSignatureStatus.PENDING, ReportSignatureStatus.SIGNED] },
      OR: [{ tokenExpiresAt: null }, { tokenExpiresAt: { gt: new Date() } }],
      version: { status: ReportVersionStatus.ACTIVE },
      report: {
        projectId: anchor.report.projectId,
        reportType: ReportType.RDO,
        status: { in: [ReportStatus.APPROVED, ReportStatus.SIGNED] },
        deletedAt: null,
        project: { deletedAt: null, managerOnly: false }
      }
    };
  }

  async function publicProjectSignatures(anchor, client = database) {
    const scope = publicSignatureProjectScope(anchor);
    if (!scope || publicSignatureBatchScopeUnavailable(publicSignatureStatus(anchor)) || anchor.version?.status !== ReportVersionStatus.ACTIVE) return [];
    const signatures = await client.reportSignature.findMany({
      where: { ...scope, id: { not: anchor.id } },
      select: {
        id: true, signerName: true, signerEmail: true, declaredSignerName: true,
        status: true, signedAt: true, rejectedAt: true, tokenExpiresAt: true, sourceDocumentHash: true,
        report: { select: {
          id: true, reportType: true, sequenceNumber: true, reportDate: true, status: true, deletedAt: true,
          project: { select: { code: true, name: true, clientName: true, clientSigners: true, deletedAt: true, managerOnly: true } }
        } },
        version: { select: { status: true, finalDocumentHash: true, signatures: { select: { status: true, isRequired: true } } } }
      },
      orderBy: [{ report: { reportDate: 'asc' } }, { createdAt: 'asc' }]
    });
    return signatures.filter(signature => ['ACTIVE', 'SIGNED'].includes(publicSignatureStatus(signature)));
  }

  async function publicSignatureForTokenScopeOrThrow(token, signatureId, client = database, { retryable = false, allowSigned = false } = {}) {
    if (!signatureId && !allowSigned) {
      return retryable
        ? retryablePublicSignatureForConfirmOrThrow(token, client)
        : activePublicSignatureOrThrow(token, client);
    }

    const anchor = await publicSignatureFromToken(token, client);
    const anchorStatus = publicSignatureStatus(anchor);
    if (publicSignatureBatchScopeUnavailable(anchorStatus)) {
      const error = new Error('Link de assinatura indisponível.');
      error.statusCode = anchorStatus === 'INVALID' ? 404 : 409;
      error.publicStatus = anchorStatus;
      throw error;
    }

    const scope = publicSignatureProjectScope(anchor);
    const signature = !signatureId || anchor?.id === signatureId ? anchor
      : scope && anchor.version?.status === ReportVersionStatus.ACTIVE
        ? await client.reportSignature.findFirst({
            where: { ...scope, id: signatureId },
            include: {
              report: { include: reportInclude },
              version: { include: { signatures: { orderBy: { createdAt: 'asc' } } } }
            }
          })
        : null;
    const status = publicSignatureStatus(signature);
    const readableSigned = allowSigned && status === 'SIGNED'
      && signature.version?.status === ReportVersionStatus.ACTIVE
      && [ReportStatus.APPROVED, ReportStatus.SIGNED].includes(signature.report?.status);
    if (!signature || (status !== 'ACTIVE' && !readableSigned && !(retryable && isFinalizationRetryableSignature(signature)))) {
      const error = new Error('Link de assinatura indisponível.');
      error.statusCode = !signature ? 404 : 409;
      error.publicStatus = !signature ? 'INVALID' : status;
      throw error;
    }
    return signature;
  }

  async function activePublicSignatureOrThrow(token, client = database) {
    const signature = await publicSignatureFromToken(token, client);
    const status = publicSignatureStatus(signature);
    if (status !== 'ACTIVE') {
      const error = new Error('Link de assinatura indisponível.');
      error.statusCode = status === 'INVALID' ? 404 : 409;
      error.publicStatus = status;
      throw error;
    }
    return signature;
  }

  async function retryablePublicSignatureForConfirmOrThrow(token, client = database) {
    const signature = await publicSignatureFromToken(token, client);
    const status = publicSignatureStatus(signature);
    if (status !== 'ACTIVE' && !isFinalizationRetryableSignature(signature)) {
      const error = new Error('Link de assinatura indisponível.');
      error.statusCode = status === 'INVALID' ? 404 : 409;
      error.publicStatus = status;
      throw error;
    }
    return signature;
  }

  return { publicSignatureFromToken, publicProjectSignatures, publicSignatureForTokenScopeOrThrow };
}
