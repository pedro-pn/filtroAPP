import { z } from 'zod';

import { PROJECT_WORKFLOW_COMMERCIAL_FACTS, PROJECT_WORKFLOW_COMMERCIAL_FACT_STATUSES, makeProjectWorkflowCommercialFactSchema } from '../../../../shared/schemas/project-workflow.js';
import { makeProjectDocumentSchemas } from '../../../../shared/schemas/project-documents.js';
import { upsertCrmProjectDocument } from '../efetivo/project-workflow/documents.js';
import { projectIntakeSchema, receiveProjectIntake } from '../projects/project-intake.js';
import { IntegrationApiError } from '../../middleware/api-request-context.js';

const idSchema = z.string().trim().min(1).max(100);
const factSchema = z.object({
  key: z.enum(PROJECT_WORKFLOW_COMMERCIAL_FACTS.map(item => item.key)),
  status: z.enum(PROJECT_WORKFLOW_COMMERCIAL_FACT_STATUSES),
  reference: z.string().trim().max(500).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  occurredOn: z.string().nullable().optional(),
  externalId: z.string().trim().min(1).max(180),
  externalUrl: z.url().refine(value => /^https?:\/\//i.test(value)).nullable().optional(),
  sourceVersion: z.string().trim().min(1).max(80),
  sourceUpdatedAt: z.iso.datetime({ offset: true }).transform(value => new Date(value))
}).strict();
const documentSchema = makeProjectDocumentSchemas(z).crm.omit({ projectId: true });

export function validateProjectWriteAccess(projectId, query, context, { create = false } = {}) {
  if (Object.keys(query || {}).length) throw new IntegrationApiError(400, 'UNKNOWN_PARAMETER', 'Esta operação não aceita filtros de consulta.');
  if (create && context.projectAccessMode !== 'ALL') {
    throw new IntegrationApiError(403, 'PROJECT_NOT_ALLOWED', 'Criar projetos exige acesso a todos os projetos.');
  }
  if (!create && (context.projectAccessMode !== 'ALL' &&
    (context.projectAccessMode !== 'SELECTED' || !context.projectIds?.has(projectId)))) {
    throw new IntegrationApiError(403, 'PROJECT_NOT_ALLOWED', 'O projeto solicitado não está autorizado.');
  }
  return create ? null : idSchema.parse(projectId);
}

export function validateProjectCreation(input) {
  return projectIntakeSchema.parse(input);
}

export function validateCommercialFact(input) {
  const fact = factSchema.parse(input);
  makeProjectWorkflowCommercialFactSchema(z).parse({
    action: 'commercial_fact', version: 1, key: fact.key, status: fact.status,
    reference: fact.reference, note: fact.note, occurredOn: fact.occurredOn
  });
  return fact;
}

export function validateCrmDocument(input) {
  z.iso.datetime({ offset: true }).parse(input?.sourceUpdatedAt);
  return documentSchema.parse(input);
}

export async function createCrmProject(database, input) {
  return receiveProjectIntake(input, database);
}

export async function createCrmDocument(database, projectId, input) {
  const parsed = validateCrmDocument(input);
  return upsertCrmProjectDocument(database, { ...parsed, projectId });
}

function versionOrder(left, right) {
  const timeDifference = new Date(left.sourceUpdatedAt).getTime() - new Date(right.sourceUpdatedAt).getTime();
  return timeDifference || String(left.sourceVersion).localeCompare(String(right.sourceVersion), 'pt-BR', { numeric: true, sensitivity: 'base' });
}

export async function upsertCrmCommercialFact(database, projectId, rawInput, { now = new Date() } = {}) {
  const input = validateCommercialFact(rawInput);
  const project = await database.project.findFirst({
    where: { id: projectId, isActive: true, deletedAt: null },
    select: { id: true, workflow: { select: { projectId: true } } }
  });
  if (!project) throw new IntegrationApiError(404, 'NOT_FOUND', 'Projeto não encontrado.');
  if (!project.workflow) throw new IntegrationApiError(409, 'WORKFLOW_NOT_STARTED', 'Inicie a gestão de efetivo antes de enviar fatos comerciais.');

  const mutate = async tx => {
    const existing = await tx.projectWorkflowCommercialFact.findUnique({ where: { projectId_key: { projectId, key: input.key } } });
    if (existing?.source === 'CRM' && existing.sourceUpdatedAt && existing.sourceVersion) {
      const order = versionOrder(input, existing);
      if (order < 0) return { outcome: 'IGNORED_OLDER', projectId, key: input.key, sourceVersion: input.sourceVersion };
      if (order === 0) {
        if (existing.externalId !== input.externalId || existing.status !== input.status ||
          (existing.reference || null) !== (input.reference || null) ||
          (existing.note || null) !== (input.note || null) ||
          (existing.externalUrl || null) !== (input.externalUrl || null) ||
          (existing.occurredOn?.toISOString().slice(0, 10) || null) !== (input.occurredOn || null)) {
          throw new IntegrationApiError(409, 'SOURCE_VERSION_CONFLICT', 'A versão recebida já existe com dados diferentes.');
        }
        await tx.projectWorkflowCommercialFact.update({ where: { projectId_key: { projectId, key: input.key } }, data: { lastSyncedAt: now } });
        return { outcome: 'REPLAYED', projectId, key: input.key, sourceVersion: input.sourceVersion };
      }
    }
    const data = {
      status: input.status, source: 'CRM', reference: input.reference || null,
      note: input.note || null, occurredOn: input.occurredOn ? new Date(`${input.occurredOn}T00:00:00.000Z`) : null,
      externalId: input.externalId, externalUrl: input.externalUrl || null,
      sourceVersion: input.sourceVersion, sourceUpdatedAt: input.sourceUpdatedAt,
      lastSyncedAt: now, updatedByUserId: null, evidenceDocumentId: null
    };
    await tx.projectWorkflowCommercialFact.upsert({
      where: { projectId_key: { projectId, key: input.key } },
      create: { projectId, key: input.key, ...data }, update: data
    });
    await tx.projectWorkflow.update({
      where: { projectId },
      data: { version: { increment: 1 }, mobilizationAuthorizedAt: null, mobilizationAuthorizationVersion: null }
    });
    if (tx.projectWorkflowEvent?.create) await tx.projectWorkflowEvent.create({
      data: { projectId, actorUserId: null, action: 'COMMERCIAL_FACT_CRM_UPDATED', data: { key: input.key, externalId: input.externalId, sourceVersion: input.sourceVersion } }
    });
    return { outcome: existing ? 'UPDATED' : 'CREATED', projectId, key: input.key, sourceVersion: input.sourceVersion };
  };
  if (!database.$transaction) return mutate(database);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await database.$transaction(mutate, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (!['P2034', 'P2002'].includes(error?.code) || attempt === 2) throw error;
    }
  }
  throw new Error('A transação do fato comercial não pôde ser concluída.');
}
