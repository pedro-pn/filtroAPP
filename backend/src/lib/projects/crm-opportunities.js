import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';

import prisma from '../prisma.js';
import { IntegrationApiError } from '../../middleware/api-request-context.js';
import { clearProjectDerivedCaches } from '../resource-list-cache.js';
import { projectIntakeInputSchema, projectIntakeSchema, receiveProjectIntake } from './project-intake.js';

const text = max => z.string().trim().min(1).max(max);
const optionalText = max => text(max).nullable().default(null);
const cnpj = z.string().trim().transform(value => value.replace(/\D/g, ''))
  .refine(value => value.length === 14, 'CNPJ deve conter exatamente 14 dígitos.');

// Retrato completo da oportunidade. Versão crescente por externalId é a ordem oficial.
export const crmOpportunitySchema = z.object({
  externalId: text(180),
  sourceVersion: z.number().int().positive().max(2_147_483_647),
  sourceUpdatedAt: z.iso.datetime({ offset: true }).transform(value => new Date(value).toISOString()),
  status: z.enum(['HOT', 'WITHDRAWN', 'LOST', 'CANCELLED', 'WON']),
  name: text(240),
  clientName: text(240),
  clientCnpj: cnpj.nullable().default(null),
  location: optionalText(240),
  proposalCode: z.string().trim().regex(/^\d{1,40}$/).nullable().default(null),
  revision: z.number().int().min(0).max(2_147_483_647).nullable().default(null),
  estimatedValue: z.number().min(0).max(999_999_999_999.99).multipleOf(0.01).nullable().default(null),
  expectedCloseDate: z.iso.date().nullable().default(null),
  expectedStartDate: z.iso.date().nullable().default(null),
  externalUrl: z.url().max(2000).refine(value => /^https?:\/\//i.test(value), 'Informe uma URL HTTP ou HTTPS.').nullable().default(null),
  project: projectIntakeInputSchema.nullable().default(null)
}).strict().superRefine((value, context) => {
  if (value.status === 'WON') {
    const project = projectIntakeSchema.safeParse(value.project);
    if (!project.success) for (const issue of project.error.issues) {
      context.addIssue({ ...issue, path: ['project', ...issue.path] });
    }
    if (value.clientCnpj && value.project && value.clientCnpj !== value.project.clientCnpj) {
      context.addIssue({ code: 'custom', path: ['project', 'clientCnpj'], message: 'O cliente do projeto deve corresponder à oportunidade.' });
    }
  } else if (value.project) {
    context.addIssue({ code: 'custom', path: ['project'], message: 'Dados do projeto são enviados somente no fechamento (WON).' });
  }
});

export const validateCrmOpportunity = input => crmOpportunitySchema.parse(input);
const conflict = (code, message) => new IntegrationApiError(409, code, message);

function result(outcome, opportunity, projectResult = null) {
  return { outcome, opportunity: {
    id: opportunity.id, externalId: opportunity.externalId, status: opportunity.status,
    sourceVersion: opportunity.sourceVersion, projectId: opportunity.projectId
  }, ...(projectResult ? { project: projectResult.project, commercialRevision: projectResult.commercialRevision } : {}) };
}

export async function receiveCrmOpportunity(database, rawInput, { now = new Date() } = {}) {
  const input = validateCrmOpportunity(rawInput);
  const payloadHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await database.$transaction(async tx => {
        const existing = await tx.crmOpportunity.findUnique({ where: { externalId: input.externalId }, include: { project: { select: { code: true } } } });
        if (existing) {
          if (input.sourceVersion < existing.sourceVersion) return result('IGNORED_OLDER', existing);
          if (input.sourceVersion === existing.sourceVersion) {
            if (existing.payloadHash !== payloadHash) throw conflict('SOURCE_VERSION_CONFLICT', 'Esta versão da oportunidade já foi recebida com dados diferentes.');
            await tx.crmOpportunity.update({ where: { id: existing.id }, data: { lastSyncedAt: now } });
            return result('REPLAYED', existing);
          }
          if (existing.projectId && (input.status !== 'WON' || input.project.code !== existing.project.code)) {
            throw conflict('OPPORTUNITY_ALREADY_CONVERTED', 'A oportunidade já está vinculada a um projeto e não pode regredir ou trocar de projeto.');
          }
        }
        let projectResult = null;
        if (input.status === 'WON') {
          projectResult = await receiveProjectIntake(input.project, tx, { inTransaction: true });
          const owner = await tx.crmOpportunity.findUnique({ where: { projectId: projectResult.project.id } });
          if (owner && owner.externalId !== input.externalId) throw conflict('PROJECT_OPPORTUNITY_CONFLICT', 'Este projeto já está vinculado a outra oportunidade.');
          const project = await tx.project.findUnique({ where: { id: projectResult.project.id }, select: { isActive: true, deletedAt: true } });
          if (!project?.isActive || project.deletedAt) throw conflict('PROJECT_UNAVAILABLE', 'O projeto está inativo ou excluído.');
        }
        const { externalId, sourceVersion, sourceUpdatedAt, status, name, clientName, clientCnpj, location,
          proposalCode, revision, estimatedValue, expectedCloseDate, expectedStartDate, externalUrl } = input;
        const data = { status, name, clientName, clientCnpj, location, proposalCode, revision, estimatedValue, externalUrl,
          expectedCloseDate: expectedCloseDate ? new Date(`${expectedCloseDate}T00:00:00Z`) : null,
          expectedStartDate: expectedStartDate ? new Date(`${expectedStartDate}T00:00:00Z`) : null,
          sourceVersion, sourceUpdatedAt: new Date(sourceUpdatedAt), payloadHash, lastSyncedAt: now,
          projectId: projectResult?.project.id ?? null, convertedAt: existing?.convertedAt ?? (projectResult ? now : null) };
        const saved = await tx.crmOpportunity.upsert({ where: { externalId }, create: { externalId, ...data }, update: data });
        await tx.crmOpportunityEvent.create({ data: { opportunityId: saved.id, sourceVersion,
          sourceUpdatedAt: data.sourceUpdatedAt, status, snapshot: input, receivedAt: now } });
        return result(projectResult && !existing?.projectId ? 'CONVERTED' : existing ? 'UPDATED' : 'CREATED', saved, projectResult);
      }, { isolationLevel: 'Serializable', timeout: 15_000 });
      clearProjectDerivedCaches();
      return response;
    } catch (error) {
      if (!['P2034', 'P2002'].includes(error.code)) throw error;
      if (attempt >= 3) throw conflict('CONCURRENT_UPDATE', 'Outra atualização está em andamento. Reenvie a mesma versão.');
      await delay(20 * 2 ** attempt);
    }
  }
}

export async function listCrmOpportunityCards(database = prisma) {
  const rows = await database.crmOpportunity.findMany({ where: { status: 'HOT', projectId: null },
    orderBy: [{ expectedStartDate: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    select: { id: true, externalId: true, name: true, clientName: true, clientCnpj: true, location: true,
      proposalCode: true, revision: true, estimatedValue: true, expectedCloseDate: true, expectedStartDate: true, externalUrl: true, sourceUpdatedAt: true } });
  return rows.map(row => ({ ...row, kind: 'OPPORTUNITY', category: 'FUTURO',
    estimatedValue: row.estimatedValue === null ? null : Number(row.estimatedValue) }));
}
