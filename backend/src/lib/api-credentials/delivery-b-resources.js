import { resource } from './operational-resource-definition.js';

const projectSelect = { select: { code: true } };
export const MEASUREMENT_VALUE_SCOPE = 'efetivo.projetos.medicao.valores.read';
export const MEASUREMENT_FIELDS = { projectId: 'string', projectCode: 'string', preparedAt: 'datetime?', sentAt: 'datetime?',
  approvedAt: 'datetime?', situacao: 'string', saldoPendente: 'boolean?', updatedAt: 'datetime' };
export const MEASUREMENT_VALUE_FIELDS = { executedAmount: 'decimal?', measuredAmount: 'decimal?', approvedAmount: 'decimal?', currency: 'string' };
export const MEASUREMENT_SELECT = { id: true, code: true, updatedAt: true,
  workflow: { select: { measurement: { select: { preparedAt: true, sentAt: true, approvedAt: true,
    executedAmount: true, measuredAmount: true, approvedAmount: true } } } } };
const { updatedAt: measurementTimestamp, ...measurementDerived } = MEASUREMENT_FIELDS;
const pendingSchema = { type: 'object', additionalProperties: false,
  required: ['quantidade', 'valorEmAberto', 'proximoVencimento'], properties: {
    quantidade: { type: 'integer', minimum: 0 }, valorEmAberto: { type: 'string', nullable: true },
    proximoVencimento: { type: 'string', format: 'date-time', nullable: true }
  } };
export const DELIVERY_B_RESOURCES = Object.freeze([
  resource('Project', '/efetivo/projetos/medicoes', 'efetivo.projetos.medicao.read', 'Medição por projeto — situação e saldo pendente', 'workforce-planning', { updatedAt: measurementTimestamp }, {
    commonFields: false, operationId: 'efetivo.projects.measurements.list', openApiOperationId: 'listIntegrationProjectMeasurements',
    projectPolicy: 'SELF', where: { deletedAt: null }, derivedFields: measurementDerived, select: MEASUREMENT_SELECT,
    optionalScopes: [MEASUREMENT_VALUE_SCOPE], conditionalFields: MEASUREMENT_VALUE_FIELDS, conditionalScope: MEASUREMENT_VALUE_SCOPE,
    projectNotice: 'Projetos autorizados, inclusive sem medição. Valores em BRL somente com o escopo financeiro adicional.'
  }),
  resource('OmieInvoice', '/omie/notas', 'omie.notas.read', 'Notas fiscais por projeto — emissão e recebimento', 'omie', {}, {
    commonFields: false, projectPolicy: 'DIRECT', collectionKind: 'OMIE_INVOICES', sensitivity: 'FINANCIAL',
    derivedFields: { id: 'string', projectId: 'string', projectCode: 'string', tipo: 'string', numero: 'string', serie: 'string?',
      dataEmissao: 'datetime', valor: 'decimal', situacaoRecebimento: 'string', updatedAt: 'datetime' },
    select: {}, projectNotice: 'Ligação exata codigoProjeto → OmieProject.codigo → projectId. Sem vínculo atual não publica. Valores em BRL.'
  }),
  resource('Romaneio', '/romaneios', 'romaneios.read', 'Romaneios de saída e retorno — resumo da carga', 'packing-lists', {}, {
    commonFields: false, projectPolicy: 'DIRECT', where: { project: { deletedAt: null } },
    derivedFields: { id: 'string', projectId: 'string', projectCode: 'string', tipo: 'string', data: 'datetime', emitidoEm: 'datetime?',
      quantidadeItens: 'integer', pesoCarga: 'decimal?', unidadePeso: 'string?', updatedAt: 'datetime' },
    select: { id: true, projectId: true, project: projectSelect, type: true, romaneioDate: true, emittedAt: true,
      cargoWeight: true, cargoWeightUnit: true, updatedAt: true, _count: { select: { items: true } } },
    projectNotice: 'Resumo por projeto autorizado. Quantidade de linhas; sem motorista, placa, assinaturas ou arquivos.'
  }),
  resource('Project', '/omie/projetos/pendencias', 'omie.pendencias.read', 'Pendências financeiras — agregado por projeto', 'omie', {}, {
    commonFields: false, operationId: 'operational.ProjectPending.list', openApiOperationId: 'listIntegrationProjectPending',
    projectPolicy: 'SELF', sensitivity: 'FINANCIAL', where: { deletedAt: null },
    derivedFields: { projectId: 'string', projectCode: 'string', aPagar: 'object', aReceber: 'object', atualizadoEm: 'datetime' },
    fieldSchemas: { aPagar: pendingSchema, aReceber: pendingSchema },
    select: { id: true, code: true, updatedAt: true },
    projectNotice: 'Somente quantidades, valores abertos em BRL e próximo vencimento. Inclui zeros; saldo parcial desconhecido é nulo.'
  }),
  resource('LogisticsUnloading', '/logistica/descargas', 'logistica.descargas.read', 'Descargas confirmadas — histórico por romaneio', 'packing-lists', {}, {
    commonFields: false, projectPolicy: 'DIRECT', sensitivity: 'PERSONAL', where: { project: { deletedAt: null } },
    derivedFields: { id: 'string', romaneioId: 'string', projectId: 'string', projectCode: 'string', tipo: 'string', confirmadaEm: 'datetime',
      confirmadaPorEmail: 'string', cte: 'object?', updatedAt: 'datetime' },
    fieldSchemas: { cte: { type: 'object', nullable: true, additionalProperties: false, required: ['numero', 'emissao', 'transportadora'],
      properties: { numero: { type: 'string' }, emissao: { type: 'string', format: 'date-time' }, transportadora: { type: 'string' } } } },
    select: { id: true, romaneioId: true, projectId: true, project: projectSelect, tipo: true, confirmadaEm: true,
      confirmadaPorEmail: true, updatedAt: true, cte: { select: { numero: true, emissao: true, transportadora: true } } },
    projectNotice: 'Histórico de descarga parcial e total, com e-mail do responsável e referência mínima ao CT-e.'
  })
]);
