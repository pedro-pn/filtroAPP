export class EfetivoPlanningError extends Error {
  constructor(message, { statusCode = 400, code = 'EFETIVO_PLANNING_ERROR', conflicts = [], issues = [] } = {}) {
    super(message);
    this.name = 'EfetivoPlanningError';
    this.statusCode = statusCode;
    this.code = code;
    this.conflicts = conflicts;
    this.issues = issues;
  }
}

export function planningError(message, options) {
  return new EfetivoPlanningError(message, options);
}

export function notFound(message = 'Registro de planejamento não encontrado.') {
  return planningError(message, { statusCode: 404, code: 'NOT_FOUND' });
}

export function conflictError(message, conflicts = [], code = 'PLANNING_CONFLICT') {
  return planningError(message, { statusCode: 409, code, conflicts });
}

export function conflictDescriptor({
  collaborator,
  startDate,
  endDate,
  sourceType,
  sourceId,
  entityPath,
  code = 'OVERLAP'
}) {
  return {
    code,
    collaboratorId: collaborator?.id || null,
    collaboratorName: collaborator?.name || 'Colaborador',
    startDate,
    endDate,
    sourceType,
    sourceId,
    entityPath: entityPath || null
  };
}
