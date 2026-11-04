import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { projectAllowsChannel, projectChannelWhere } from './distribution.js';

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

export async function ensureCommercialProposalSync(database, project, { now = new Date() } = {}) {
  if (project.commercialProposalSync || !project.isActive || project.workflow?.stage === 'FINISHED' ||
      !projectAllowsChannel(project, 'commercial')) return project.commercialProposalSync || null;
  const reference = commercialProposalReference(project.contractCode);
  if (!reference) return null;
  const data = commercialProposalSyncData(reference, null, { now });
  // Inicializa apenas uma fila ausente. Não substitui revisões, tentativas ou exclusões existentes.
  const changed = await database.project.updateMany({
    where: {
      id: project.id, contractCode: project.contractCode, isActive: true,
      ...projectChannelWhere('commercial'),
      commercialProposalSync: { equals: Prisma.AnyNull },
      OR: [{ workflow: { is: null } }, { workflow: { is: { stage: { not: 'FINISHED' } } } }]
    },
    data
  });
  if (changed.count === 1) return data.commercialProposalSync;
  const current = await database.project.findUnique({
    where: { id: project.id }, select: { commercialProposalSync: true }
  });
  return current?.commercialProposalSync || null;
}
