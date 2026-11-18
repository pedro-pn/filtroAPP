// A single participation policy for selectors, writes and external APIs.
// Employment status (active/pre-admission/terminated) is handled by each module.
import { workforceVisibilityClasses, workforceVisibilityTargetLabel } from './workforce-visibility-context.js';
export const WORKFORCE_CLASSIFICATIONS = ['OPERATIONAL', 'NON_OPERATIONAL', 'PENDING'];

export function roleClassification(role) {
  return role?.workforceClassification
    || (role?.isOperational === true ? 'OPERATIONAL' : role?.isOperational === false ? 'NON_OPERATIONAL' : 'PENDING');
}

export function workforceClassification(collaborator) {
  return collaborator?.workforceClassificationOverride || roleClassification(collaborator?.jobRole);
}

export function isOperationalCollaborator(collaborator) {
  return workforceClassification(collaborator) === 'OPERATIONAL';
}

export function operationalJobRoleWhere() {
  return { OR: [
    { workforceClassification: 'OPERATIONAL' },
    { workforceClassification: null, isOperational: true },
    { collaborators: { some: { workforceClassificationOverride: 'OPERATIONAL' } } }
  ] };
}

export function operationalDefaultJobRoleWhere() {
  return { OR: [
    { workforceClassification: 'OPERATIONAL' },
    { workforceClassification: null, isOperational: true }
  ] };
}

export function operationalCollaboratorWhere() {
  return { OR: [
    { workforceClassificationOverride: 'OPERATIONAL' },
    { workforceClassificationOverride: null, jobRole: { OR: [
      { workforceClassification: 'OPERATIONAL' },
      { workforceClassification: null, isOperational: true }
    ] } }
  ] };
}

export function classificationWhere(classification) {
  return { OR: [
    { workforceClassificationOverride: classification },
    { workforceClassificationOverride: null, jobRole: { OR: [
      { workforceClassification: classification },
      ...(classification === 'PENDING' ? [] : [{ workforceClassification: null, isOperational: classification === 'OPERATIONAL' }])
    ] } }
  ] };
}

export function workforcePolicyError(ids = []) {
  return Object.assign(new Error('Colaborador não operacional ou aguardando classificação. Revise em Administração → Colaboradores e classificação.'), {
    status: 409, statusCode: 409, code: 'COLLABORATOR_NOT_OPERATIONAL', collaboratorIds: ids
  });
}

export async function requireOperationalCollaborators(database, ids, { preservedIds = [] } = {}) {
  const unique = [...new Set(ids.filter(Boolean))].filter(id => !preservedIds.includes(id));
  if (!unique.length) return;
  const allowed = await database.collaborator.findMany({
    where: { AND: [{ id: { in: unique } }, operationalCollaboratorWhere()] }, select: { id: true }
  });
  const found = new Set(allowed.map(item => item.id));
  const blocked = unique.filter(id => !found.has(id));
  if (blocked.length) throw workforcePolicyError(blocked);
}

export function workforcePolicySummary(collaborator) {
  const classification = workforceClassification(collaborator);
  return {
    classification,
    classificationSource: collaborator.workforceClassificationOverride ? 'COLLABORATOR' : 'JOB_ROLE',
    classificationDiverges: typeof collaborator.sourceIsOperational === 'boolean'
      && classification !== 'PENDING' && collaborator.sourceIsOperational !== (classification === 'OPERATIONAL')
  };
}

export function isCollaboratorVisible(collaborator, target) {
  return workforceVisibilityClasses(target).includes(workforceClassification(collaborator));
}

export function collaboratorVisibilityWhere(target) {
  const allowed = workforceVisibilityClasses(target);
  if (!allowed.length) return { id: { in: [] } };
  if (allowed.length === WORKFORCE_CLASSIFICATIONS.length) return {};
  if (allowed.length === 1) return classificationWhere(allowed[0]);
  return { OR: allowed.map(classificationWhere) };
}

function visibleDefaultRoleConditions(target) {
  return workforceVisibilityClasses(target).flatMap(value => [
    { workforceClassification: value },
    ...(value === 'PENDING' ? [] : [{ workforceClassification: null, isOperational: value === 'OPERATIONAL' }])
  ]);
}

export function defaultJobRoleVisibilityWhere(target) {
  if (!workforceVisibilityClasses(target).length) return { id: { in: [] } };
  return { OR: visibleDefaultRoleConditions(target) };
}

export function jobRoleVisibilityWhere(target) {
  const allowed = workforceVisibilityClasses(target);
  if (!allowed.length) return { id: { in: [] } };
  return { OR: [
    ...visibleDefaultRoleConditions(target),
    { collaborators: { some: { workforceClassificationOverride: allowed.length === 1 ? allowed[0] : { in: allowed } } } }
  ] };
}

export function workforceVisibilityError(ids = [], target) {
  return Object.assign(new Error(`A classificação do colaborador não está habilitada em ${workforceVisibilityTargetLabel(target)}. Revise as regras em Administração → Colaboradores e classificação.`), {
    status: 409, statusCode: 409, code: 'COLLABORATOR_NOT_VISIBLE', collaboratorIds: ids
  });
}

export async function requireVisibleCollaborators(database, ids, { preservedIds = [], target } = {}) {
  const unique = [...new Set(ids.filter(Boolean))].filter(id => !preservedIds.includes(id));
  if (!unique.length) return;
  const allowed = await database.collaborator.findMany({
    where: { AND: [{ id: { in: unique } }, collaboratorVisibilityWhere(target)] }, select: { id: true }
  });
  const found = new Set(allowed.map(item => item.id));
  const blocked = unique.filter(id => !found.has(id));
  if (blocked.length) throw workforceVisibilityError(blocked, target);
}
