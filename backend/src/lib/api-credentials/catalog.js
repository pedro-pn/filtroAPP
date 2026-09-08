import { API_DATA_DOMAINS, futureScopeDefinitions } from './data-catalog.js';
import { OPERATIONAL_RESOURCES } from './operational-resources.js';
import { OPERATIONAL_DOWNLOADS } from './extended-operational-resources.js';
import { describePlaygroundParameters } from './playground-parameters.js';

export const API_CATALOG_VERSION = '2026-09-08';
export { API_DATA_DOMAINS, DATA_CATALOG_VERSION, flattenDataCatalogModels, futureScopeDefinitions } from './data-catalog.js';

const QUALITY_RECORD_FIELDS = ['id', 'number', 'type', 'registeredAt', 'origin', 'project', 'eventDate', 'nature', 'description', 'impact', 'recurrence', 'linkedRnc', 'disposition', 'definedAction', 'actionOwner', 'actionDeadline', 'evidenceSummary', 'resultVerification', 'status', 'createdAt', 'updatedAt'];
const QUALITY_SCOPE_FIELDS = {
  'qualidade.registros.read': QUALITY_RECORD_FIELDS,
  'qualidade.naturezas.read': ['id', 'name', 'isActive', 'position', 'createdAt', 'updatedAt'],
  'qualidade.evidencias.metadata.read': ['id', 'kind', 'label', 'fileName', 'mimeType', 'position', 'createdAt', 'downloadAvailable'],
  'qualidade.evidencias.download': ['arquivo original'],
  'qualidade.excluidos.read': [...QUALITY_RECORD_FIELDS, 'deletedAt']
};

export const API_SCOPES = Object.freeze([
  { code: 'qualidade.registros.read', domain: 'Qualidade', label: 'Ler registros', description: 'Consulta registros de qualidade permitidos.', sensitivity: 'INTERNAL', status: 'AVAILABLE', dependencies: [] },
  { code: 'qualidade.naturezas.read', domain: 'Qualidade', label: 'Ler naturezas', description: 'Consulta o catálogo de naturezas de qualidade.', sensitivity: 'INTERNAL', status: 'AVAILABLE', dependencies: [] },
  { code: 'qualidade.evidencias.metadata.read', domain: 'Qualidade', label: 'Ler metadados de evidências', description: 'Inclui metadados allowlisted das evidências.', sensitivity: 'PERSONAL', status: 'AVAILABLE', dependencies: ['qualidade.registros.read'] },
  { code: 'qualidade.evidencias.download', domain: 'Qualidade', label: 'Baixar evidências', description: 'Permite download autenticado de evidências.', sensitivity: 'PERSONAL', status: 'AVAILABLE', dependencies: ['qualidade.registros.read', 'qualidade.evidencias.metadata.read'] },
  { code: 'qualidade.excluidos.read', domain: 'Qualidade', label: 'Ler excluídos', description: 'Inclui tombstones e registros excluídos.', sensitivity: 'PERSONAL', status: 'AVAILABLE', dependencies: ['qualidade.registros.read'] },
  ...[...new Set(OPERATIONAL_RESOURCES.map(item => item.scope))].map(code => {
    const resources = OPERATIONAL_RESOURCES.filter(item => item.scope === code);
    const domain = API_DATA_DOMAINS.find(item => item.code === resources[0].domainCode);
    return {
      code, label: resources[0].label, domain: domain.label, sensitivity: resources[0].sensitivity || 'INTERNAL',
      status: 'AVAILABLE', dependencies: resources[0].dependencies, description: resources[0].projectNotice,
      models: resources.map(item => item.model), exposedFields: [...new Set(resources.flatMap(item => Object.keys(item.fields)))],
      excludedFields: [...domain.excludedFields, 'campos JSON livres', 'observações livres', 'campos não listados no contrato']
    };
  }),
  ...OPERATIONAL_DOWNLOADS.map(item => ({ code: item.scope, domain: API_DATA_DOMAINS.find(domain => domain.code === item.domainCode).label,
    label: item.label, sensitivity: 'PERSONAL', status: 'AVAILABLE', dependencies: item.dependencies,
    description: `${item.metadata.projectNotice} Download autenticado do arquivo original (até 50 MiB), que pode conter dados pessoais ou financeiros.`,
    models: [item.model], exposedFields: ['arquivo original'], excludedFields: ['caminhos internos', 'tokens de armazenamento'] }))
].map(scope => QUALITY_SCOPE_FIELDS[scope.code] ? { ...scope, exposedFields: QUALITY_SCOPE_FIELDS[scope.code] } : scope));

export const API_OPERATIONS = Object.freeze([
  {
    operationId: 'quality.records.list', openApiOperationId: 'qualityRecordsList', method: 'GET', path: '/qualidade/registros',
    requiredScopes: ['qualidade.registros.read'],
    optionalScopes: ['qualidade.evidencias.metadata.read', 'qualidade.excluidos.read'],
    queryParams: ['limit', 'cursor', 'updatedSince', 'updatedUntil', 'snapshotAt', 'projectId', 'natureId', 'eventDateFrom', 'eventDateTo', 'status', 'type', 'includeDeleted'],
    supportsPlayground: true
  },
  {
    operationId: 'quality.records.get', openApiOperationId: 'qualityRecordGet', method: 'GET', path: '/qualidade/registros/:id',
    requiredScopes: ['qualidade.registros.read'], optionalScopes: ['qualidade.evidencias.metadata.read', 'qualidade.excluidos.read'],
    pathParams: ['id'], queryParams: ['includeDeleted'], supportsPlayground: true
  },
  {
    operationId: 'quality.natures.list', openApiOperationId: 'qualityNaturesList', method: 'GET', path: '/qualidade/naturezas',
    requiredScopes: ['qualidade.naturezas.read'], optionalScopes: [], queryParams: ['limit', 'cursor', 'updatedSince', 'snapshotAt', 'active'], supportsPlayground: true
  },
  {
    operationId: 'quality.evidence.download', openApiOperationId: 'qualityEvidenceDownload', method: 'GET', path: '/qualidade/evidencias/:id/download',
    requiredScopes: ['qualidade.registros.read', 'qualidade.evidencias.metadata.read', 'qualidade.evidencias.download'],
    label: 'Verificar download de evidência de Qualidade',
    optionalScopes: [], pathParams: ['id'], queryParams: [], supportsPlayground: true, responseKind: 'DOWNLOAD_CHECK'
  },
  ...OPERATIONAL_RESOURCES.map(resource => ({
    operationId: resource.operationId, openApiOperationId: resource.openApiOperationId,
    label: resource.label, method: 'GET', path: resource.path,
    requiredScopes: resource.requiredScopes, optionalScopes: [], queryParams: resource.queryParams,
    pathParams: [], supportsPlayground: true
  })),
  ...OPERATIONAL_DOWNLOADS.map(item => ({ operationId: item.operationId, openApiOperationId: item.openApiOperationId,
    label: item.label, method: 'GET', path: item.path, requiredScopes: item.requiredScopes,
    optionalScopes: [], queryParams: [], pathParams: ['id'], supportsPlayground: true, responseKind: 'DOWNLOAD_CHECK' }))
]);

export function publicApiOperations() {
  return API_OPERATIONS.filter(operation => operation.supportsPlayground).map(operation => ({
    operationId: operation.operationId, label: operation.label || ({
      'quality.records.list': 'Listar registros de Qualidade',
      'quality.records.get': 'Consultar um registro de Qualidade',
      'quality.natures.list': 'Listar naturezas de Qualidade'
    })[operation.operationId], method: operation.method, path: operation.path,
    requiredScopes: operation.requiredScopes, optionalScopes: operation.optionalScopes,
    domain: API_SCOPES.find(scope => scope.code === operation.requiredScopes[0])?.domain || 'Integrações',
    responseKind: operation.responseKind || 'JSON', parameters: describePlaygroundParameters(operation),
    queryParams: operation.queryParams, pathParams: operation.pathParams || []
  }));
}

export function getApiScope(code) {
  return API_SCOPES.find(scope => scope.code === code) || null;
}

export function getApiOperation(operationId) {
  return API_OPERATIONS.find(operation => operation.operationId === operationId) || null;
}

export function assertApiCatalogIntegrity() {
  const scopeCodes = new Set(API_SCOPES.map(scope => scope.code));
  const futureScopes = futureScopeDefinitions();
  const futureCodes = new Set(futureScopes.map(scope => scope.code));
  if (scopeCodes.size !== API_SCOPES.length) throw new Error('Catálogo contém escopos duplicados.');
  if (futureCodes.size !== futureScopes.length) throw new Error('Catálogo contém escopos futuros duplicados.');
  if ([...futureCodes].some(code => scopeCodes.has(code))) throw new Error('Escopo futuro não pode estar concedível.');
  const operationIds = new Set(API_OPERATIONS.map(operation => operation.operationId));
  if (operationIds.size !== API_OPERATIONS.length) throw new Error('Catálogo contém operações duplicadas.');
  for (const scope of API_SCOPES) {
    for (const dependency of scope.dependencies) {
      if (!scopeCodes.has(dependency)) throw new Error(`Dependência de escopo desconhecida: ${dependency}.`);
    }
  }
  for (const operation of API_OPERATIONS) {
    describePlaygroundParameters(operation);
    for (const scope of [...operation.requiredScopes, ...operation.optionalScopes]) {
      if (!scopeCodes.has(scope)) throw new Error(`Operação ${operation.operationId} usa escopo desconhecido: ${scope}.`);
    }
  }
  for (const scope of API_SCOPES) {
    if (!API_OPERATIONS.some(operation => [...operation.requiredScopes, ...operation.optionalScopes].includes(scope.code))) {
      throw new Error(`Escopo disponível sem operação: ${scope.code}.`);
    }
  }
  if (API_DATA_DOMAINS.some(domain => domain.code !== 'quality' && domain.models.some(model => model.availability === 'AVAILABLE' && !OPERATIONAL_RESOURCES.some(resource => resource.model === model.model)))) {
    throw new Error('Modelo disponível sem contrato operacional.');
  }
  return true;
}

assertApiCatalogIntegrity();
