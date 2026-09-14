export const PROJECT_WORKFLOW_STAGES = [
  'HANDOVER',
  'INITIAL_ANALYSIS',
  'WAITING_PLANNING',
  'MOBILIZATION_PLANNING',
  'PREPARATION',
  'READY_TO_MOBILIZE',
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
  READY_TO_MOBILIZE: 'Pronto para mobilizar',
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

export const PROJECT_WORKFLOW_CLIENT_RELEASE_KEYS = [
  'CUSTOMER_REGISTRATION',
  'DOCUMENTS_SENT',
  'INTEGRATION_REQUEST'
];

export const PROJECT_WORKFLOW_CLIENT_RELEASES = [
  { key: 'CUSTOMER_REGISTRATION', label: 'Cadastro no cliente', areaRoles: ['efetivo:administrative'] },
  { key: 'DOCUMENTS_SENT', label: 'Documentação enviada ao cliente', areaRoles: ['efetivo:administrative'] },
  { key: 'INTEGRATION_REQUEST', label: 'Solicitação de integração', areaRoles: ['efetivo:administrative'] }
];

const checklist = (key, stage, section, label, areaRoles = []) => ({ key, stage, section, label, areaRoles });

export const PROJECT_WORKFLOW_CHECKLISTS = [
  checklist('ANALYSIS_RESPONSIBILITIES', 'INITIAL_ANALYSIS', 'INITIAL_ANALYSIS', 'Responsabilidades Filtrovali e cliente identificadas'),
  checklist('ANALYSIS_COMMERCIAL_QUESTIONS', 'INITIAL_ANALYSIS', 'INITIAL_ANALYSIS', 'Dúvidas comerciais levantadas e esclarecidas'),

  checklist('D15_EQUIPMENT_RESERVED', 'PREPARATION', 'D15_EQUIPMENT', 'Equipamentos definitivamente reservados', ['efetivo:assets']),
  checklist('D15_EQUIPMENT_AVAILABLE_AT_BASE', 'PREPARATION', 'D15_EQUIPMENT', 'Equipamentos disponíveis na sede na data necessária', ['efetivo:assets']),
  checklist('D15_EQUIPMENT_MAINTENANCE_DONE', 'PREPARATION', 'D15_EQUIPMENT', 'Manutenção realizada', ['efetivo:assets']),
  checklist('D15_EQUIPMENT_TESTED', 'PREPARATION', 'D15_EQUIPMENT', 'Equipamentos testados', ['efetivo:assets']),
  checklist('D15_EQUIPMENT_CERTIFICATES_VALID', 'PREPARATION', 'D15_EQUIPMENT', 'Certificados e calibrações válidos', ['efetivo:assets']),
  checklist('D15_EQUIPMENT_ACCESSORIES_SEPARATED', 'PREPARATION', 'D15_EQUIPMENT', 'Acessórios separados', ['efetivo:assets']),
  checklist('D15_EQUIPMENT_PRE_MOBILIZATION_CHECKED', 'PREPARATION', 'D15_EQUIPMENT', 'Checklist pré-mobilização realizado', ['efetivo:assets']),

  checklist('D15_MATERIALS_SUPPLIES_RECEIVED', 'PREPARATION', 'D15_MATERIALS', 'Insumos recebidos', ['efetivo:supplies']),
  checklist('D15_MATERIALS_QUANTITIES_CHECKED', 'PREPARATION', 'D15_MATERIALS', 'Quantidades conferidas', ['efetivo:supplies']),
  checklist('D15_MATERIALS_SEPARATED', 'PREPARATION', 'D15_MATERIALS', 'Materiais separados', ['efetivo:supplies']),
  checklist('D15_MATERIALS_CHEMICALS_SEPARATED', 'PREPARATION', 'D15_MATERIALS', 'Produtos químicos separados', ['efetivo:supplies']),
  checklist('D15_MATERIALS_FILTERS_SEPARATED', 'PREPARATION', 'D15_MATERIALS', 'Filtros separados', ['efetivo:supplies']),
  checklist('D15_MATERIALS_CONSUMABLES_SEPARATED', 'PREPARATION', 'D15_MATERIALS', 'Consumíveis separados', ['efetivo:supplies']),

  checklist('D15_PRE_JOB_SCHEDULED', 'PREPARATION', 'D15_PRE_JOB', 'Pré-job agendado', ['efetivo:operations']),
  checklist('D15_PRE_JOB_SCOPE_PRESENTED', 'PREPARATION', 'D15_PRE_JOB', 'Escopo apresentado à equipe', ['efetivo:operations']),
  checklist('D15_PRE_JOB_PROPOSAL_REVIEWED', 'PREPARATION', 'D15_PRE_JOB', 'Proposta técnica e escopo revisados com a equipe', ['efetivo:operations']),
  checklist('D15_PRE_JOB_RESPONSIBILITIES_EXPLAINED', 'PREPARATION', 'D15_PRE_JOB', 'Responsabilidades explicadas', ['efetivo:operations']),
  checklist('D15_PRE_JOB_CRITICAL_POINTS_EXPLAINED', 'PREPARATION', 'D15_PRE_JOB', 'Pontos críticos explicados', ['efetivo:operations']),
  checklist('D15_PRE_JOB_SCHEDULE_PRESENTED', 'PREPARATION', 'D15_PRE_JOB', 'Cronograma apresentado', ['efetivo:operations']),
  checklist('D15_PRE_JOB_RISKS_PRESENTED', 'PREPARATION', 'D15_PRE_JOB', 'Riscos e particularidades apresentados', ['efetivo:operations', 'efetivo:qsms']),
  checklist('D15_PRE_JOB_FIELD_LEAD_DEFINED', 'PREPARATION', 'D15_PRE_JOB', 'Responsável de campo definido', ['efetivo:operations']),

  checklist('D15_TRAVEL_LODGING_REQUESTED', 'PREPARATION', 'D15_TRAVEL', 'Hospedagem solicitada ao Administrativo', ['efetivo:administrative']),
  checklist('D15_TRAVEL_LODGING_CONFIRMED', 'PREPARATION', 'D15_TRAVEL', 'Hospedagem confirmada', ['efetivo:administrative']),
  checklist('D15_TRAVEL_TEAM_TRANSPORT_DEFINED', 'PREPARATION', 'D15_TRAVEL', 'Transporte da equipe definido', ['efetivo:operations']),
  checklist('D15_TRAVEL_FREIGHT_REQUESTED', 'PREPARATION', 'D15_TRAVEL', 'Frete solicitado', ['efetivo:operations']),
  checklist('D15_TRAVEL_COMPANY_TRUCK_RESERVED', 'PREPARATION', 'D15_TRAVEL', 'Caminhão próprio reservado, quando aplicável', ['efetivo:operations']),
  checklist('D15_TRAVEL_DEPARTURE_CONFIRMED', 'PREPARATION', 'D15_TRAVEL', 'Data e hora da saída confirmadas', ['efetivo:operations']),

  checklist('D15_QSMS_REQUIREMENTS_CHECKED', 'PREPARATION', 'D15_QSMS', 'Requisitos de QSMS verificados', ['efetivo:qsms']),
  checklist('D15_QSMS_RELEASE_CONFIRMED', 'PREPARATION', 'D15_QSMS', 'Liberação de QSMS confirmada, quando aplicável', ['efetivo:qsms']),

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
  }
];

export const PROJECT_WORKFLOW_DOCUMENTATION_TYPES = ['DOCUMENT', 'EXAM', 'TRAINING', 'CERTIFICATION'];
export const PROJECT_WORKFLOW_DOCUMENTATION_STATUSES = ['PENDING', 'REQUESTED', 'CONFIRMED'];
export const PROJECT_WORKFLOW_DOCUMENTATION_DEFINITIONS = [
  { type: 'DOCUMENT', label: 'Documentos e cadastros adicionais', singularLabel: 'documento ou cadastro adicional', nameLabel: 'Nome do documento ou cadastro adicional' },
  { type: 'EXAM', label: 'Exames adicionais', singularLabel: 'exame adicional', nameLabel: 'Nome do exame adicional' },
  { type: 'TRAINING', label: 'Treinamentos adicionais', singularLabel: 'treinamento adicional', nameLabel: 'Nome do treinamento adicional' },
  { type: 'CERTIFICATION', label: 'Certificações adicionais', singularLabel: 'certificação adicional', nameLabel: 'Nome da certificação adicional' }
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
  const dateOnly = dateOnlySchema(z);
  const note = z.string().trim().max(1000, 'A observação deve ter no máximo 1000 caracteres.').nullable().optional();
  const start = z.object({
    leaderUserId: id,
    plannedMobilizationDate: dateOnly
  }).strict();
  const settings = z.object({
    action: z.literal('settings'),
    version,
    leaderUserId: id.optional(),
    plannedMobilizationDate: dateOnly.optional()
  }).strict().refine(value => value.leaderUserId || value.plannedMobilizationDate, 'Informe ao menos uma alteração.');
  const checklist = z.object({
    action: z.literal('checklist'),
    version,
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
    collaboratorId: id,
    key: z.enum(PROJECT_WORKFLOW_TEAM_MEMBER_CHECKS.map(item => item.key)),
    status: z.enum(['PENDING', 'DONE'])
  }).strict();
  const clientAttendance = z.object({
    action: z.literal('client_attendance'),
    version,
    attendanceDate: dateOnly
  }).strict();
  const clientRelease = z.object({
    action: z.literal('client_release'),
    version,
    key: z.enum(PROJECT_WORKFLOW_CLIENT_RELEASE_KEYS),
    requested: z.boolean(),
    requestedAt: dateOnly.nullable(),
    requestedTo: z.string().trim().max(160, 'O destinatário deve ter no máximo 160 caracteres.').nullable(),
    completed: z.boolean(),
    completedAt: dateOnly.nullable()
  }).strict().superRefine((value, ctx) => {
    if (value.completed && !value.requested) {
      ctx.addIssue({ code: 'custom', path: ['requested'], message: 'Registre a solicitação antes da conclusão.' });
    }
    if (value.requestedAt && value.completedAt && value.requestedAt > value.completedAt) {
      ctx.addIssue({ code: 'custom', path: ['completedAt'], message: 'A conclusão não pode ser anterior à solicitação.' });
    }
  });
  const critical = z.object({
    action: z.literal('critical'),
    version,
    key: z.enum(PROJECT_WORKFLOW_CRITICAL_QUESTIONS.map(item => item.key)),
    answer: z.boolean()
  }).strict();
  const analysisContact = z.object({
    action: z.literal('analysis_contact'),
    version,
    made: z.boolean(),
    contactName: z.string().trim().max(160, 'O nome do contato deve ter no máximo 160 caracteres.').nullable().optional(),
    contactDate: dateOnly.nullable().optional()
  }).strict().superRefine((value, ctx) => {
    if (!value.made) return;
    if (!value.contactName?.trim()) ctx.addIssue({ code: 'custom', path: ['contactName'], message: 'Informe o nome do contato.' });
    if (!value.contactDate) ctx.addIssue({ code: 'custom', path: ['contactDate'], message: 'Informe a data do contato.' });
  });
  const teamPlan = z.object({
    action: z.literal('team_plan'),
    version,
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
    defined: z.boolean(),
    selections: z.array(z.object({
      categoryId: id,
      equipmentIds: z.array(id).min(1, 'Selecione ao menos um equipamento da categoria.').max(500, 'Selecione no máximo 500 equipamentos por categoria.')
    }).strict()).max(100, 'Selecione no máximo 100 categorias.').default([])
  }).strict().superRefine((value, ctx) => {
    if (new Set(value.selections.map(item => item.categoryId)).size !== value.selections.length) {
      ctx.addIssue({ code: 'custom', path: ['selections'], message: 'Cada categoria deve aparecer uma única vez.' });
    }
    const equipmentIds = value.selections.flatMap(item => item.equipmentIds);
    if (new Set(equipmentIds).size !== equipmentIds.length) {
      ctx.addIssue({ code: 'custom', path: ['selections'], message: 'Cada equipamento deve aparecer uma única vez.' });
    }
    if (value.defined && value.selections.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['selections'], message: 'Selecione ao menos uma categoria e um equipamento para confirmar o planejamento.' });
    }
  });
  const supplyPlan = z.object({
    action: z.literal('supply_plan'),
    version,
    defined: z.boolean(),
    items: z.array(z.object({
      id: z.string().trim().min(1, 'Informe o insumo.').max(120),
      stockItemId: id.nullable(),
      type: z.enum(['FILTRO', 'PRODUTO_QUIMICO']),
      name: z.string().trim().min(1, 'Informe o nome do insumo.').max(240),
      unitLabel: z.string().trim().min(1, 'Informe a unidade.').max(30),
      requiredQuantity: z.coerce.number().finite().positive('Informe uma quantidade maior que zero.').max(999999999, 'A quantidade excede o limite permitido.'),
      requestedAt: dateOnly.nullable(),
      purchasedAt: dateOnly.nullable()
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
    type: z.enum(PROJECT_WORKFLOW_DOCUMENTATION_TYPES),
    required: z.boolean()
  }).strict();
  const documentationRequirementCreate = z.object({
    action: z.literal('documentation_requirement_create'),
    version,
    type: z.enum(PROJECT_WORKFLOW_DOCUMENTATION_TYPES),
    name: z.string().trim().min(1, 'Informe o nome.').max(240, 'O nome deve ter no máximo 240 caracteres.')
  }).strict();
  const documentationRequirementUpdate = z.object({
    action: z.literal('documentation_requirement_update'),
    version,
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
    requirementId: id,
    archived: z.boolean()
  }).strict();
  const issue = z.object({
    action: z.literal('issue'),
    version,
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
  const authorizeMobilization = z.object({ action: z.literal('authorize_mobilization'), version }).strict();
  return {
    start,
    postJob,
    measurement,
    patch: z.discriminatedUnion('action', [settings, checklist, teamMemberCheck, clientAttendance, clientRelease, critical, analysisContact, teamPlan, equipmentPlan, supplyPlan, logisticsPlan, documentationCategory, documentationRequirementCreate, documentationRequirementUpdate, documentationRequirementArchive, issue, accept, stage, demobilization, postJob, measurement, authorizeMobilization]),
    list: z.object({
      search: z.string().trim().max(120).optional(),
      page: z.coerce.number().int().min(1).default(1)
    }).strict()
  };
}

export function projectWorkflowMilestones(plannedMobilizationDate, today) {
  const empty = { daysUntilMobilization: null, items: [], dueMilestones: [], nextMilestone: null, d30Date: null, d30Due: false };
  if (!plannedMobilizationDate) return empty;
  const start = Date.parse(`${today}T00:00:00.000Z`);
  const mobilization = Date.parse(`${plannedMobilizationDate}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(mobilization)) return empty;
  const dayMs = 86_400_000;
  const daysUntilMobilization = Math.round((mobilization - start) / dayMs);
  const items = [90, 30, 15, 7, 1].map(days => {
    const date = new Date(mobilization - days * dayMs).toISOString().slice(0, 10);
    return { key: `D${days}`, label: `D-${days}`, days, date, due: today >= date };
  });
  const dueMilestones = items.filter(item => item.due).map(item => item.key);
  const nextMilestone = items.find(item => !item.due) || null;
  const d30 = items.find(item => item.key === 'D30');
  return { daysUntilMobilization, items, dueMilestones, nextMilestone, d30Date: d30.date, d30Due: d30.due };
}
