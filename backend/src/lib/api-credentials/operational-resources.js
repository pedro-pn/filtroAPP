import { resource, publishedReport } from './operational-resource-definition.js';
import { EXTENDED_OPERATIONAL_RESOURCES } from './extended-operational-resources.js';
import { projectRdoReport, RDO_PROJECT_SELECT, RDO_REPORT_DERIVED_FIELDS } from './rdo-projection.js';

export const BASE_OPERATIONAL_RESOURCES = Object.freeze([
  resource('Collaborator', '/colaboradores', 'colaboradores.operacional.read', 'Colaboradores — identificação operacional', 'people-access',
    { code: 'string', name: 'string', jobRoleId: 'string', isActive: 'boolean' }, {
      sensitivity: 'PERSONAL', projectPolicy: 'COLLABORATOR_REPORT',
      projectNotice: 'Com projetos selecionados, inclui somente colaboradores de equipes de relatórios aprovados desses projetos; não representa alocação atual.'
    }),
  resource('JobRole', '/cargos', 'cargos.read', 'Cargos', 'people-access', { name: 'string', isActive: 'boolean', isOperational: 'boolean' }),
  resource('Project', '/projetos', 'projetos.read', 'Projetos — dados operacionais', 'projects-clients',
    { code: 'string', name: 'string', isActive: 'boolean', location: 'string', clientSegment: 'string?', mobilizationDate: 'datetime?', demobilizationDate: 'datetime?', startDate: 'datetime?' },
    { projectPolicy: 'SELF', projectNotice: 'Somente projetos autorizados e não excluídos.', where: { deletedAt: null } }),
  resource('ClientSegment', '/clientes/segmentos', 'clientes.segmentos.read', 'Segmentos de clientes', 'projects-clients', { label: 'string', slug: 'string', isActive: 'boolean' }),
  resource('Report', '/rdo/relatorios', 'rdo.relatorios.read', 'Relatórios aprovados — identificação, descrição e horas', 'rdo',
    { projectId: 'string', reportType: 'string', sequenceNumber: 'integer?', status: 'string', reportDate: 'datetime', arrivalTime: 'string', departureTime: 'string', lunchBreak: 'string', daytimeCount: 'integer', daytimeWorkedMinutes: 'integer', nighttimeWorkedMinutes: 'integer', daytimeOvertimeMinutes: 'integer', nighttimeOvertimeMinutes: 'integer', totalOvertimeMinutes: 'integer', approvedAt: 'datetime?', dailyDescription: 'string?', overtimeReason: 'string?' },
    { projectPolicy: 'DIRECT', projectNotice: 'Número do relatório e código/nome do projeto, descrição diária e motivo de horas extras. Somente relatórios aprovados, não excluídos e de projetos autorizados não excluídos.', where: publishedReport,
      derivedFields: RDO_REPORT_DERIVED_FIELDS, select: { project: RDO_PROJECT_SELECT }, serialize: projectRdoReport, includesOperationalNotes: true }),
  resource('DdsTheme', '/rdo/dds', 'rdo.dds.read', 'Temas de DDS', 'rdo', { name: 'string', isActive: 'boolean' }),
  resource('MaintenanceRecord', '/manutencao/registros', 'manutencao.registros.read', 'Manutenções aprovadas — identificação e datas', 'maintenance-production',
    { reportId: 'string?', equipmentId: 'string', profileId: 'string?', maintenanceDate: 'datetime', status: 'string', approvedAt: 'datetime?' }, {
      projectPolicy: 'REPORT', projectNotice: 'Respeita o projeto do relatório aprovado. Manutenções avulsas aprovadas somente com acesso a todos os projetos.',
      where: { status: 'APPROVED', OR: [{ reportId: null }, { report: publishedReport }] }
    }),
  resource('MaintenanceProfile', '/manutencao/perfis', 'manutencao.perfis.read', 'Perfis e itens de manutenção', 'maintenance-production', { name: 'string', isActive: 'boolean' }),
  resource('MaintenanceProfileItem', '/manutencao/perfis/itens', 'manutencao.perfis.read', 'Itens dos perfis de manutenção', 'maintenance-production', { profileId: 'string', label: 'string', isActive: 'boolean' }),
  resource('ChemicalCleaning', '/producao/limpezas', 'producao.limpezas.read', 'Limpezas químicas — material e quantidade', 'maintenance-production',
    { reportId: 'string', material: 'string', quantityKg: 'decimal' },
    { projectPolicy: 'REPORT', projectNotice: 'Somente limpezas de relatórios aprovados e projetos autorizados não excluídos.', where: { report: publishedReport } }),
  resource('CompanyEquipment', '/equipamentos', 'equipamentos.read', 'Equipamentos — cadastro operacional', 'equipment',
    { code: 'string', name: 'string', categoryId: 'string', maintenanceProfileId: 'string?', isActive: 'boolean' }),
  resource('Equipment', '/equipamentos/rdo', 'equipamentos.read', 'Equipamentos de serviço do RDO', 'equipment', { code: 'string', name: 'string', isActive: 'boolean' }),
  resource('EquipmentCategory', '/equipamentos/categorias', 'equipamentos.categorias.read', 'Categorias de equipamentos', 'equipment', { name: 'string', isActive: 'boolean' }),
  resource('StockItem', '/estoque/itens', 'estoque.itens.read', 'Itens e categorias de estoque', 'stock',
    { type: 'string', categoryId: 'string?', code: 'string', name: 'string', manufacturer: 'string?', unitLabel: 'string', isActive: 'boolean' }),
  resource('StockCategory', '/estoque/categorias', 'estoque.itens.read', 'Categorias de estoque', 'stock', { type: 'string', name: 'string', isActive: 'boolean' })
]);

export const OPERATIONAL_RESOURCES = Object.freeze([...BASE_OPERATIONAL_RESOURCES, ...EXTENDED_OPERATIONAL_RESOURCES]);

export function getOperationalResource(operationId) {
  return OPERATIONAL_RESOURCES.find(item => item.operationId === operationId) || null;
}

// Uma segunda allowlist na saída impede vazamento mesmo se o adapter retornar campos extras.
export function serializeOperationalResource(resource, row, context) {
  const projected = resource.serialize ? resource.serialize(row, context) : row;
  return Object.fromEntries(Object.entries(resource.fields).map(([field, type]) => {
    const value = projected[field];
    return [field, value == null ? null : type.startsWith('datetime') ? new Date(value).toISOString()
      : type.startsWith('decimal') ? String(value) : value];
  }));
}
