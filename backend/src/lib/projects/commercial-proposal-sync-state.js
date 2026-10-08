import { randomUUID } from 'node:crypto';

export function commercialProposalReference(contractCode) {
  const match = String(contractCode || '').trim().match(/^(?:proposta\s+)?(\d{1,40})(?:\s*(?:[-/]\s*)?(?:rev(?:is[aã]o)?\.?|r)\s*(\d+))?$/i);
  if (!match) return null;
  const revisionNumber = Number(match[2] || 0);
  if (!Number.isSafeInteger(revisionNumber) || revisionNumber > 2_147_483_647) return null;
  return { proposalCode: match[1], revisionNumber };
}

export function commercialProposalSyncData(reference, previous = null, { force = false, now = new Date() } = {}) {
  if (!reference || !/^\d{1,40}$/.test(reference.proposalCode) || !Number.isInteger(reference.revisionNumber) ||
      reference.revisionNumber < 0 || reference.revisionNumber > 2_147_483_647) {
    return { commercialProposalSync: null, commercialProposalSyncNextAttemptAt: null };
  }
  if (!force && previous?.proposalCode === reference.proposalCode && previous?.revisionNumber === reference.revisionNumber) return {};
  return {
    commercialProposalSync: {
      requestId: randomUUID(), status: 'PENDING', ...reference,
      requestedAt: now.toISOString(), attempts: 0, errorCode: null
    },
    commercialProposalSyncNextAttemptAt: now
  };
}
