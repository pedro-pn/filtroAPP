import { normalizeJobRoleKey, markFutureAllocationsForReplanning } from '../collaborators/job-role-service.js';
import { employmentDates, receiptDate } from './schema.js';

const day = value => new Date(`${value}T00:00:00Z`);
export const aggregateWhere = (companyId, aggregateType, externalId) => ({ companyId_aggregateType_externalId: { companyId, aggregateType, externalId } });
const aggregate = (tx, companyId, type, id) => id ? tx.conectaRhAggregate.findUnique({ where: aggregateWhere(companyId, type, id) }) : null;
const person = (tx, companyId, personId) => tx.conectaRhPerson.findUnique({ where: { companyId_personId: { companyId, personId } } });

async function projectJobRole(tx, row) {
  const data = row.data;
  const normalizedKey = normalizeJobRoleKey(data.name);
  const existing = row.localId ? await tx.jobRole.findUnique({ where: { id: row.localId } })
    : await tx.jobRole.findFirst({ where: { OR: [{ normalizedKey }, { name: data.name }] } });
  // Dois IDs externos não podem disputar o mesmo cargo canônico.
  if (existing && await tx.conectaRhAggregate.findFirst({ where: { companyId: row.companyId, aggregateType: 'job_role', localId: existing.id, id: { not: row.id } } })) {
    return { reasonCode: 'JOB_ROLE_MAPPING_CONFLICT' };
  }
  const collision = await tx.jobRole.findFirst({ where: { OR: [{ normalizedKey }, { name: data.name }], ...(existing ? { id: { not: existing.id } } : {}) } });
  if (collision) return { reasonCode: 'JOB_ROLE_MAPPING_CONFLICT' };
  const update = { name: data.name, normalizedKey, isActive: data.isActive, isOperational: data.isOperational };
  const role = existing ? await tx.jobRole.update({ where: { id: existing.id }, data: update }) : await tx.jobRole.create({ data: update });
  return { localId: role.id };
}

async function resolvePerson(tx, row, jobRoleId) {
  const input = row.data;
  const mapped = await person(tx, row.companyId, input.personId);
  if (mapped) return mapped;
  const formattedCpf = input.cpf?.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  const identifiers = [input.cpf && { cpf: { in: [input.cpf, formattedCpf] } }, input.registrationNumber && { registrationNumber: input.registrationNumber }].filter(Boolean);
  const candidates = identifiers.length ? await tx.collaborator.findMany({ where: { OR: identifiers }, take: 3 }) : [];
  if (candidates.length > 1) return null;
  let collaborator = candidates[0];
  if (collaborator?.cpf && input.cpf && collaborator.cpf.replace(/\D/g, '') !== input.cpf) return null;
  if (collaborator && await tx.conectaRhPerson.findUnique({ where: { collaboratorId: collaborator.id } })) return null;
  if (!collaborator) collaborator = await tx.collaborator.create({ data: {
    code: `CONECTA-${input.personId}`, name: input.name, jobRoleId, isActive: false
  } });
  return tx.conectaRhPerson.create({ data: { companyId: row.companyId, personId: input.personId, collaboratorId: collaborator.id } });
}

// Vínculos antigos continuam armazenados, mas não substituem uma recontratação atual.
export function currentEmployment(rows) {
  const priority = row => ['ACTIVE', 'PRE_ADMISSION'].includes(row.data.status) ? 1 : 0;
  return [...rows].sort((a, b) => priority(b) - priority(a)
    || (b.data.admissionDate || receiptDate(b.firstReceivedAt)).localeCompare(a.data.admissionDate || receiptDate(a.firstReceivedAt))
    || b.firstReceivedAt.getTime() - a.firstReceivedAt.getTime()
    || b.externalId.localeCompare(a.externalId))[0];
}

async function projectEmployment(tx, row) {
  const role = await aggregate(tx, row.companyId, 'job_role', row.data.currentJobRoleId);
  const knownPerson = await person(tx, row.companyId, row.data.personId);
  const knownCollaborator = knownPerson && await tx.collaborator.findUnique({ where: { id: knownPerson.collaboratorId } });
  const jobRoleId = role?.localId || (!row.data.currentJobRoleId && knownCollaborator?.jobRoleId);
  if (!jobRoleId) return { reasonCode: 'JOB_ROLE_PENDING' };
  const mapping = knownPerson || await resolvePerson(tx, row, jobRoleId);
  if (!mapping) return { reasonCode: 'PERSON_MAPPING_AMBIGUOUS' };
  const employments = await tx.conectaRhAggregate.findMany({ where: { companyId: row.companyId, aggregateType: 'employment', data: { path: ['personId'], equals: row.data.personId } } });
  const current = currentEmployment(employments);
  if (current.id !== row.id) return { localId: mapping.collaboratorId };
  const dates = employmentDates(row.data, row.firstReceivedAt);
  const previous = await tx.collaborator.findUniqueOrThrow({ where: { id: mapping.collaboratorId } });
  const update = {
    name: row.data.name, email: row.data.email, cpf: row.data.cpf, registrationNumber: row.data.registrationNumber,
    jobRoleId, admissionDate: day(dates.admissionDate), terminationDate: row.data.terminationDate ? day(row.data.terminationDate) : null,
    admissionDateProvisional: dates.admissionDateProvisional, rhFirstReceivedAt: row.firstReceivedAt,
    rhStatus: row.data.status, rhEmploymentId: row.externalId,
    isActive: row.data.isOperational && ['ACTIVE', 'PRE_ADMISSION'].includes(row.data.status)
  };
  await tx.collaborator.update({ where: { id: mapping.collaboratorId }, data: update });
  if (previous.jobRoleId !== jobRoleId) await markFutureAllocationsForReplanning(tx, previous.id, jobRoleId);
  // A pré-admissão já traz cargo; essa referência é substituída pelas ocorrências oficiais.
  const baselineId = `conecta:${row.id}`;
  const hasRoleChange = await tx.conectaRhAggregate.findFirst({ where: {
    companyId: row.companyId, aggregateType: 'role_change', data: { path: ['employmentId'], equals: row.externalId }, status: 'APPLIED', localId: { not: null }
  } });
  if (row.data.status === 'PRE_ADMISSION' && !hasRoleChange) {
    const collision = await tx.collaboratorJobRoleHistory.findUnique({ where: { collaboratorId_effectiveDate: { collaboratorId: mapping.collaboratorId, effectiveDate: day(dates.admissionDate) } } });
    if (!collision || collision.id === baselineId) {
      await tx.collaboratorJobRoleHistory.upsert({ where: { id: baselineId },
        create: { id: baselineId, collaboratorId: mapping.collaboratorId, jobRoleId, effectiveDate: day(dates.admissionDate), note: 'Referência de pré-admissão Conecta.' },
        update: { jobRoleId, effectiveDate: day(dates.admissionDate) } });
    }
  } else await tx.collaboratorJobRoleHistory.deleteMany({ where: { id: baselineId } });
  // Alterar admissão republica a vigência derivada, inclusive após ativação do mesmo vínculo.
  await tx.conectaRhAggregate.updateMany({ where: { companyId: row.companyId, aggregateType: 'role_change', data: { path: ['employmentId'], equals: row.externalId } }, data: { status: 'PENDING' } });
  return { localId: mapping.collaboratorId };
}

async function superseded(tx, row) {
  const candidates = await tx.conectaRhAggregate.findMany({ where: { companyId: row.companyId, aggregateType: row.aggregateType,
    data: { path: ['supersedesId'], equals: row.externalId }, status: 'APPLIED', id: { not: row.id } } });
  return candidates.some(candidate => row.aggregateType === 'role_change'
    ? candidate.data.personId === row.data.personId && candidate.data.employmentId === row.data.employmentId
    : candidate.data.jobRoleId === row.data.jobRoleId);
}

async function syncCurrentRole(tx, collaboratorId) {
  const collaborator = await tx.collaborator.findUniqueOrThrow({ where: { id: collaboratorId } });
  const latest = await tx.collaboratorJobRoleHistory.findFirst({ where: { collaboratorId, effectiveDate: {
    ...(collaborator.admissionDate ? { gte: collaborator.admissionDate } : {}),
    ...(collaborator.rhStatus === 'PRE_ADMISSION' ? {} : { lte: day(receiptDate(new Date())) }) } },
    orderBy: [{ effectiveDate: 'desc' }, { id: 'desc' }] });
  let jobRoleId = latest?.jobRoleId;
  if (!jobRoleId) {
    const employment = await tx.conectaRhAggregate.findFirst({ where: { aggregateType: 'employment', externalId: collaborator.rhEmploymentId, localId: collaboratorId } });
    const fallback = employment && await aggregate(tx, employment.companyId, 'job_role', employment.data.currentJobRoleId);
    jobRoleId = fallback?.localId;
  }
  if (jobRoleId && jobRoleId !== collaborator.jobRoleId) {
    await tx.collaborator.update({ where: { id: collaboratorId }, data: { jobRoleId } });
    await markFutureAllocationsForReplanning(tx, collaboratorId, jobRoleId);
  }
}

async function projectRoleChange(tx, row) {
  const input = row.data;
  const employment = await aggregate(tx, row.companyId, 'employment', input.employmentId);
  const role = await aggregate(tx, row.companyId, 'job_role', input.jobRoleId);
  if (!employment?.localId || !role?.localId) return { reasonCode: 'DEPENDENCY_PENDING' };
  if (employment.data.personId !== input.personId) return { status: 'FAILED', reasonCode: 'PERSON_EMPLOYMENT_MISMATCH' };
  const previous = input.supersedesId && await aggregate(tx, row.companyId, 'role_change', input.supersedesId);
  if (input.supersedesId && !previous) return { reasonCode: 'SUPERSEDES_PENDING' };
  if (previous && (previous.data.personId !== input.personId || previous.data.employmentId !== input.employmentId)) {
    return { status: 'FAILED', reasonCode: 'SUPERSEDES_MISMATCH' };
  }
  const cancelled = input.status === 'CANCELLED' || await superseded(tx, row);
  if (cancelled) {
    if (row.localId) await tx.collaboratorJobRoleHistory.deleteMany({ where: { id: row.localId } });
    const collaborator = await tx.collaborator.findUniqueOrThrow({ where: { id: employment.localId } });
    if (collaborator.rhEmploymentId === employment.externalId) await syncCurrentRole(tx, employment.localId);
    return { localId: null };
  }
  const reference = employmentDates(employment.data, employment.firstReceivedAt).admissionDate;
  // Uma ocorrência criada sem data acompanha a data oficial do vínculo quando ela chegar.
  const effectiveDate = input.effectiveDate || reference;
  if (effectiveDate > receiptDate(new Date()) && employment.data.status !== 'PRE_ADMISSION') return { reasonCode: 'FUTURE_ROLE_CHANGE' };
  const baselineId = `conecta:${employment.id}`;
  const id = row.localId || `conecta:${row.id}`;
  const collision = await tx.collaboratorJobRoleHistory.findUnique({ where: { collaboratorId_effectiveDate: { collaboratorId: employment.localId, effectiveDate: day(effectiveDate) } } });
  if (collision && ![id, baselineId, previous?.localId].includes(collision.id)) return { reasonCode: 'ROLE_HISTORY_CONFLICT' };
  await tx.collaboratorJobRoleHistory.deleteMany({ where: { id: baselineId } });
  if (previous?.localId) await tx.collaboratorJobRoleHistory.deleteMany({ where: { id: previous.localId } });
  await tx.collaboratorJobRoleHistory.upsert({ where: { id },
    create: { id, collaboratorId: employment.localId, jobRoleId: role.localId, effectiveDate: day(effectiveDate), note: 'Integração Conecta.' },
    update: { jobRoleId: role.localId, effectiveDate: day(effectiveDate) } });
  const collaborator = await tx.collaborator.findUniqueOrThrow({ where: { id: employment.localId } });
  if (collaborator.rhEmploymentId === employment.externalId) await syncCurrentRole(tx, employment.localId);
  return { localId: id };
}

async function projectSalary(tx, row) {
  const input = row.data;
  const role = await aggregate(tx, row.companyId, 'job_role', input.jobRoleId);
  if (!role?.localId) return { reasonCode: 'JOB_ROLE_PENDING' };
  const previousOccurrence = input.supersedesId && await aggregate(tx, row.companyId, 'job_role_salary', input.supersedesId);
  if (input.supersedesId && !previousOccurrence) return { reasonCode: 'SUPERSEDES_PENDING' };
  if (previousOccurrence && previousOccurrence.data.jobRoleId !== input.jobRoleId) return { status: 'FAILED', reasonCode: 'SUPERSEDES_MISMATCH' };
  if (input.status === 'CANCELLED' || await superseded(tx, row)) {
    if (row.localId) await tx.costParameterSet.deleteMany({ where: { id: row.localId } });
    return { localId: null };
  }
  if (previousOccurrence?.localId) await tx.costParameterSet.deleteMany({ where: { id: previousOccurrence.localId } });
  const profile = await tx.costProfile.upsert({ where: { jobRoleId: role.localId },
    create: { key: `role:${role.localId}`, label: role.data.name, jobRoleId: role.localId }, update: {} });
  const previous = await tx.costParameterSet.findFirst({ where: { costProfileId: profile.id, effectiveDate: { lte: day(input.effectiveDate) } }, orderBy: [{ effectiveDate: 'desc' }, { version: 'desc' }] });
  const latest = await tx.costParameterSet.aggregate({ where: { costProfileId: profile.id }, _max: { version: true } });
  const data = { effectiveDate: day(input.effectiveDate), version: (latest._max.version || 0) + 1,
    params: { ...(previous?.params || {}), salarioBase: input.amount }, note: 'Salário-base por cargo recebido do Conecta.' };
  const saved = await tx.costParameterSet.upsert({ where: { id: row.localId || `conecta:${row.id}` },
    create: { id: `conecta:${row.id}`, costProfileId: profile.id, ...data }, update: data });
  return { localId: saved.id };
}

export async function projectConectaAggregate(tx, row) {
  if (row.aggregateType === 'job_role') return projectJobRole(tx, row);
  if (row.aggregateType === 'employment') return projectEmployment(tx, row);
  if (row.aggregateType === 'role_change') return projectRoleChange(tx, row);
  if (row.aggregateType === 'job_role_salary') return projectSalary(tx, row);
  const mapping = await person(tx, row.companyId, row.data.personId);
  return mapping ? { localId: mapping.collaboratorId } : { reasonCode: 'PERSON_PENDING' };
}
