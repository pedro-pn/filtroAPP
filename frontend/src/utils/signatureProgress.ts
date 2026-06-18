import type { ReportSummary } from '../types/domain';

export interface SignatureProgressSigner {
  name: string;
  declaredName?: string | null;
  email?: string | null;
  status: 'SIGNED' | 'PENDING' | 'REJECTED';
  signedAt?: string | null;
  rejectedAt?: string | null;
}

export interface SignatureProgress {
  total: number;
  signed: number;
  pending: number;
  signers: SignatureProgressSigner[];
  updatedAt?: string | null;
}

function stringValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

export function reportSignatureProgress(report: ReportSummary): SignatureProgress | null {
  if (Array.isArray(report.reportSignatures) && report.reportSignatures.length) {
    const active = report.reportSignatures.filter(signature => signature.status !== 'INVALIDATED');
    const required = active.filter(signature => signature.isRequired !== false);
    const total = required.length;
    if (!total) return null;
    const signed = required.filter(signature => signature.status === 'SIGNED').length;
    return {
      total,
      signed,
      pending: Math.max(total - signed, 0),
      signers: active.map(signature => ({
        name: stringValue(signature.signerName) || stringValue(signature.signerEmail) || 'Assinante',
        declaredName: stringValue(signature.declaredSignerName) || null,
        email: stringValue(signature.signerEmail) || null,
        status: signature.status === 'SIGNED' ? 'SIGNED' : signature.status === 'REJECTED' ? 'REJECTED' : 'PENDING',
        signedAt: stringValue(signature.signedAt) || null,
        rejectedAt: stringValue(signature.rejectedAt) || null
      })),
      updatedAt: active
        .map(signature => stringValue(signature.signedAt) || stringValue(signature.rejectedAt))
        .filter(Boolean)
        .sort()
        .at(-1) || null
    };
  }
  return null;
}

export function signedSignerNames(progress: SignatureProgress) {
  return progress.signers
    .filter(signer => signer.status === 'SIGNED')
    .map(signer => signer.declaredName || signer.name)
    .filter(Boolean);
}
