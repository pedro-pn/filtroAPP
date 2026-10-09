import prisma from '../prisma.js';

export const isPresentationCopyId = id => /^presentation-[a-zA-Z0-9-]+$/.test(id ?? '');

// The snapshot is a presentation only. It never participates in financial imports,
// workforce allocation, quality recurrence or operational report numbering.
export async function getPresentationCopy(id, client = prisma) {
  if (!isPresentationCopyId(id)) return null;
  const [row] = await client.$queryRaw`
    SELECT * FROM "ProjectPresentationCopy" WHERE "id" = ${id} AND "endedAt" IS NULL`;
  return row ?? null;
}

export async function listPresentationCopies(client = prisma) {
  return client.$queryRaw`SELECT * FROM "ProjectPresentationCopy" WHERE "endedAt" IS NULL ORDER BY "createdAt"`;
}

export function presentationMetadata(copy) {
  return {
    id: copy.id, sourceProjectId: copy.sourceProjectId,
    sourceCode: copy.snapshot.originalProject.code,
    createdAt: new Date(copy.createdAt).toISOString(),
    hidePlannedCost: true,
    taxAmount: copy.snapshot.taxAmount
  };
}

export function presentationPayload(copy, key, admin = false) {
  const payload = copy.snapshot.variants[admin ? 'admin' : 'standard'][key]
    ?? copy.snapshot.auxiliary[key];
  if (payload === undefined) return undefined;
  const result = structuredClone(payload);
  if (key === 'card' || key === 'detalhe') {
    result.presentation = presentationMetadata(copy);
    if (result.presumedProfitTaxes) result.presumedProfitTaxes.totalTax = copy.snapshot.taxAmount;
    // A cost comparison would disclose the hidden budget through its percentage.
    result.alerts = (result.alerts ?? []).filter(alert => alert.code !== 'CUSTO');
    if (key === 'card') {
      result.projectId = copy.id;
      for (const field of ['plannedCost', 'fullPlannedCost', 'originalPlannedCost', 'additionalPlannedCost', 'costConsumedPct']) result[field] = null;
      result.archived = false;
      result.archivedInAcompanhamento = false;
      result.reviewed = false;
      result.reviewedAt = null;
    } else {
      for (const field of ['previsto', 'previstoIntegral', 'previstoOriginal', 'previstoAdicional', 'pct']) result.consumo[field] = null;
    }
    if (result.budgetBreakdown) {
      for (const value of [result.budgetBreakdown.original, ...(result.budgetBreakdown.additionals ?? []), result.budgetBreakdown.additionalTotals, result.budgetBreakdown.totals]) {
        if (value) value.plannedTotalCost = null;
      }
    }
  }
  return result;
}

export async function createPresentationCopy({ id, snapshot }, client = prisma) {
  if (!isPresentationCopyId(id)) throw new Error('Identificador da apresentação inválido.');
  const original = snapshot.originalProject;
  return client.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${original.id} FOR UPDATE`;
    const current = await tx.project.findUnique({ where: { id: original.id } });
    if (!current || Object.keys(original).some(key => JSON.stringify(current[key]) !== JSON.stringify(original[key]))) {
      throw new Error('A missão mudou durante a preparação. Capture novamente antes de aplicar.');
    }
    const archiveAt = new Date();
    const [copy] = await tx.$queryRaw`
      INSERT INTO "ProjectPresentationCopy" ("id", "sourceProjectId", "snapshot", "createdAt")
      VALUES (${id}, ${original.id}, ${JSON.stringify({ ...snapshot, archiveAt: archiveAt.toISOString() })}::jsonb, ${archiveAt})
      RETURNING *`;
    // Archive in Acompanhamento only. The normal RDO archive sends client mail.
    await tx.$executeRaw`UPDATE "Project" SET "acompanhamentoArchivedAt" = ${archiveAt},
      "acompanhamentoReviewedAt" = NULL, "updatedAt" = ${archiveAt} WHERE "id" = ${original.id}`;
    return copy;
  }, { isolationLevel: 'Serializable', timeout: 30000 });
}

export async function endPresentationCopy(id, client = prisma) {
  return client.$transaction(async tx => {
    const [copy] = await tx.$queryRaw`SELECT * FROM "ProjectPresentationCopy" WHERE "id" = ${id} FOR UPDATE`;
    if (!copy) throw new Error('Apresentação não encontrada.');
    if (copy.endedAt) return copy;
    const [project] = await tx.$queryRaw`SELECT * FROM "Project" WHERE "id" = ${copy.sourceProjectId} FOR UPDATE`;
    if (!project || !project.acompanhamentoArchivedAt || new Date(project.acompanhamentoArchivedAt).toISOString() !== copy.snapshot.archiveAt) {
      throw new Error('O arquivamento da original mudou. Confira antes de restaurar.');
    }
    const original = copy.snapshot.originalProject;
    await tx.$executeRaw`UPDATE "Project" SET
      "acompanhamentoArchivedAt" = ${original.acompanhamentoArchivedAt ? new Date(original.acompanhamentoArchivedAt) : null},
      "acompanhamentoReviewedAt" = ${original.acompanhamentoReviewedAt ? new Date(original.acompanhamentoReviewedAt) : null},
      "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${copy.sourceProjectId}`;
    const [ended] = await tx.$queryRaw`UPDATE "ProjectPresentationCopy" SET "endedAt" = CURRENT_TIMESTAMP WHERE "id" = ${id} RETURNING *`;
    return ended;
  }, { isolationLevel: 'Serializable', timeout: 30000 });
}
