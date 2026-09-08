export const publishedReport = { status: 'APPROVED', deletedAt: null, project: { deletedAt: null } };
export const publishedMaintenance = { status: 'APPROVED', OR: [{ reportId: null }, { report: publishedReport }] };

// Projeções explícitas; nunca converter automaticamente o schema Prisma em API.
export function resource(model, path, scope, label, domainCode, fields, options = {}) {
  const timestampField = options.timestampField === undefined ? 'updatedAt' : options.timestampField;
  const common = timestampField === 'updatedAt' ? { id: 'string', createdAt: 'datetime', updatedAt: 'datetime' }
    : timestampField === 'createdAt' ? { id: 'string', createdAt: 'datetime' } : {};
  const definition = {
    model, delegate: model[0].toLowerCase() + model.slice(1), path, scope, label, domainCode,
    operationId: `operational.${model}.list`, openApiOperationId: `listIntegration${model}`,
    fields: Object.freeze({ ...common, ...fields }),
    projectPolicy: 'GLOBAL', projectNotice: 'Cadastro global compartilhado; não é limitado por projeto.',
    where: {}, dependencies: [], filterFields: [], keyFields: ['id'], ...options, timestampField
  };
  definition.requiredScopes = [...new Set([...definition.dependencies, scope])];
  definition.queryParams = ['limit', 'cursor', ...(timestampField ? [timestampField === 'updatedAt' ? 'updatedSince' : 'createdSince'] : []), 'snapshotAt',
    ...(definition.projectPolicy !== 'GLOBAL' ? ['projectId'] : []), ...definition.filterFields,
    ...(definition.fields.isActive ? ['active'] : [])];
  definition.select = Object.freeze(Object.fromEntries(Object.keys(definition.fields).map(field => [field, true])));
  return Object.freeze(definition);
}
