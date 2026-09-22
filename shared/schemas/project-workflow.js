export const PROJECT_WORKFLOW_STAGES = [
  'HANDOVER',
  'INITIAL_ANALYSIS',
  'WAITING_PLANNING',
  'MOBILIZATION_PLANNING',
  'PREPARATION',
  'MOBILIZATION',
  'EXECUTION',
  'DEMOBILIZATION',
  'POST_JOB',
  'FINAL_MEASUREMENT',
  'FINISHED'
];

export const PROJECT_WORKFLOW_STAGE_LABELS = {
  HANDOVER: 'Handover comercial',
  INITIAL_ANALYSIS: 'Análise inicial',
  WAITING_PLANNING: 'Aguardando planejamento',
  MOBILIZATION_PLANNING: 'Planejamento da mobilização',
  PREPARATION: 'Preparação',
  MOBILIZATION: 'Mobilização',
  EXECUTION: 'Em execução',
  DEMOBILIZATION: 'Desmobilização',
  POST_JOB: 'Pós-job / fechamento técnico',
  FINAL_MEASUREMENT: 'Documentação / medição',
  FINISHED: 'Encerrado'
};

export const PROJECT_WORKFLOW_CHECKLIST_SECTIONS = [
  'INITIAL_ANALYSIS',
  'D30_TEAM',
  'D30_EQUIPMENT',
  'D30_MATERIALS',
  'D30_LOGISTICS',
  'D15_TEAM',
  'D15_CLIENT',
  'D15_EQUIPMENT',
  'D15_MATERIALS',
  'D15_PRE_JOB',
  'D15_TRAVEL',
  'D15_QSMS',
  'DEMOBILIZATION_FIELD',
  'DEMOBILIZATION_LOGISTICS',
  'DEMOBILIZATION_ASSETS',
  'POST_JOB_FEEDBACK',
  'POST_JOB_LEARNING',
  'CLOSEOUT_DOCUMENTATION',
  'CLOSEOUT_MEASUREMENT',
  'FINAL_CLOSEOUT'
];

export const PROJECT_WORKFLOW_CHECKLIST_SECTION_LABELS = {
  INITIAL_ANALYSIS: 'Checklist da análise inicial',
  D30_TEAM: 'Equipe',
  D30_EQUIPMENT: 'Equipamentos',
  D30_MATERIALS: 'Materiais e insumos',
  D30_LOGISTICS: 'Logística preliminar',
  D15_TEAM: 'Equipe definitiva',
  D15_CLIENT: 'Cliente e liberações',
  D15_EQUIPMENT: 'Equipamentos',
  D15_MATERIALS: 'Materiais',
  D15_PRE_JOB: 'Pré-job',
  D15_TRAVEL: 'Viagem e logística',
  D15_QSMS: 'QSMS',
  DEMOBILIZATION_FIELD: 'Conclusão de campo',
  DEMOBILIZATION_LOGISTICS: 'Logística de retorno',
  DEMOBILIZATION_ASSETS: 'Retorno de ativos',
  POST_JOB_FEEDBACK: 'Reunião e feedbacks',
  POST_JOB_LEARNING: 'Aprendizados e melhorias',
  CLOSEOUT_DOCUMENTATION: 'Documentação',
  CLOSEOUT_MEASUREMENT: 'Medição',
  FINAL_CLOSEOUT: 'Checklist final de encerramento'
};

export const PROJECT_WORKFLOW_TEAM_MEMBER_CHECKS = [
  { key: 'NOTIFIED', label: 'Colaborador informado', areaRoles: ['efetivo:operations'] },
  { key: 'DOCUMENTS_CHECKED', label: 'Documentação conferida', areaRoles: ['efetivo:administrative'] },
  { key: 'EXAMS_RELEASED', label: 'Exames liberados', areaRoles: ['efetivo:administrative'] },
  { key: 'TRAININGS_RELEASED', label: 'Treinamentos liberados', areaRoles: ['efetivo:administrative'] }
];

export const PROJECT_WORKFLOW_PREPARATION_ITEM_CHECKS = {
  EQUIPMENT: [
    { key: 'TESTED', label: 'Equipamento testado', areaRoles: ['efetivo:assets'] },
    { key: 'ACCESSORIES_SEPARATED', label: 'Acessórios separados', areaRoles: ['efetivo:assets'] }
  ],
  MATERIAL: [
    { key: 'SEPARATED', label: 'Material separado', areaRoles: ['efetivo:supplies'] }
  ]
};

export const PROJECT_WORKFLOW_CLIENT_RELEASE_KEYS = [
  'CUSTOMER_REGISTRATION',
  'DOCUMENTS_SENT',
  'INTEGRATION_REQUEST'
];

// O cadastro no cliente saiu daqui: agora é perguntado nos itens críticos da Análise inicial (com aviso por
// e-mail ao Administrativo) e não aparece mais, duplicado, na Preparação.
export const PROJECT_WORKFLOW_CUSTOMER_REGISTRATION_RELEASE = { key: 'CUSTOMER_REGISTRATION', label: 'Cadastro no cliente', areaRoles: ['efetivo:administrative'] };

export const PROJECT_WORKFLOW_CLIENT_RELEASES = [
  { key: 'DOCUMENTS_SENT', label: 'Documentação enviada ao cliente', areaRoles: ['efetivo:administrative'] },
  { key: 'INTEGRATION_REQUEST', label: 'Solicitação de integração', areaRoles: ['efetivo:administrative'] }
];

// Seletor estruturado de veículo/transporte, usado tanto no transporte da equipe quanto no frete (seções
// separadas, mesmo catálogo): "Nosso" e "Frete" (terceiro) escolhem um tipo de veículo do catálogo; "Locação de
// carro" não tem tipo (é sempre um carro alugado) — só a quantidade.
export const PROJECT_WORKFLOW_TRANSPORT_MODES = ['OWN', 'RENTAL', 'THIRD_PARTY'];
export const PROJECT_WORKFLOW_TRANSPORT_MODE_LABELS = { OWN: 'Nosso', RENTAL: 'Locação de carro', THIRD_PARTY: 'Frete (terceiro)' };
export const PROJECT_WORKFLOW_TRANSPORT_VEHICLE_TYPES = {
  OWN: ['PICKUP', 'HR', 'VW10180', 'PASSENGER'],
  THIRD_PARTY: ['CARRETA', 'TRUCK', 'MUNCK', 'TOCO', 'HR', 'PICKUP']
};
export const PROJECT_WORKFLOW_TRANSPORT_VEHICLE_TYPE_LABELS = {
  PICKUP: 'Pickup',
  HR: 'HR',
  VW10180: 'VW 10.180',
  PASSENGER: 'Veículo de passeio',
  CARRETA: 'Carreta',
  TRUCK: 'Truck',
  MUNCK: 'Munck',
  TOCO: 'Toco'
};

const checklist = (key, stage, section, label, areaRoles = []) => ({ key, stage, section, label, areaRoles });

export const PROJECT_WORKFLOW_CHECKLISTS = [
  checklist('ANALYSIS_RESPONSIBILITIES', 'INITIAL_ANALYSIS', 'INITIAL_ANALYSIS', 'Responsabilidades Filtrovali e cliente identificadas'),
  checklist('ANALYSIS_COMMERCIAL_QUESTIONS', 'INITIAL_ANALYSIS', 'INITIAL_ANALYSIS', 'Dúvidas comerciais levantadas e esclarecidas'),

  checklist('DEMOB_FIELD_SCOPE_COMPLETED', 'DEMOBILIZATION', 'DEMOBILIZATION_FIELD', 'Escopo de campo concluído', ['efetivo:operations']),
  checklist('DEMOB_FIELD_CLIENT_CONFIRMED', 'DEMOBILIZATION', 'DEMOBILIZATION_FIELD', 'Cliente confirmou a conclusão', ['efetivo:operations']),
  checklist('DEMOB_FIELD_QUANTITIES_CHECKED', 'DEMOBILIZATION', 'DEMOBILIZATION_FIELD', 'Quantitativos conferidos', ['efetivo:operations']),
  checklist('DEMOB_FIELD_EXTRA_SERVICES_IDENTIFIED', 'DEMOBILIZATION', 'DEMOBILIZATION_FIELD', 'Serviços extras identificados', ['efetivo:operations']),
  checklist('DEMOB_FIELD_PENDING_ITEMS_RECORDED', 'DEMOBILIZATION', 'DEMOBILIZATION_FIELD', 'Pendências de campo registradas', ['efetivo:operations']),
  checklist('DEMOB_FIELD_EQUIPMENT_CHECKED', 'DEMOBILIZATION', 'DEMOBILIZATION_FIELD', 'Equipamentos conferidos', ['efetivo:operations', 'efetivo:assets']),
  checklist('DEMOB_FIELD_MATERIALS_CHECKED', 'DEMOBILIZATION', 'DEMOBILIZATION_FIELD', 'Materiais conferidos', ['efetivo:operations', 'efetivo:supplies']),
  checklist('DEMOB_FIELD_TOOLS_CHECKED', 'DEMOBILIZATION', 'DEMOBILIZATION_FIELD', 'Ferramentas conferidas', ['efetivo:operations', 'efetivo:assets']),

  checklist('DEMOB_LOGISTICS_TEAM_RETURN_ORGANIZED', 'DEMOBILIZATION', 'DEMOBILIZATION_LOGISTICS', 'Retorno da equipe organizado', ['efetivo:operations']),
  checklist('DEMOB_LOGISTICS_EQUIPMENT_RETURN_ORGANIZED', 'DEMOBILIZATION', 'DEMOBILIZATION_LOGISTICS', 'Retorno dos equipamentos organizado', ['efetivo:operations', 'efetivo:assets']),
  checklist('DEMOB_LOGISTICS_LODGING_CLOSED', 'DEMOBILIZATION', 'DEMOBILIZATION_LOGISTICS', 'Hospedagem encerrada', ['efetivo:administrative']),
  checklist('DEMOB_LOGISTICS_RETURN_TRANSPORT_DEFINED', 'DEMOBILIZATION', 'DEMOBILIZATION_LOGISTICS', 'Frete ou veículo de retorno definido', ['efetivo:operations']),

  checklist('DEMOB_ASSETS_RETURNED_TO_BASE', 'DEMOBILIZATION', 'DEMOBILIZATION_ASSETS', 'Equipamentos retornaram para a sede', ['efetivo:assets']),
  checklist('DEMOB_ASSETS_DELIVERED', 'DEMOBILIZATION', 'DEMOBILIZATION_ASSETS', 'Equipamentos entregues para Ativos', ['efetivo:assets']),
  checklist('DEMOB_ASSETS_DAMAGE_RECORDED', 'DEMOBILIZATION', 'DEMOBILIZATION_ASSETS', 'Avarias e problemas registrados', ['efetivo:assets', 'efetivo:operations']),

  checklist('POST_JOB_MEETING_COMPLETED', 'POST_JOB', 'POST_JOB_FEEDBACK', 'Pós-job realizado'),
  checklist('POST_JOB_FIELD_LEADER_FEEDBACK', 'POST_JOB', 'POST_JOB_FEEDBACK', 'Feedback do responsável de campo coletado'),
  checklist('POST_JOB_TEAM_FEEDBACK', 'POST_JOB', 'POST_JOB_FEEDBACK', 'Feedback dos colaboradores coletado'),
  checklist('POST_JOB_EQUIPMENT_FEEDBACK', 'POST_JOB', 'POST_JOB_FEEDBACK', 'Feedback sobre equipamentos registrado'),
  checklist('POST_JOB_PLANNING_FEEDBACK', 'POST_JOB', 'POST_JOB_FEEDBACK', 'Feedback sobre planejamento registrado'),

  checklist('POST_JOB_PROBLEMS_RECORDED', 'POST_JOB', 'POST_JOB_LEARNING', 'Problemas encontrados registrados'),
  checklist('POST_JOB_SOLUTIONS_RECORDED', 'POST_JOB', 'POST_JOB_LEARNING', 'Soluções adotadas registradas'),
  checklist('POST_JOB_IMPROVEMENTS_RECORDED', 'POST_JOB', 'POST_JOB_LEARNING', 'Oportunidades de melhoria registradas'),
  checklist('POST_JOB_LESSONS_RECORDED', 'POST_JOB', 'POST_JOB_LEARNING', 'Lições aprendidas registradas'),

  checklist('CLOSEOUT_RDO_ISSUED', 'FINAL_MEASUREMENT', 'CLOSEOUT_DOCUMENTATION', 'Todos os RDOs emitidos'),
  checklist('CLOSEOUT_RDO_ACCEPTED', 'FINAL_MEASUREMENT', 'CLOSEOUT_DOCUMENTATION', 'Todos os RDOs assinados ou aprovados'),
  checklist('CLOSEOUT_REPORTS_PREPARED', 'FINAL_MEASUREMENT', 'CLOSEOUT_DOCUMENTATION', 'Todos os relatórios técnicos elaborados'),
  checklist('CLOSEOUT_REPORTS_REVIEWED', 'FINAL_MEASUREMENT', 'CLOSEOUT_DOCUMENTATION', 'Todos os relatórios revisados'),
  checklist('CLOSEOUT_REPORTS_SENT', 'FINAL_MEASUREMENT', 'CLOSEOUT_DOCUMENTATION', 'Todos os relatórios enviados'),
  checklist('CLOSEOUT_DOCUMENT_PENDING_RESOLVED', 'FINAL_MEASUREMENT', 'CLOSEOUT_DOCUMENTATION', 'Pendências documentais resolvidas'),
  checklist('CLOSEOUT_CLIENT_ACCEPTED', 'FINAL_MEASUREMENT', 'CLOSEOUT_DOCUMENTATION', 'Documentação técnica aceita pelo cliente'),

  checklist('CLOSEOUT_QUANTITIES_CONSOLIDATED', 'FINAL_MEASUREMENT', 'CLOSEOUT_MEASUREMENT', 'Quantitativos finais consolidados'),
  checklist('CLOSEOUT_ADDITIONAL_SERVICES_INCLUDED', 'FINAL_MEASUREMENT', 'CLOSEOUT_MEASUREMENT', 'Serviços adicionais incluídos'),
  checklist('CLOSEOUT_EVIDENCE_AVAILABLE', 'FINAL_MEASUREMENT', 'CLOSEOUT_MEASUREMENT', 'Evidências disponíveis'),
  checklist('CLOSEOUT_MEASUREMENT_PREPARED', 'FINAL_MEASUREMENT', 'CLOSEOUT_MEASUREMENT', 'Medição preparada'),
  checklist('CLOSEOUT_MEASUREMENT_SENT', 'FINAL_MEASUREMENT', 'CLOSEOUT_MEASUREMENT', 'Medição enviada'),
  checklist('CLOSEOUT_MEASUREMENT_APPROVED', 'FINAL_MEASUREMENT', 'CLOSEOUT_MEASUREMENT', 'Medição aprovada'),
  checklist('CLOSEOUT_FINAL_VALUE_APPROVED', 'FINAL_MEASUREMENT', 'CLOSEOUT_MEASUREMENT', 'Valor final aprovado'),

  checklist('FINAL_SCOPE_CLOSED', 'FINAL_MEASUREMENT', 'FINAL_CLOSEOUT', 'Escopo encerrado'),
  checklist('FINAL_RDOS_COMPLETE', 'FINAL_MEASUREMENT', 'FINAL_CLOSEOUT', 'RDOs 100%'),
  checklist('FINAL_REPORTS_COMPLETE', 'FINAL_MEASUREMENT', 'FINAL_CLOSEOUT', 'Relatórios 100%'),
  checklist('FINAL_MEASUREMENT_APPROVED', 'FINAL_MEASUREMENT', 'FINAL_CLOSEOUT', 'Medição aprovada'),
  checklist('FINAL_CLIENT_PENDING_ZERO', 'FINAL_MEASUREMENT', 'FINAL_CLOSEOUT', 'Pendências com o cliente zeradas'),
  checklist('FINAL_POST_JOB_COMPLETED', 'FINAL_MEASUREMENT', 'FINAL_CLOSEOUT', 'Pós-job realizado'),
  checklist('FINAL_FEEDBACKS_RECORDED', 'FINAL_MEASUREMENT', 'FINAL_CLOSEOUT', 'Feedbacks registrados'),
  checklist('FINAL_LESSONS_RECORDED', 'FINAL_MEASUREMENT', 'FINAL_CLOSEOUT', 'Lições aprendidas registradas'),
  checklist('FINAL_EQUIPMENT_RETURNED', 'FINAL_MEASUREMENT', 'FINAL_CLOSEOUT', 'Equipamentos devolvidos'),
  checklist('FINAL_INTERNAL_PENDING_ZERO', 'FINAL_MEASUREMENT', 'FINAL_CLOSEOUT', 'Pendências internas zeradas')
];

export const PROJECT_WORKFLOW_CRITICAL_QUESTIONS = [
  {
    key: 'SPECIAL_EQUIPMENT',
    label: 'Existe equipamento especial que precisa ser comprado, fabricado ou locado?',
    area: 'Ativos',
    issueDescription: 'Providenciar equipamento especial'
  },
  {
    key: 'LONG_LEAD_MATERIAL',
    label: 'Existe material ou insumo especial com prazo longo?',
    area: 'Suprimentos',
    issueDescription: 'Providenciar material ou insumo de prazo longo'
  },
  {
    key: 'MORE_THAN_TEN_FILTERS',
    label: 'Serão necessários mais de 10 elementos filtrantes ou unidades de filtro?',
    area: 'Suprimentos',
    issueDescription: 'Planejar fornecimento de mais de 10 elementos filtrantes ou unidades de filtro'
  },
  {
    key: 'SPECIFIC_HIRING',
    label: 'Existe necessidade de contratação específica?',
    area: 'Operações',
    issueDescription: 'Planejar contratação específica'
  },
  {
    key: 'CLIENT_REQUIREMENTS',
    label: 'Existem treinamentos, exames ou documentos específicos do cliente?',
    area: 'Administrativo/RH',
    issueDescription: 'Regularizar treinamentos, exames ou documentos específicos do cliente',
    createsIssue: false
  },
  {
    key: 'CLIENT_REGISTRATION',
    label: 'É necessário cadastro da Filtrovali junto ao cliente?',
    area: 'Administrativo',
    issueDescription: 'Solicitar cadastro da Filtrovali junto ao cliente',
    // Não cria uma pendência genérica: aciona o aviso por e-mail ao Administrativo e acompanha só
    // "Solicitado"/"Concluído" (ver PROJECT_WORKFLOW_CUSTOMER_REGISTRATION_RELEASE).
    createsIssue: false
  }
];

export const PROJECT_WORKFLOW_DOCUMENTATION_TYPES = ['DOCUMENT', 'EXAM', 'TRAINING', 'QUALITY', 'CERTIFICATION'];
export const PROJECT_WORKFLOW_DOCUMENTATION_STATUSES = ['PENDING', 'REQUESTED', 'CONFIRMED'];
export const PROJECT_WORKFLOW_DOCUMENTATION_DEFINITIONS = [
  { type: 'DOCUMENT', label: 'Documentos técnicos', description: 'É necessário algum documento de engenharia? Ex.: instrução de trabalho', singularLabel: 'documento técnico', nameLabel: 'Nome do documento técnico' },
  { type: 'EXAM', label: 'Exames adicionais', description: 'É necessário algum exame adicional para o projeto? Ex.: PMSO, ASO, LTCAT, PGR', singularLabel: 'exame adicional', nameLabel: 'Nome do exame adicional' },
  { type: 'TRAINING', label: 'Documentos de segurança', description: 'É necessária alguma documentação de segurança específica? Ex.: NRs, APRs', singularLabel: 'documento de segurança', nameLabel: 'Nome do documento de segurança' },
  { type: 'QUALITY', label: 'Documentos de qualidade', description: 'É necessário algum documento de qualidade diferente do usual? Ex.: RDO, RCPUs, RTPs', singularLabel: 'documento de qualidade', nameLabel: 'Nome do documento de qualidade' },
  { type: 'CERTIFICATION', label: 'Certificações adicionais', description: 'Quais certificações serão necessárias para o projeto? Ex.: calibração de equipamentos, planos de manutenção, checklists', singularLabel: 'certificação adicional', nameLabel: 'Nome da certificação adicional' }
];

export const PROJECT_WORKFLOW_CHECKLIST_STATUSES = ['PENDING', 'DONE', 'NOT_APPLICABLE'];
export const PROJECT_WORKFLOW_ISSUE_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];
export const PROJECT_WORKFLOW_CRITICALITIES = ['HIGH', 'MEDIUM', 'LOW'];

export const PROJECT_WORKFLOW_COMMERCIAL_FACT_STATUSES = ['PENDING', 'CONFIRMED', 'NOT_APPLICABLE'];
export const PROJECT_WORKFLOW_COMMERCIAL_FACT_SOURCES = ['MANUAL', 'CRM'];
export const PROJECT_WORKFLOW_COMMERCIAL_FACTS = [
  { key: 'COMMERCIAL_PROPOSAL_CREATED', label: 'Proposta comercial criada', allowNotApplicable: false, evidence: 'reference' },
  { key: 'TECHNICAL_PROPOSAL_CREATED', label: 'Proposta técnica criada', allowNotApplicable: false, evidence: 'reference' },
  { key: 'PROPOSAL_ACCEPTED', label: 'Proposta aceita', allowNotApplicable: true, evidence: 'reference' },
  { key: 'PURCHASE_ORDER_RECEIVED', label: 'Pedido de compra recebido', allowNotApplicable: true, evidence: 'reference' },
  { key: 'CONTRACT_SIGNED', label: 'Contrato assinado', allowNotApplicable: true, evidence: 'reference' },
  { key: 'COMMERCIAL_REGISTRATION_READY', label: 'Cadastro e condições comerciais atendidos', allowNotApplicable: false, evidence: 'note' },
  { key: 'MEASUREMENT_TERMS_DEFINED', label: 'Condição de medição definida', allowNotApplicable: false, evidence: 'note' },
  { key: 'BILLING_TERMS_DEFINED', label: 'Condição de faturamento definida', allowNotApplicable: false, evidence: 'note' }
];

// Projeto executado na Sede: não há mobilização em campo. A resposta (`executedAtHeadquarters`) é dada na
// Análise inicial; `null` = ainda não respondido e o projeto segue o fluxo de campo. Itens "ocultos" somem da
// tela, dos bloqueios e do progresso; itens "opcionais" continuam visíveis, mas não bloqueiam nem contam.
export const PROJECT_WORKFLOW_HEADQUARTERS_SKIPPED_STAGES = ['MOBILIZATION', 'DEMOBILIZATION'];
export const PROJECT_WORKFLOW_HEADQUARTERS_EDITABLE_STAGES = ['HANDOVER', 'INITIAL_ANALYSIS', 'WAITING_PLANNING', 'MOBILIZATION_PLANNING'];
export const PROJECT_WORKFLOW_HEADQUARTERS_HIDDEN_TEAM_CHECKS = ['EXAMS_RELEASED', 'TRAININGS_RELEASED'];
export const PROJECT_WORKFLOW_HEADQUARTERS_HIDDEN_DOCUMENTATION_TYPES = ['EXAM'];
export const PROJECT_WORKFLOW_HEADQUARTERS_HIDDEN_CRITICAL_QUESTIONS = ['CLIENT_REQUIREMENTS', 'CLIENT_REGISTRATION'];
export const PROJECT_WORKFLOW_HEADQUARTERS_HIDDEN_CLIENT_RELEASES = PROJECT_WORKFLOW_CLIENT_RELEASE_KEYS;
export const PROJECT_WORKFLOW_HEADQUARTERS_OPTIONAL_SECTIONS = [
  'D30_EQUIPMENT',
  'D30_MATERIALS',
  'D30_LOGISTICS',
  'D15_EQUIPMENT',
  'D15_MATERIALS',
  'D15_TRAVEL',
  'D15_QSMS'
];

export function isHeadquartersWorkflow(workflow) {
  return workflow?.executedAtHeadquarters === true;
}

export function projectWorkflowVisibleStages(headquarters) {
  return headquarters
    ? PROJECT_WORKFLOW_STAGES.filter(stage => !PROJECT_WORKFLOW_HEADQUARTERS_SKIPPED_STAGES.includes(stage))
    : PROJECT_WORKFLOW_STAGES;
}

// Data-base dos marcos D-x e dos alertas: a mobilização em campo, ou o início da execução prevista na Sede.
export function projectWorkflowReferenceDate(workflow) {
  return isHeadquartersWorkflow(workflow) ? workflow?.plannedExecutionStartDate || null : workflow?.plannedMobilizationDate || null;
}

export function projectWorkflowStageTransitions(stage, headquarters = false) {
  const transitions = {
    HANDOVER: [],
    INITIAL_ANALYSIS: ['WAITING_PLANNING', 'MOBILIZATION_PLANNING'],
    WAITING_PLANNING: ['INITIAL_ANALYSIS', 'MOBILIZATION_PLANNING'],
    MOBILIZATION_PLANNING: ['INITIAL_ANALYSIS', 'WAITING_PLANNING', 'PREPARATION'],
    // Sem "Pronto para mobilizar": a Preparação vai direto para a etapa seguinte quando o gate está limpo,
    // sem autorização manual (na Sede, direto para a Execução, sem mobilização em campo).
    PREPARATION: headquarters ? ['MOBILIZATION_PLANNING', 'EXECUTION'] : ['MOBILIZATION_PLANNING', 'MOBILIZATION'],
    MOBILIZATION: ['PREPARATION', 'EXECUTION'],
    EXECUTION: headquarters ? ['PREPARATION', 'POST_JOB'] : ['MOBILIZATION', 'DEMOBILIZATION'],
    DEMOBILIZATION: ['EXECUTION', 'POST_JOB'],
    POST_JOB: headquarters ? ['EXECUTION', 'FINAL_MEASUREMENT'] : ['DEMOBILIZATION', 'FINAL_MEASUREMENT'],
    FINAL_MEASUREMENT: ['POST_JOB', 'FINISHED'],
    FINISHED: ['FINAL_MEASUREMENT']
  };
  return transitions[stage] || [];
}

function dateOnlySchema(z) {
  return z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.').refine(value => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Informe uma data válida.');
}

export function makeProjectWorkflowCommercialFactSchema(z) {
  const dateOnly = dateOnlySchema(z);
  const id = z.string().trim().min(1).max(100);
  return z.object({
    action: z.literal('commercial_fact'),
    version: z.coerce.number().int().min(1, 'A versão deve ser positiva.'),
    key: z.enum(PROJECT_WORKFLOW_COMMERCIAL_FACTS.map(item => item.key)),
    status: z.enum(PROJECT_WORKFLOW_COMMERCIAL_FACT_STATUSES),
    evidenceDocumentId: id.nullable().optional(),
    reference: z.string().trim().max(500, 'A referência deve ter no máximo 500 caracteres.').nullable().optional(),
    note: z.string().trim().max(1000, 'A observação deve ter no máximo 1000 caracteres.').nullable().optional(),
    occurredOn: dateOnly.nullable().optional()
  }).strict().superRefine((value, ctx) => {
    const definition = PROJECT_WORKFLOW_COMMERCIAL_FACTS.find(item => item.key === value.key);
    if (value.status === 'NOT_APPLICABLE') {
      if (!definition?.allowNotApplicable) ctx.addIssue({ code: 'custom', path: ['status'], message: 'Este fato comercial não aceita “não aplicável”.' });
      if (!value.note?.trim()) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Justifique por que este fato não se aplica.' });
    }
    if (value.status !== 'CONFIRMED') return;
    if (!value.occurredOn) ctx.addIssue({ code: 'custom', path: ['occurredOn'], message: 'Informe a data da confirmação.' });
    if (definition?.evidence === 'reference' && !value.reference?.trim() && !value.evidenceDocumentId) {
      ctx.addIssue({ code: 'custom', path: ['reference'], message: 'Informe a referência ou selecione um documento.' });
    }
    if (definition?.evidence === 'note' && !value.note?.trim()) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Descreva a condição comercial definida.' });
  });
}

export function makeProjectWorkflowSchemas(z) {
  const id = z.string().trim().min(1, 'Informe o registro.').max(100);
  const version = z.coerce.number().int().min(1, 'A versão deve ser positiva.');
  const correctionStage = z.enum(PROJECT_WORKFLOW_STAGES).nullable().optional();
  const dateOnly = dateOnlySchema(z);
  const note = z.string().trim().max(1000, 'A observação deve ter no máximo 1000 caracteres.').nullable().optional();
  const start = z.object({
    leaderUserId: id,
    plannerUserId: id,
    plannedMobilizationDate: dateOnly.optional()
  }).strict();
  const settings = z.object({
    action: z.literal('settings'),
    version,
    correctionStage,
    leaderUserId: id.optional(),
    plannerUserId: id.optional(),
    plannedMobilizationDate: dateOnly.nullable().optional()
  }).strict().refine(value => value.leaderUserId || value.plannerUserId || Object.hasOwn(value, 'plannedMobilizationDate'), 'Informe ao menos uma alteração.');
  const checklist = z.object({
    action: z.literal('checklist'),
    version,
    correctionStage,
    key: z.enum(PROJECT_WORKFLOW_CHECKLISTS.map(item => item.key)),
    status: z.enum(PROJECT_WORKFLOW_CHECKLIST_STATUSES),
    note
  }).strict().refine(value => value.status !== 'NOT_APPLICABLE' || Boolean(value.note?.trim()), {
    path: ['note'],
    message: 'Justifique por que este item não se aplica.'
  });
  const teamMemberCheck = z.object({
    action: z.literal('team_member_check'),
    version,
    correctionStage,
    collaboratorId: id,
    key: z.enum(PROJECT_WORKFLOW_TEAM_MEMBER_CHECKS.map(item => item.key)),
    status: z.enum(['PENDING', 'DONE'])
  }).strict();
  const preparationItemCheck = z.object({
    action: z.literal('preparation_item_check'),
    version,
    correctionStage,
    itemType: z.enum(['EQUIPMENT', 'MATERIAL']),
    itemId: z.string().trim().min(1).max(120),
    key: z.enum([...new Set(Object.values(PROJECT_WORKFLOW_PREPARATION_ITEM_CHECKS).flatMap(items => items.map(item => item.key)))]),
    status: z.enum(['PENDING', 'DONE'])
  }).strict().superRefine((value, ctx) => {
    if (!PROJECT_WORKFLOW_PREPARATION_ITEM_CHECKS[value.itemType].some(item => item.key === value.key)) {
      ctx.addIssue({ code: 'custom', path: ['key'], message: 'O controle não pertence a este tipo de item.' });
    }
  });
  const clientAttendance = z.object({
    action: z.literal('client_attendance'),
    version,
    correctionStage,
    attendanceDate: dateOnly
  }).strict();
  const clientRelease = z.object({
    action: z.literal('client_release'),
    version,
    correctionStage,
    key: z.enum(PROJECT_WORKFLOW_CLIENT_RELEASE_KEYS),
    requested: z.boolean(),
    requestedAt: dateOnly.nullable(),
    // Reaproveitado só para o cadastro no cliente: guarda o e-mail para onde o aviso foi enviado.
    requestedTo: z.string().trim().max(160, 'O destinatário deve ter no máximo 160 caracteres.').nullable().optional(),
    completed: z.boolean(),
    completedAt: dateOnly.nullable(),
    // Edição pontual do e-mail de aviso do cadastro no cliente; reenvia e, opcionalmente, atualiza o padrão.
    notificationEmail: z.string().trim().email('Informe um e-mail válido.').max(160).optional(),
    makeDefaultEmail: z.boolean().optional()
  }).strict().superRefine((value, ctx) => {
    if (value.completed && !value.requested) {
      ctx.addIssue({ code: 'custom', path: ['requested'], message: 'Registre a solicitação antes da conclusão.' });
    }
    if (value.requestedAt && value.completedAt && value.requestedAt > value.completedAt) {
      ctx.addIssue({ code: 'custom', path: ['completedAt'], message: 'A conclusão não pode ser anterior à solicitação.' });
    }
    if (value.key !== 'CUSTOMER_REGISTRATION' && (value.notificationEmail || value.makeDefaultEmail)) {
      ctx.addIssue({ code: 'custom', path: ['notificationEmail'], message: 'Este item não tem aviso por e-mail.' });
    }
  });
  const preJob = z.object({
    action: z.literal('pre_job'),
    version,
    correctionStage,
    scheduledDate: dateOnly.nullable().optional(),
    completedDate: dateOnly.nullable().optional()
  }).strict().superRefine((value, ctx) => {
    if (!Object.hasOwn(value, 'scheduledDate') && !Object.hasOwn(value, 'completedDate')) {
      ctx.addIssue({ code: 'custom', message: 'Informe ao menos uma data do pré-job.' });
    }
    if (value.scheduledDate && value.completedDate && value.scheduledDate > value.completedDate) {
      ctx.addIssue({ code: 'custom', path: ['completedDate'], message: 'A realização não pode ser anterior ao agendamento.' });
    }
  });
  const qsms = z.object({
    action: z.literal('qsms'),
    version,
    correctionStage,
    verified: z.boolean().nullable().optional(),
    verificationNote: z.string().trim().max(2000, 'O registro deve ter no máximo 2000 caracteres.').nullable().optional()
  }).strict().superRefine((value, ctx) => {
    if (!Object.hasOwn(value, 'verified') && !Object.hasOwn(value, 'verificationNote')) {
      ctx.addIssue({ code: 'custom', message: 'Informe ao menos uma alteração do QSMS.' });
    }
  });
  const transportVehicleType = z.string().trim().max(40).nullable().optional();
  const transportQuantity = z.coerce.number().int('Informe um número inteiro.').min(1, 'Informe ao menos 1.').max(99, 'Informe até 99.').nullable().optional();
  const travel = z.object({
    action: z.literal('travel'),
    version,
    correctionStage,
    lodgingRequestedDate: dateOnly.nullable().optional(),
    lodgingConfirmedDate: dateOnly.nullable().optional(),
    teamTransportDefined: z.boolean().nullable().optional(),
    teamTransportMode: z.enum(PROJECT_WORKFLOW_TRANSPORT_MODES).nullable().optional(),
    teamTransportVehicleType: transportVehicleType,
    teamTransportQuantity: transportQuantity,
    freightDefined: z.boolean().nullable().optional(),
    freightMode: z.enum(PROJECT_WORKFLOW_TRANSPORT_MODES).nullable().optional(),
    freightVehicleType: transportVehicleType,
    freightQuantity: transportQuantity,
    freightDepartureDate: dateOnly.nullable().optional(),
    freightDepartureTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Informe um horário válido.').nullable().optional()
  }).strict().superRefine((value, ctx) => {
    const fields = [
      'lodgingRequestedDate', 'lodgingConfirmedDate',
      'teamTransportDefined', 'teamTransportMode', 'teamTransportVehicleType', 'teamTransportQuantity',
      'freightDefined', 'freightMode', 'freightVehicleType', 'freightQuantity',
      'freightDepartureDate', 'freightDepartureTime'
    ];
    if (!fields.some(key => Object.hasOwn(value, key))) {
      ctx.addIssue({ code: 'custom', message: 'Informe ao menos uma alteração de viagem e logística.' });
    }
    if (value.lodgingRequestedDate && value.lodgingConfirmedDate && value.lodgingRequestedDate > value.lodgingConfirmedDate) {
      ctx.addIssue({ code: 'custom', path: ['lodgingConfirmedDate'], message: 'A confirmação não pode ser anterior à solicitação.' });
    }
    // Locação de carro não tem tipo de veículo; Nosso/Frete exigem um tipo do catálogo daquele modo.
    const checkVehicleType = (mode, vehicleType, path) => {
      if (!mode || !vehicleType) return;
      const catalog = PROJECT_WORKFLOW_TRANSPORT_VEHICLE_TYPES[mode];
      if (!catalog) ctx.addIssue({ code: 'custom', path, message: 'Locação de carro não tem tipo de veículo.' });
      else if (!catalog.includes(vehicleType)) ctx.addIssue({ code: 'custom', path, message: 'Tipo de veículo inválido para o modo escolhido.' });
    };
    if (Object.hasOwn(value, 'teamTransportVehicleType')) checkVehicleType(value.teamTransportMode, value.teamTransportVehicleType, ['teamTransportVehicleType']);
    if (Object.hasOwn(value, 'freightVehicleType')) checkVehicleType(value.freightMode, value.freightVehicleType, ['freightVehicleType']);
  });
  const critical = z.object({
    action: z.literal('critical'),
    version,
    correctionStage,
    key: z.enum(PROJECT_WORKFLOW_CRITICAL_QUESTIONS.map(item => item.key)),
    answer: z.boolean()
  }).strict();
  const analysisContact = z.object({
    action: z.literal('analysis_contact'),
    version,
    correctionStage,
    made: z.boolean(),
    contactName: z.string().trim().max(160, 'O nome do contato deve ter no máximo 160 caracteres.').nullable().optional(),
    contactPhone: z.string().trim().max(40, 'O telefone do contato deve ter no máximo 40 caracteres.').nullable().optional(),
    contactDate: dateOnly.nullable().optional()
  }).strict().superRefine((value, ctx) => {
    if (!value.made) return;
    if (!value.contactName?.trim()) ctx.addIssue({ code: 'custom', path: ['contactName'], message: 'Informe o nome do contato.' });
    if (!value.contactPhone?.trim()) ctx.addIssue({ code: 'custom', path: ['contactPhone'], message: 'Informe o telefone do contato.' });
    if (!value.contactDate) ctx.addIssue({ code: 'custom', path: ['contactDate'], message: 'Informe a data do contato.' });
  });
  const analysisSchedule = z.object({
    action: z.literal('analysis_schedule'),
    version,
    correctionStage,
    plannedExecutionStartDate: dateOnly.nullable(),
    plannedExecutionEndDate: dateOnly.nullable()
  }).strict().superRefine((value, ctx) => {
    if (value.plannedExecutionStartDate && value.plannedExecutionEndDate && value.plannedExecutionEndDate < value.plannedExecutionStartDate) {
      ctx.addIssue({ code: 'custom', path: ['plannedExecutionEndDate'], message: 'O fim da execução não pode ser anterior ao início.' });
    }
  });
  const analysisCriticality = z.object({
    action: z.literal('analysis_criticality'),
    version,
    correctionStage,
    isCritical: z.boolean(),
    preparationLeadTimeDays: z.coerce.number().int('Informe um número inteiro de dias.').min(15, 'A preparação deve começar com ao menos 15 dias de antecedência.').optional()
  }).strict().superRefine((value, ctx) => {
    if (value.isCritical && value.preparationLeadTimeDays == null) {
      ctx.addIssue({ code: 'custom', path: ['preparationLeadTimeDays'], message: 'Informe a antecedência de preparação da obra crítica.' });
    }
  });
  const analysisLocation = z.object({
    action: z.literal('analysis_location'),
    version,
    correctionStage,
    executedAtHeadquarters: z.boolean()
  }).strict();
  const teamPlan = z.object({
    action: z.literal('team_plan'),
    version,
    correctionStage,
    defined: z.boolean(),
    demands: z.array(z.object({
      jobRoleId: id,
      requiredCount: z.coerce.number().int().min(1, 'Informe ao menos uma pessoa.').max(1000, 'A quantidade deve ser de no máximo 1000 pessoas.')
    }).strict()).max(100, 'Selecione no máximo 100 cargos.').default([])
  }).strict().superRefine((value, ctx) => {
    if (new Set(value.demands.map(item => item.jobRoleId)).size !== value.demands.length) {
      ctx.addIssue({ code: 'custom', path: ['demands'], message: 'Cada cargo deve aparecer uma única vez.' });
    }
    if (value.defined && value.demands.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['demands'], message: 'Adicione ao menos um cargo para confirmar a equipe.' });
    }
  });
  const equipmentPlan = z.object({
    action: z.literal('equipment_plan'),
    version,
    correctionStage,
    defined: z.boolean(),
    selections: z.array(z.object({
      categoryId: id,
      equipmentIds: z.array(id).min(1, 'Selecione ao menos um equipamento da categoria.').max(500, 'Selecione no máximo 500 equipamentos por categoria.'),
      exceptions: z.array(z.object({
        equipmentId: id,
        reason: z.string().trim().min(3, 'Descreva a exceção com ao menos 3 caracteres.').max(1000, 'A justificativa deve ter no máximo 1000 caracteres.')
      }).strict()).max(500).default([])
    }).strict()).max(100, 'Selecione no máximo 100 categorias.').default([])
  }).strict().superRefine((value, ctx) => {
    if (new Set(value.selections.map(item => item.categoryId)).size !== value.selections.length) {
      ctx.addIssue({ code: 'custom', path: ['selections'], message: 'Cada categoria deve aparecer uma única vez.' });
    }
    const equipmentIds = value.selections.flatMap(item => item.equipmentIds);
    if (new Set(equipmentIds).size !== equipmentIds.length) {
      ctx.addIssue({ code: 'custom', path: ['selections'], message: 'Cada equipamento deve aparecer uma única vez.' });
    }
    value.selections.forEach((selection, selectionIndex) => {
      const selectedIds = new Set(selection.equipmentIds);
      selection.exceptions.forEach((exception, exceptionIndex) => {
        if (!selectedIds.has(exception.equipmentId)) {
          ctx.addIssue({ code: 'custom', path: ['selections', selectionIndex, 'exceptions', exceptionIndex, 'equipmentId'], message: 'A exceção deve pertencer a um equipamento selecionado.' });
        }
      });
    });
    if (value.defined && value.selections.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['selections'], message: 'Selecione ao menos uma categoria e um equipamento para confirmar o planejamento.' });
    }
  });
  const supplyPlan = z.object({
    action: z.literal('supply_plan'),
    version,
    correctionStage,
    defined: z.boolean(),
    items: z.array(z.object({
      id: z.string().trim().min(1, 'Informe o insumo.').max(120),
      stockItemId: id.nullable(),
      type: z.enum(['FILTRO', 'PRODUTO_QUIMICO']),
      name: z.string().trim().min(1, 'Informe o nome do insumo.').max(240),
      unitLabel: z.string().trim().min(1, 'Informe a unidade.').max(30),
      requiredQuantity: z.coerce.number().finite().positive('Informe uma quantidade maior que zero.').max(999999999, 'A quantidade excede o limite permitido.'),
      requestedAt: dateOnly.nullable(),
      purchasedAt: dateOnly.nullable(),
      reservationExceptionReason: z.string().trim().min(3, 'Descreva a exceção com ao menos 3 caracteres.').max(1000, 'A justificativa deve ter no máximo 1000 caracteres.').nullable().optional()
    }).strict()).max(500, 'Selecione no máximo 500 insumos.').default([])
  }).strict().superRefine((value, ctx) => {
    if (new Set(value.items.map(item => item.id)).size !== value.items.length) {
      ctx.addIssue({ code: 'custom', path: ['items'], message: 'Cada insumo deve aparecer uma única vez.' });
    }
    const stockIds = value.items.map(item => item.stockItemId).filter(Boolean);
    if (new Set(stockIds).size !== stockIds.length) {
      ctx.addIssue({ code: 'custom', path: ['items'], message: 'Cada item do estoque deve aparecer uma única vez.' });
    }
    if (value.defined && value.items.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['items'], message: 'Selecione ou adicione ao menos um insumo para confirmar o planejamento.' });
    }
    value.items.forEach((item, index) => {
      if (item.purchasedAt && !item.requestedAt) {
        ctx.addIssue({ code: 'custom', path: ['items', index, 'requestedAt'], message: 'Informe a data da solicitação antes da compra.' });
      }
      if (item.requestedAt && item.purchasedAt && item.requestedAt > item.purchasedAt) {
        ctx.addIssue({ code: 'custom', path: ['items', index, 'purchasedAt'], message: 'A compra não pode ser anterior à solicitação.' });
      }
    });
  });
  const logisticsPlan = z.object({
    action: z.literal('logistics_plan'),
    version,
    correctionStage,
    vehicleRequired: z.boolean().nullable(),
    vehicleQuantity: z.coerce.number().int().min(1, 'Informe ao menos um veículo.').max(100, 'A quantidade deve ser de no máximo 100 veículos.').nullable(),
    vehicleType: z.enum(['CARRO', 'CAMINHAO']).nullable(),
    freightRequired: z.boolean().nullable(),
    lodgingRequired: z.boolean().nullable(),
    lodgingPeopleCount: z.coerce.number().int().min(1, 'Informe ao menos uma pessoa.').max(1000, 'A quantidade deve ser de no máximo 1000 pessoas.').nullable(),
    lodgingExpectedDate: dateOnly.nullable(),
    lodgingRequested: z.boolean().nullable(),
    lodgingRequestedAt: dateOnly.nullable(),
    lodgingCompletedAt: dateOnly.nullable()
  }).strict().superRefine((value, ctx) => {
    if (value.lodgingRequestedAt && value.lodgingCompletedAt && value.lodgingRequestedAt > value.lodgingCompletedAt) {
      ctx.addIssue({ code: 'custom', path: ['lodgingCompletedAt'], message: 'A conclusão não pode ser anterior à solicitação.' });
    }
  });
  const documentationCategory = z.object({
    action: z.literal('documentation_category'),
    version,
    correctionStage,
    type: z.enum(PROJECT_WORKFLOW_DOCUMENTATION_TYPES),
    required: z.boolean()
  }).strict();
  const documentationRequirementCreate = z.object({
    action: z.literal('documentation_requirement_create'),
    version,
    correctionStage,
    type: z.enum(PROJECT_WORKFLOW_DOCUMENTATION_TYPES),
    name: z.string().trim().min(1, 'Informe o nome.').max(240, 'O nome deve ter no máximo 240 caracteres.')
  }).strict();
  const documentationRequirementUpdate = z.object({
    action: z.literal('documentation_requirement_update'),
    version,
    correctionStage,
    requirementId: id,
    name: z.string().trim().min(1, 'Informe o nome.').max(240, 'O nome deve ter no máximo 240 caracteres.').optional(),
    status: z.enum(PROJECT_WORKFLOW_DOCUMENTATION_STATUSES).optional(),
    requestedAt: dateOnly.nullable().optional(),
    confirmedAt: dateOnly.nullable().optional()
  }).strict().superRefine((value, ctx) => {
    if (!['name', 'status', 'requestedAt', 'confirmedAt'].some(key => Object.hasOwn(value, key))) {
      ctx.addIssue({ code: 'custom', message: 'Informe ao menos uma alteração.' });
    }
    if (value.requestedAt && value.confirmedAt && value.requestedAt > value.confirmedAt) {
      ctx.addIssue({ code: 'custom', path: ['confirmedAt'], message: 'A confirmação não pode ser anterior à solicitação.' });
    }
  });
  const documentationRequirementArchive = z.object({
    action: z.literal('documentation_requirement_archive'),
    version,
    correctionStage,
    requirementId: id,
    archived: z.boolean()
  }).strict();
  const issue = z.object({
    action: z.literal('issue'),
    version,
    correctionStage,
    issueId: id,
    description: z.string().trim().min(1, 'Informe a pendência.').max(500),
    ownerName: z.string().trim().max(160).nullable(),
    requiredLeadTimeDays: z.coerce.number().int().min(1, 'Informe ao menos um dia.').max(3650, 'O prazo necessário deve ter no máximo 3650 dias.').nullable(),
    dueDate: dateOnly.nullable(),
    criticality: z.enum(PROJECT_WORKFLOW_CRITICALITIES),
    status: z.enum(PROJECT_WORKFLOW_ISSUE_STATUSES)
  }).strict();
  const accept = z.object({ action: z.literal('accept'), version }).strict();
  const stage = z.object({
    action: z.literal('stage'),
    version,
    stage: z.enum(PROJECT_WORKFLOW_STAGES),
    reason: z.string().trim().min(3, 'Informe uma justificativa com ao menos 3 caracteres.').max(1000, 'A justificativa deve ter no máximo 1000 caracteres.').optional()
  }).strict();
  const demobilization = z.object({
    action: z.literal('demobilization'),
    version,
    correctionStage,
    mobilizationDate: dateOnly.nullable().optional(),
    fieldCompletionDate: dateOnly.nullable().optional(),
    returnDate: dateOnly.nullable().optional()
  }).strict().refine(value => Object.hasOwn(value, 'mobilizationDate') || Object.hasOwn(value, 'fieldCompletionDate') || Object.hasOwn(value, 'returnDate'), {
    message: 'Informe ao menos uma data para alterar.'
  }).refine(value => !value.returnDate || value.mobilizationDate !== null, {
    path: ['mobilizationDate'],
    message: 'Informe a mobilização no cronograma antes da desmobilização.'
  }).refine(value => !value.mobilizationDate || !value.returnDate || value.mobilizationDate <= value.returnDate, {
    path: ['returnDate'],
    message: 'A desmobilização não pode ser anterior à mobilização.'
  }).refine(value => !value.fieldCompletionDate || !value.returnDate || value.fieldCompletionDate <= value.returnDate, {
    path: ['returnDate'],
    message: 'A desmobilização não pode ser anterior à conclusão de campo.'
  });
  const postJobText = z.string().trim().max(4000, 'O texto deve ter no máximo 4000 caracteres.').nullable().optional();
  const postJob = z.object({
    action: z.literal('post_job'),
    version,
    correctionStage,
    meetingDate: dateOnly.nullable().optional(),
    fieldLeaderFeedback: postJobText,
    teamFeedback: postJobText,
    problemsFound: postJobText,
    solutionsAdopted: postJobText,
    improvementOpportunities: postJobText,
    lessonsLearned: postJobText,
    equipmentFeedback: postJobText,
    planningFeedback: postJobText
  }).strict().refine(value => [
    'meetingDate',
    'fieldLeaderFeedback',
    'teamFeedback',
    'problemsFound',
    'solutionsAdopted',
    'improvementOpportunities',
    'lessonsLearned',
    'equipmentFeedback',
    'planningFeedback'
  ].some(key => Object.hasOwn(value, key)), {
    message: 'Informe ao menos um dado do pós-job para alterar.'
  });
  const measurementText = z.string().trim().max(4000, 'O texto deve ter no máximo 4000 caracteres.').nullable().optional();
  const measurementAmount = z.coerce.number().finite().min(0, 'O valor não pode ser negativo.').max(999999999999.99, 'O valor excede o limite permitido.').nullable().optional();
  const measurement = z.object({
    action: z.literal('measurement'),
    version,
    correctionStage,
    quantitiesSummary: measurementText,
    additionalServicesNote: measurementText,
    evidenceNote: measurementText,
    executedAmount: measurementAmount,
    measuredAmount: measurementAmount,
    approvedAmount: measurementAmount,
    preparedAt: dateOnly.nullable().optional(),
    sentAt: dateOnly.nullable().optional(),
    approvedAt: dateOnly.nullable().optional()
  }).strict().superRefine((value, ctx) => {
    const fields = ['quantitiesSummary', 'additionalServicesNote', 'evidenceNote', 'executedAmount', 'measuredAmount', 'approvedAmount', 'preparedAt', 'sentAt', 'approvedAt'];
    if (!fields.some(key => Object.hasOwn(value, key))) ctx.addIssue({ code: 'custom', message: 'Informe ao menos um dado da medição para alterar.' });
    if (value.executedAmount != null && value.measuredAmount != null && value.measuredAmount > value.executedAmount) {
      ctx.addIssue({ code: 'custom', path: ['measuredAmount'], message: 'O valor medido não pode ser maior que o executado.' });
    }
    if (value.measuredAmount != null && value.approvedAmount != null && value.approvedAmount > value.measuredAmount) {
      ctx.addIssue({ code: 'custom', path: ['approvedAmount'], message: 'O valor aprovado não pode ser maior que o medido.' });
    }
    if (value.preparedAt && value.sentAt && value.preparedAt > value.sentAt) {
      ctx.addIssue({ code: 'custom', path: ['sentAt'], message: 'O envio não pode ser anterior à preparação.' });
    }
    if (value.sentAt && value.approvedAt && value.sentAt > value.approvedAt) {
      ctx.addIssue({ code: 'custom', path: ['approvedAt'], message: 'A aprovação não pode ser anterior ao envio.' });
    }
    if (value.preparedAt && value.approvedAt && value.preparedAt > value.approvedAt) {
      ctx.addIssue({ code: 'custom', path: ['approvedAt'], message: 'A aprovação não pode ser anterior à preparação.' });
    }
  });
  return {
    start,
    postJob,
    measurement,
    patch: z.discriminatedUnion('action', [settings, checklist, teamMemberCheck, preparationItemCheck, clientAttendance, clientRelease, preJob, qsms, travel, critical, analysisContact, analysisSchedule, analysisCriticality, analysisLocation, teamPlan, equipmentPlan, supplyPlan, logisticsPlan, documentationCategory, documentationRequirementCreate, documentationRequirementUpdate, documentationRequirementArchive, issue, accept, stage, demobilization, postJob, measurement]),
    list: z.object({
      search: z.string().trim().max(120).optional(),
      page: z.coerce.number().int().min(1).default(1)
    }).strict()
  };
}

export function projectWorkflowMilestones(plannedMobilizationDate, today, preparationLeadTimeDays = 15) {
  const normalizedPreparationDays = Number.isInteger(Number(preparationLeadTimeDays)) && Number(preparationLeadTimeDays) >= 15
    ? Number(preparationLeadTimeDays)
    : 15;
  const empty = {
    daysUntilMobilization: null,
    items: [],
    dueMilestones: [],
    nextMilestone: null,
    d30Date: null,
    d30Due: false,
    preparationLeadTimeDays: normalizedPreparationDays,
    preparationDate: null,
    preparationDue: false
  };
  if (!plannedMobilizationDate) return empty;
  const start = Date.parse(`${today}T00:00:00.000Z`);
  const mobilization = Date.parse(`${plannedMobilizationDate}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(mobilization)) return empty;
  const dayMs = 86_400_000;
  const daysUntilMobilization = Math.round((mobilization - start) / dayMs);
  const items = [...new Set([90, 30, normalizedPreparationDays, 7, 1])]
    .sort((left, right) => right - left)
    .flatMap(days => {
      const date = new Date(mobilization - days * dayMs);
      if (Number.isNaN(date.getTime())) return [];
      const dateKey = date.toISOString().slice(0, 10);
      return [{ key: `D${days}`, label: `D-${days}`, days, date: dateKey, due: today >= dateKey }];
    });
  const dueMilestones = items.filter(item => item.due).map(item => item.key);
  const nextMilestone = items.find(item => !item.due) || null;
  const d30 = items.find(item => item.key === 'D30');
  const preparation = items.find(item => item.days === normalizedPreparationDays);
  return {
    daysUntilMobilization,
    items,
    dueMilestones,
    nextMilestone,
    d30Date: d30?.date || null,
    d30Due: d30?.due || false,
    preparationLeadTimeDays: normalizedPreparationDays,
    preparationDate: preparation?.date || null,
    preparationDue: preparation?.due || false
  };
}
