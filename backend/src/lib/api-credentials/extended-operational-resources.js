import { resource, publishedReport, publishedMaintenance } from './operational-resource-definition.js';

const report = { dependencies: ['rdo.relatorios.read'], filterFields: ['reportId'], projectPolicy: 'REPORT', where: { report: publishedReport }, projectNotice: 'Somente relatórios aprovados e projetos autorizados não excluídos.' };
const maintenance = { dependencies: ['manutencao.registros.read'], filterFields: ['maintenanceId'], projectPolicy: 'MAINTENANCE', where: { maintenance: publishedMaintenance }, projectNotice: 'Somente manutenções aprovadas; avulsas exigem todos os projetos.' };
const stock = { dependencies: ['estoque.itens.read'], filterFields: ['itemId'], timestampField: 'createdAt' };
const movement = { ...stock, projectPolicy: 'DIRECT', where: { OR: [{ projectId: null }, { project: { deletedAt: null } }] }, projectNotice: 'Somente movimentos de projetos autorizados não excluídos; sem projeto exige todos os projetos.' };
const movementFields = { itemId: 'string', batchId: 'string', projectId: 'string?', type: 'string', reason: 'string', quantity: 'decimal', date: 'datetime', reversalOfId: 'string?' };

// Um anexo pode ter dois pais. Cada pai presente precisa ser publicado/autorizado.
export function reportAttachmentWhere(reportWhere) {
  return { AND: [
    { OR: [{ report: reportWhere }, { reportService: { report: reportWhere } }] },
    { OR: [{ reportId: null }, { report: reportWhere }] },
    { OR: [{ reportServiceId: null }, { reportService: { report: reportWhere } }] }
  ] };
}

export const EXTENDED_OPERATIONAL_RESOURCES = Object.freeze([
  resource('ReportVersion', '/rdo/versoes', 'rdo.versoes.read', 'Versões dos relatórios — metadados', 'rdo',
    { reportId: 'string', versionNumber: 'integer', status: 'string' }, { ...report, timestampField: 'createdAt', where: { report: publishedReport, status: { not: 'DRAFT' } } }),
  resource('ReportCollaborator', '/rdo/equipe', 'rdo.equipe.read', 'Equipes dos relatórios — IDs e cargos', 'rdo',
    { reportId: 'string', collaboratorId: 'string', jobRoleIdSnapshot: 'string?', roleNameSnapshot: 'string?' }, { ...report, timestampField: null, keyFields: ['reportId', 'collaboratorId'], projectNotice: `${report.projectNotice} Sem filtro incremental: reconciliar a equipe por leitura completa.` }),
  resource('ReportService', '/rdo/servicos', 'rdo.servicos.read', 'Serviços dos relatórios', 'rdo',
    { reportId: 'string', serviceType: 'string', equipmentId: 'string?', system: 'string?', material: 'string?', startTime: 'string?', endTime: 'string?', finalized: 'boolean?' }, report),
  resource('ReportAttachment', '/rdo/anexos', 'rdo.anexos.metadata.read', 'Anexos dos relatórios — metadados', 'rdo',
    { reportId: 'string?', reportServiceId: 'string?', label: 'string', fileName: 'string', mimeType: 'string' }, { ...report, timestampField: 'createdAt', projectPolicy: 'REPORT_ATTACHMENT', where: reportAttachmentWhere(publishedReport) }),
  resource('ReportSignature', '/rdo/assinaturas', 'rdo.assinaturas.read', 'Assinaturas — situação e datas, sem identidade ou provas', 'rdo',
    { reportId: 'string', versionId: 'string', signerRole: 'string', signatureType: 'string', status: 'string', isRequired: 'boolean', signedAt: 'datetime?', rejectedAt: 'datetime?', invalidatedAt: 'datetime?' },
    { ...report, sensitivity: 'PERSONAL', where: { report: publishedReport, version: { status: { not: 'DRAFT' }, report: publishedReport } } }),
  resource('ReportAuditLog', '/rdo/auditoria', 'rdo.auditoria.read', 'Auditoria de relatórios — ações, sem identificação do ator', 'rdo',
    { reportId: 'string', versionId: 'string?', action: 'string' }, { ...report, timestampField: 'createdAt', where: { report: publishedReport, OR: [{ versionId: null }, { version: { status: { not: 'DRAFT' }, report: publishedReport } }] } }),
  resource('StockBatch', '/estoque/lotes', 'estoque.lotes.read', 'Lotes de estoque — validade', 'stock',
    { itemId: 'string', lotNumber: 'string', expiryDate: 'datetime?' }, { ...stock, projectPolicy: 'STOCK_BATCH', projectNotice: 'Com projetos selecionados, somente lotes com movimento nesses projetos. Não representa saldo por projeto.' }),
  resource('StockMovement', '/estoque/movimentos', 'estoque.movimentos.read', 'Movimentações de estoque — sem custos', 'stock', movementFields, movement),
  resource('StockItemDocument', '/estoque/documentos', 'estoque.documentos.metadata.read', 'Documentos técnicos de estoque — metadados globais', 'stock',
    { itemId: 'string', fileName: 'string', mimeType: 'string' }, stock),
  resource('StockMovement', '/estoque/custos', 'estoque.custos.read', 'Custos do estoque — dados financeiros', 'stock',
    { ...movementFields, unitCost: 'decimal?', excludeFromProjectCost: 'boolean' }, { ...movement, dependencies: ['estoque.itens.read', 'estoque.movimentos.read'], sensitivity: 'FINANCIAL', operationId: 'operational.StockMovementCosts.list', openApiOperationId: 'listIntegrationStockMovementCosts', projectNotice: `${movement.projectNotice} Inclui valores financeiros; permissão independente da leitura operacional.` }),
  resource('MaintenanceThirdPartyService', '/manutencao/terceiros', 'manutencao.terceiros.read', 'Serviços de terceiros em manutenção', 'maintenance-production',
    { maintenanceId: 'string', serviceDate: 'datetime', location: 'string', description: 'string', order: 'integer' }, maintenance),
  resource('MaintenanceAttachment', '/manutencao/anexos', 'manutencao.anexos.metadata.read', 'Anexos de manutenção — metadados', 'maintenance-production',
    { maintenanceId: 'string', kind: 'string', fileName: 'string', mimeType: 'string' }, { ...maintenance, timestampField: 'createdAt' }),
  resource('OperationalReviewAudit', '/manutencao/auditoria', 'manutencao.auditoria.read', 'Auditoria de manutenção — transições, sem ator', 'maintenance-production',
    { maintenanceId: 'string?', previousStatus: 'string', nextStatus: 'string' }, { ...maintenance, timestampField: 'createdAt' })
]);

export const OPERATIONAL_DOWNLOADS = Object.freeze([
  { model: 'ReportAttachment', scope: 'rdo.anexos.download', label: 'Baixar anexos dos relatórios', storage: 'REPORT', domainCode: 'rdo' },
  { model: 'StockItemDocument', scope: 'estoque.documentos.download', label: 'Baixar documentos de estoque', storage: 'STOCK', domainCode: 'stock' },
  { model: 'MaintenanceAttachment', scope: 'manutencao.anexos.download', label: 'Baixar anexos de manutenção', storage: 'MAINTENANCE', domainCode: 'maintenance-production' }
].map(item => {
  const metadata = EXTENDED_OPERATIONAL_RESOURCES.find(r => r.model === item.model);
  return Object.freeze({ ...item, metadata, path: `${metadata.path}/:id/download`, operationId: `operational.${item.model}.download`, openApiOperationId: `downloadIntegration${item.model}`, dependencies: metadata.requiredScopes, requiredScopes: [...metadata.requiredScopes, item.scope] });
}));
