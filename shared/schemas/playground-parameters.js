// Formulário dirigido exclusivamente pelos descritores publicados pelo servidor.
export function makePlaygroundParameterSchema(z, parameters, { maxPageSize = 20, scopes = [] } = {}) {
  const shape = {};
  for (const field of parameters) {
    let schema;
    if (field.type === 'integer') schema = z.coerce.number().int('Informe um número inteiro.').min(field.min || 1, 'Informe ao menos 1 item.').max(Math.min(field.max || 20, maxPageSize), `O token permite até ${Math.min(field.max || 20, maxPageSize)} itens por teste.`);
    else if (field.type === 'boolean') schema = z.union([z.boolean(), z.enum(['true', 'false'])]).refine(value => !field.requiredScope || ![true, 'true'].includes(value) || scopes.includes(field.requiredScope), 'O token não possui a permissão necessária.');
    else {
      schema = z.string({ error: 'Informe este campo.' }).trim().min(1, 'Informe este campo.').max(field.maxLength || 500, 'Valor muito longo.');
      if (field.type === 'datetime') schema = schema.refine(value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && Number.isFinite(new Date(value).getTime()), 'Informe uma data e hora válidas.');
      if (field.type === 'date') schema = schema.refine(value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value, 'Informe uma data válida.');
      if (field.type === 'enum-list') schema = schema.refine(value => value.split(',').every(item => field.options.includes(item.trim())), 'Escolha somente códigos da lista.');
    }
    shape[field.name] = z.preprocess(value => value === '' || value === undefined || (typeof value === 'string' && !value.trim()) ? undefined : value,
      field.required ? schema : schema.optional());
  }
  return z.object(shape).strict();
}

export function playgroundParameterDefaults(operation, maxPageSize = 20, scopeCode = '', grantedScopes = []) {
  return {
    ...(operation?.queryParams.includes('limit') ? { limit: String(Math.min(10, maxPageSize)) } : {}),
    ...(operation?.queryParams.includes('includeDeleted') && scopeCode === 'qualidade.excluidos.read' && grantedScopes.includes(scopeCode) ? { includeDeleted: 'true' } : {})
  };
}

export function buildPlaygroundInput(operation, values) {
  const query = {}, pathParams = {};
  for (const field of operation.parameters) {
    const value = values[field.name];
    if (value === undefined || value === null || value === '') continue;
    const normalized = typeof value === 'string' ? value.trim() : value;
    if (normalized === '') continue;
    if (field.in === 'path') pathParams[field.name] = String(normalized);
    else query[field.name] = field.type === 'datetime' ? new Date(normalized).toISOString()
      : field.type === 'integer' ? Number(normalized)
        : field.type === 'boolean' ? normalized === true || normalized === 'true'
          : field.type === 'enum-list' ? String(normalized).split(',').map(item => item.trim()) : normalized;
  }
  return { operationId: operation.operationId, pathParams, query };
}
