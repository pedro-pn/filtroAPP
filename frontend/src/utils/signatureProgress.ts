import type { ReportSummary } from '../types/domain';

export interface SignatureProgressSigner {
  name: string;
  email?: string | null;
  status: 'SIGNED' | 'PENDING';
  signedAt?: string | null;
}

export interface SignatureProgress {
  total: number;
  signed: number;
  pending: number;
  signers: SignatureProgressSigner[];
  updatedAt?: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

export function reportSignatureProgress(report: ReportSummary): SignatureProgress | null {
  const special = asRecord(report.specialConditions);
  const raw = asRecord(special.__zapSignSignatureProgress);
  const signersRaw = Array.isArray(raw.signers) ? raw.signers : [];
  const signers = signersRaw
    .map(item => {
      const signer = asRecord(item);
      const status = stringValue(signer.status).toUpperCase() === 'SIGNED' ? 'SIGNED' : 'PENDING';
      return {
        name: stringValue(signer.name) || stringValue(signer.email) || 'Assinante',
        email: stringValue(signer.email) || null,
        status,
        signedAt: stringValue(signer.signedAt) || null
      } satisfies SignatureProgressSigner;
    });

  const total = Number(raw.total || signers.length || 0);
  if (!Number.isFinite(total) || total <= 1) return null;
  const signed = Number(raw.signed ?? signers.filter(item => item.status === 'SIGNED').length);
  const safeSigned = Number.isFinite(signed) ? Math.max(Math.min(signed, total), 0) : 0;
  return {
    total,
    signed: safeSigned,
    pending: Math.max(total - safeSigned, 0),
    signers,
    updatedAt: stringValue(raw.updatedAt) || null
  };
}

export function signedSignerNames(progress: SignatureProgress) {
  return progress.signers
    .filter(signer => signer.status === 'SIGNED')
    .map(signer => signer.name)
    .filter(Boolean);
}
