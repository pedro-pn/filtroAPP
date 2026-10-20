import env from '../../config/env.js';
import { internalSignatureTokenExpiresAt, issuePendingSignatureTokens } from '../internal-report-signatures.js';
import { createSignatureToken, decryptSignatureToken, signatureTokenHash } from '../signature-token.js';

function accessUrl(path, token) {
  return `${String(env.appUrl || '').replace(/\/+$/, '')}${path}/${encodeURIComponent(token)}`;
}

// Reuse the invite token so the approval email does not invalidate the signature email.
export async function reportApprovalAccessLink(report, recipientEmail, client) {
  const email = String(recipientEmail || '').trim().toLowerCase();
  const signature = (report.reportSignatures || []).find(item =>
    String(item.signerEmail || '').trim().toLowerCase() === email && item.status === 'PENDING'
  );
  if (signature) {
    const [issued] = await issuePendingSignatureTokens(client, { signatures: [signature] });
    const token = issued?.token || decryptSignatureToken(signature);
    if (!issued && signatureTokenHash(token) !== signature.tokenHash) {
      throw new Error('Token de assinatura diverge do hash registrado.');
    }
    return {
      accessUrl: accessUrl('/assinar', token),
      canSign: true,
      expiresAt: issued?.expiresAt || signature.tokenExpiresAt
    };
  }

  const token = createSignatureToken();
  const expiresAt = internalSignatureTokenExpiresAt();
  await client.reportClientAccess.create({
    data: {
      reportId: report.id,
      recipientEmail: email,
      tokenHash: signatureTokenHash(token),
      expiresAt,
      approvedAt: report.approvedAt || null,
      versionId: report.versions?.[0]?.id || null
    }
  });
  return { accessUrl: accessUrl('/rdo-publico', token), canSign: false, expiresAt };
}

export function reportClientAccessStatus(access, now = new Date()) {
  if (!access) return 'INVALID';
  if (new Date(access.expiresAt).getTime() <= now.getTime()) return 'EXPIRED';
  const report = access.report;
  if (!report || report.deletedAt || report.project?.deletedAt || report.project?.managerOnly
    || report.reportType !== 'RDO' || !['APPROVED', 'SIGNED'].includes(report.status)) return 'UNAVAILABLE';
  const approvalTime = value => value ? new Date(value).getTime() : null;
  if (approvalTime(access.approvedAt) !== approvalTime(report.approvedAt)) return 'INVALIDATED';
  if (access.versionId && !report.versions?.some(version => version.id === access.versionId && version.status === 'ACTIVE')) {
    return 'INVALIDATED';
  }
  return 'ACTIVE';
}
