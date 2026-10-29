import { IntegrationApiError } from '../../middleware/api-request-context.js';

const pick = (row, fields) => Object.fromEntries(fields.map(field => [field, row[field] ?? null]));

// Projeções explícitas, lidas antes do rollback, sem identificadores alocados
// provisoriamente. Também representam corretamente replays e versões antigas.
export async function projectWritePreview(tx, operationId, result) {
  if (operationId === 'logistics.unloadings.create') {
    return pick(result, ['romaneioId', 'tipo', 'confirmadaEm', 'confirmadaPorEmail']);
  }
  if (operationId === 'quality.records.create') {
    const row = await tx.qualityRecord.findUniqueOrThrow({ where: { id: result.id },
      select: { type: true, status: true, origin: true, description: true, impact: true, externalRef: true,
        actionOwnerUserId: true, eventDate: true, number: true, project: { select: { code: true } } } });
    return { ...pick(row, ['type', 'status', 'origin', 'description', 'impact', 'externalRef', 'actionOwnerUserId']),
      projectCode: row.project.code, eventDate: row.eventDate.toISOString().slice(0, 10), previewNumber: row.number };
  }
  if (operationId === 'efetivo.projects.create') {
    const row = await tx.project.findUniqueOrThrow({ where: { id: result.project.id } });
    return { outcome: result.status, ...pick(row, ['code', 'name', 'clientName', 'clientCnpj', 'contractCode', 'location',
      'clientSegment', 'isActive', 'registrationPending', 'workdayHours', 'weekendWorkdayHours', 'includesSaturday', 'includesSunday']),
      commercialRevision: result.commercialRevision };
  }
  if (operationId === 'acompanhamento.opportunities.post') {
    const row = await tx.crmOpportunity.findUniqueOrThrow({ where: { id: result.accompanimentId } });
    return { disposition: result.disposition, ...pick(row, ['externalId', 'commercialStatus', 'planningRequested',
      'sourceRecordDeleted', 'scopeKind', 'name', 'description', 'clientName', 'clientCnpj', 'location', 'proposalCode',
      'revision', 'expectedStartDate', 'expectedEndDate', 'projectLinkStatus', 'projectLinkReason']),
      sourceVersion: Number(row.sourceVersion) };
  }
  if (operationId === 'efetivo.projects.commercialFact.post') {
    const row = await tx.projectWorkflowCommercialFact.findUniqueOrThrow({
      where: { projectId_key: { projectId: result.projectId, key: result.key } } });
    return { outcome: result.outcome, ...pick(row, ['key', 'status', 'source', 'reference', 'note', 'occurredOn',
      'externalId', 'externalUrl', 'sourceVersion', 'sourceUpdatedAt']) };
  }
  if (operationId === 'efetivo.projects.document.post') {
    const document = await tx.projectDocument.findUniqueOrThrow({ where: { id: result.documentId } });
    const version = await tx.projectDocumentVersion.findUniqueOrThrow({ where: { id: result.versionId } });
    return { outcome: result.outcome, ...pick(document, ['type', 'title', 'description', 'requirementStage', 'acceptanceMode']),
      version: pick(version, ['versionLabel', 'source', 'contentKind', 'externalId', 'externalUrl', 'sourceVersion', 'sourceUpdatedAt', 'acceptanceStatus']) };
  }
  throw new IntegrationApiError(501, 'SIMULATION_NOT_SUPPORTED', 'A operação não suporta simulação.');
}
