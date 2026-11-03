import { resource } from './operational-resource-definition.js';

export const CONDITIONS_VALUE_SCOPE = 'projetos.condicoes.valores.read';
const commonQuery = ['limit', 'cursor', 'updatedSince', 'snapshotAt', 'projectId', 'projectCode'];
const weeklyQuery = [...commonQuery, 'weekStart', 'from', 'to'];
const object = (properties, nullable = false) => ({ type: 'object', additionalProperties: false,
  required: Object.keys(properties), properties, ...(nullable ? { nullable: true } : {}) });
const num = { type: 'number', nullable: true };
const money = { type: 'string', pattern: '^-?\\d+\\.\\d{2}$', nullable: true };
const review = object({ concluidaEm: { type: 'string', format: 'date-time', nullable: true },
  pendencias: { type: 'integer', minimum: 0 }, itens: { type: 'array', items: object({
    codigo: { type: 'string' }, rotulo: { type: 'string' }, ok: { type: 'boolean' }
  }) } }, true);
const management = (model, path, scope, label, domain, fields, options = {}) => resource(model, path, scope, label, domain, {}, {
  commonFields: false, collectionKind: 'MANAGEMENT', projectPolicy: 'SELF', select: {},
  queryParams: commonQuery, derivedFields: fields,
  projectNotice: 'Somente projetos autorizados. Sem dados pessoais nem observações livres.', ...options
});

export const MANAGEMENT_RESOURCES = Object.freeze([
  management('Project', '/acompanhamento/projetos/semanas', 'acompanhamento.progresso.read',
    'Avanço, meta e revisão semanal por projeto', 'project-tracking', {
      projectId: 'string', projectCode: 'string', weekStart: 'date', avancoInicio: 'number?', avancoFim: 'number?',
      metaPontos: 'number?', metaDefinidaPor: 'string?', revisao: 'object?', updatedAt: 'datetime'
    }, { operationId: 'acompanhamento.projects.weeks.list', openApiOperationId: 'listIntegrationProjectWeeks', queryParams: weeklyQuery,
      fieldSchemas: { revisao: review }, projectNotice: 'Avanço do detalhe e metas/revisões por projeto e semana, de segunda a domingo em São Paulo. Até 12 semanas; sem notas ou autores.' }),
  management('Project', '/acompanhamento/projetos/custos', 'acompanhamento.custos.read',
    'Custos realizados e avanço por projeto', 'project-tracking', {
      projectId: 'string', projectCode: 'string', orcamento: 'object?', custoRealizado: 'object',
      avancoFisico: 'number?', consumoDoCusto: 'number?', currency: 'string', atualizadoEm: 'datetime'
    }, { operationId: 'acompanhamento.projects.costs.list', openApiOperationId: 'listIntegrationProjectCosts', sensitivity: 'FINANCIAL',
      fieldSchemas: { orcamento: object({ precoVenda: money, custoPrevisto: money, margemPrevista: num, diasPrevistos: num }, true),
        custoRealizado: object({ total: { ...money, nullable: false }, porCategoria: { type: 'array', items: object({
          codigo: { type: 'string' }, rotulo: { type: 'string' }, valor: { ...money, nullable: false }
        }) }, ate: { type: 'string', format: 'date' } }) },
      excludedFields: ['salários', 'custos individuais', 'lançamentos', 'identidade de colaboradores'],
      projectNotice: 'Valores em BRL e avanço iguais ao detalhe do Acompanhamento: Omie, estoque, manuais e mão de obra; previsto inclui adicionais e percentual da proposta.' }),
  management('Project', '/projetos/condicoes', 'projetos.condicoes.read',
    'Condições mínimas da proposta por projeto', 'projects-clients', {
      projectId: 'string', projectCode: 'string', permanenciaPrevistaDias: 'integer?', updatedAt: 'datetime'
    }, { operationId: 'projects.conditions.list', openApiOperationId: 'listIntegrationProjectConditions',
      optionalScopes: [CONDITIONS_VALUE_SCOPE], conditionalScope: CONDITIONS_VALUE_SCOPE,
      conditionalFields: { diariaStandByEquipamento: 'decimal?', currency: 'string' },
      projectNotice: 'Dias do orçamento selecionado, com fallback na proposta exata vinculada. Diária em BRL somente com projetos.condicoes.valores.read; independente de comercial.*.' }),
  management('EfetivoMissionAllocation', '/efetivo/alocacoes', 'efetivo.alocacoes.read',
    'Alocações oficiais por projeto, incluindo exclusões', 'workforce-planning', {
      id: 'string', projectId: 'string', projectCode: 'string', collaboratorId: 'string', funcao: 'string',
      mobilizacao: 'date?', desmobilizacao: 'date?', updatedAt: 'datetime', deletedAt: 'datetime?'
    }, { operationId: 'efetivo.allocations.list', openApiOperationId: 'listIntegrationAllocations',
      projectNotice: 'Plano oficial ativo e missão confirmada; inclui tombstones. Apenas collaboratorId e função, sem nome, CPF, salário ou contato.' }),
  management('PontoPeriodSummary', '/ponto/projetos/semanas', 'ponto.resumos.read',
    'Ponto semanal agregado por projeto', 'time-attendance', {
      projectId: 'string', projectCode: 'string', weekStart: 'date', minutosNormais: 'number', minutosExtra70: 'number',
      minutosExtra100: 'number', minutosNoturnos: 'number', pessoas: 'integer', atualizadoEm: 'datetime'
    }, { operationId: 'ponto.projects.weeks.list', openApiOperationId: 'listIntegrationProjectAttendanceWeeks', queryParams: weeklyQuery,
      projectNotice: 'Somente agregado de projetos autorizados; omite semanas com menos de duas pessoas. Mesma atribuição diária, aliases e ajustes do Acompanhamento. Até 12 semanas.' })
]);
