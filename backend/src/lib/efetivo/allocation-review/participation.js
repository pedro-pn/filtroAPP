import { z } from 'zod';
import { isOperationalCollaborator, operationalCollaboratorWhere } from '../../collaborators/workforce-policy.js';
import { clearCollaboratorDerivedCaches } from '../../resource-list-cache.js';
import { recordEfetivoAudit } from '../planning/audit.js';

export const participationInputSchema = z.object({
  allocationReviewEnabled: z.boolean(),
  version: z.number().int().positive()
}).strict();

const SELECT = {
  id: true, code: true, name: true, isActive: true, rhStatus: true,
  workforceClassificationOverride: true, allocationReviewEnabled: true, classificationVersion: true,
  jobRole: { select: { name: true, isOperational: true, workforceClassification: true } }
};

function publicParticipant(person) {
  return {
    id: person.id, code: person.code, name: person.name, jobRole: person.jobRole.name,
    isActive: person.isActive, rhStatus: person.rhStatus,
    allocationReviewEnabled: person.allocationReviewEnabled === true,
    version: person.classificationVersion
  };
}

function conflict() {
  return Object.assign(new Error('O colaborador foi alterado por outra pessoa. A lista foi atualizada; tente novamente.'), {
    status: 409, code: 'PARTICIPATION_VERSION_CONFLICT'
  });
}

export async function listReviewParticipants(database) {
  const people = await database.collaborator.findMany({
    where: operationalCollaboratorWhere(), select: SELECT, orderBy: [{ name: 'asc' }, { id: 'asc' }]
  });
  return people.map(publicParticipant);
}

export async function updateReviewParticipation(database, id, input, { actorUserId = null, evidence = {} } = {}) {
  const payload = participationInputSchema.parse(input);
  const result = await database.$transaction(async tx => {
    const person = await tx.collaborator.findUnique({ where: { id }, select: SELECT });
    if (!person) throw Object.assign(new Error('Colaborador não encontrado.'), { status: 404 });
    if (!isOperationalCollaborator(person)) throw Object.assign(new Error('Somente colaboradores operacionais podem participar da conferência.'), {
      status: 409, code: 'COLLABORATOR_NOT_OPERATIONAL'
    });
    if (person.classificationVersion !== payload.version) throw conflict();
    if (person.allocationReviewEnabled === payload.allocationReviewEnabled) return publicParticipant(person);
    const changed = await tx.collaborator.updateMany({
      where: { id, classificationVersion: payload.version, AND: [operationalCollaboratorWhere()] },
      data: { allocationReviewEnabled: payload.allocationReviewEnabled, classificationVersion: { increment: 1 } }
    });
    if (changed.count !== 1) throw conflict();
    await recordEfetivoAudit(tx, {
      actorUserId, evidence, action: 'UPDATE', entityType: 'COLLABORATOR', entityId: id,
      summary: `${payload.allocationReviewEnabled ? 'Incluiu' : 'Retirou'} ${person.name} ${payload.allocationReviewEnabled ? 'na' : 'da'} conferência de alocação.`,
      beforeData: { allocationReviewEnabled: person.allocationReviewEnabled },
      afterData: { allocationReviewEnabled: payload.allocationReviewEnabled }
    });
    return publicParticipant({ ...person, allocationReviewEnabled: payload.allocationReviewEnabled, classificationVersion: payload.version + 1 });
  });
  clearCollaboratorDerivedCaches();
  return result;
}
