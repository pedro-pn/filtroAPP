export const PROJECT_WORKFLOW_STAGES = [
  'HANDOVER',
  'INITIAL_ANALYSIS',
  'WAITING_PLANNING',
  'MOBILIZATION_PLANNING',
  'PREPARATION',
  'READY_TO_MOBILIZE',
  'MOBILIZATION',
  'EXECUTION'
];

export const PROJECT_WORKFLOW_STAGE_LABELS = {
  HANDOVER: 'Handover comercial',
  INITIAL_ANALYSIS: 'Análise inicial',
  WAITING_PLANNING: 'Aguardando planejamento',
  MOBILIZATION_PLANNING: 'Planejamento da mobilização',
  PREPARATION: 'Preparação',
  READY_TO_MOBILIZE: 'Pronto para mobilizar',
  MOBILIZATION: 'Mobilização',
  EXECUTION: 'Em execução'
};

export const PROJECT_WORKFLOW_CHECKLIST_SECTIONS = [
  'HANDOVER',
  'INITIAL_ANALYSIS',
  'ADVANCE_DOCUMENTATION',
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
  'D15_QSMS'
];

export const PROJECT_WORKFLOW_CHECKLIST_SECTION_LABELS = {
  HANDOVER: 'Checklist do handover',
  INITIAL_ANALYSIS: 'Checklist da análise inicial',
  ADVANCE_DOCUMENTATION: 'Documentação antecipada',
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
  D15_QSMS: 'QSMS'
};

const checklist = (key, stage, section, label, areaRoles = []) => ({ key, stage, section, label, areaRoles });

export const PROJECT_WORKFLOW_CHECKLISTS = [
  checklist('HANDOVER_PROJECT_CREATED', 'HANDOVER', 'HANDOVER', 'Projeto criado no sistema'),
  checklist('HANDOVER_LEADER_DEFINED', 'HANDOVER', 'HANDOVER', 'Líder de Projetos definido'),
  checklist('HANDOVER_WHATSAPP_GROUP', 'HANDOVER', 'HANDOVER', 'Grupo de WhatsApp criado pelo Comercial'),
  checklist('HANDOVER_PROJECT_PARTICIPANTS', 'HANDOVER', 'HANDOVER', 'Áreas e demais envolvidos incluídos no grupo'),
  checklist('HANDOVER_COMMERCIAL_PROPOSAL', 'HANDOVER', 'HANDOVER', 'Proposta comercial anexada'),
  checklist('HANDOVER_TECHNICAL_PROPOSAL', 'HANDOVER', 'HANDOVER', 'Proposta técnica anexada'),
  checklist('HANDOVER_SOURCE_DOCUMENTS', 'HANDOVER', 'HANDOVER', 'Documentos, desenhos e especificações da proposta anexados'),
  checklist('HANDOVER_CLIENT_CONTACT', 'HANDOVER', 'HANDOVER', 'Contato responsável do cliente informado'),
  checklist('HANDOVER_EXPECTED_START', 'HANDOVER', 'HANDOVER', 'Data prevista de início informada'),
  checklist('HANDOVER_EXPECTED_DURATION', 'HANDOVER', 'HANDOVER', 'Prazo previsto informado'),
  checklist('HANDOVER_RELEVANT_ASSUMPTIONS', 'HANDOVER', 'HANDOVER', 'Condições e premissas relevantes repassadas'),
  checklist('ANALYSIS_TECHNICAL_PROPOSAL', 'INITIAL_ANALYSIS', 'INITIAL_ANALYSIS', 'Proposta técnica revisada'),
  checklist('ANALYSIS_COMMERCIAL_PROPOSAL', 'INITIAL_ANALYSIS', 'INITIAL_ANALYSIS', 'Proposta comercial revisada'),
  checklist('ANALYSIS_SCOPE', 'INITIAL_ANALYSIS', 'INITIAL_ANALYSIS', 'Escopo e quantitativos compreendidos'),
  checklist('ANALYSIS_ASSUMPTIONS', 'INITIAL_ANALYSIS', 'INITIAL_ANALYSIS', 'Premissas e exclusões identificadas'),
  checklist('ANALYSIS_RESPONSIBILITIES', 'INITIAL_ANALYSIS', 'INITIAL_ANALYSIS', 'Responsabilidades Filtrovali e cliente identificadas'),
  checklist('ANALYSIS_DATES', 'INITIAL_ANALYSIS', 'INITIAL_ANALYSIS', 'Mobilização e início estimados'),
  checklist('ANALYSIS_COMMERCIAL_QUESTIONS', 'INITIAL_ANALYSIS', 'INITIAL_ANALYSIS', 'Dúvidas comerciais levantadas e esclarecidas'),
  checklist('ANALYSIS_CLIENT_CONTACT', 'INITIAL_ANALYSIS', 'INITIAL_ANALYSIS', 'Contato inicial com cliente realizado, quando necessário'),

  checklist('DOCUMENT_CLIENT_REQUIREMENTS', null, 'ADVANCE_DOCUMENTATION', 'Requisitos documentais do cliente levantados', ['efetivo:administrative']),
  checklist('DOCUMENT_STANDARD_VERIFIED', null, 'ADVANCE_DOCUMENTATION', 'Documentação padrão verificada', ['efetivo:administrative']),
  checklist('DOCUMENT_EXAMS_IDENTIFIED', null, 'ADVANCE_DOCUMENTATION', 'Exames específicos identificados', ['efetivo:administrative']),
  checklist('DOCUMENT_TRAININGS_IDENTIFIED', null, 'ADVANCE_DOCUMENTATION', 'Treinamentos específicos identificados', ['efetivo:administrative']),
  checklist('DOCUMENT_CERTIFICATIONS_IDENTIFIED', null, 'ADVANCE_DOCUMENTATION', 'Certificações específicas identificadas', ['efetivo:administrative']),
  checklist('DOCUMENT_LEAD_TIME_IDENTIFIED', null, 'ADVANCE_DOCUMENTATION', 'Prazo necessário para regularização identificado', ['efetivo:administrative']),
  checklist('DOCUMENT_PEOPLE_QUANTITY_DEFINED', null, 'ADVANCE_DOCUMENTATION', 'Quantidade de pessoas necessária definida', ['efetivo:administrative']),
  checklist('DOCUMENT_POTENTIAL_TEAM_DEFINED', null, 'ADVANCE_DOCUMENTATION', 'Grupo potencial de colaboradores definido com Operações', ['efetivo:administrative']),
  checklist('DOCUMENT_EXAMS_REQUESTED', null, 'ADVANCE_DOCUMENTATION', 'Exames solicitados', ['efetivo:administrative']),
  checklist('DOCUMENT_TRAININGS_REQUESTED', null, 'ADVANCE_DOCUMENTATION', 'Treinamentos solicitados', ['efetivo:administrative']),
  checklist('DOCUMENT_REGULARIZED', null, 'ADVANCE_DOCUMENTATION', 'Documentações regularizadas', ['efetivo:administrative']),

  checklist('D30_TEAM_QUANTITY_CONFIRMED', 'MOBILIZATION_PLANNING', 'D30_TEAM', 'Quantidade de pessoas confirmada', ['efetivo:operations']),
  checklist('D30_TEAM_ROLES_DEFINED', 'MOBILIZATION_PLANNING', 'D30_TEAM', 'Funções definidas', ['efetivo:operations']),
  checklist('D30_TEAM_PRELIMINARY_DEFINED', 'MOBILIZATION_PLANNING', 'D30_TEAM', 'Equipe preliminar definida', ['efetivo:operations']),
  checklist('D30_TEAM_AVAILABILITY_CHECKED', 'MOBILIZATION_PLANNING', 'D30_TEAM', 'Disponibilidade verificada', ['efetivo:operations']),
  checklist('D30_TEAM_HIRING_IDENTIFIED', 'MOBILIZATION_PLANNING', 'D30_TEAM', 'Necessidade de contratação identificada', ['efetivo:operations']),
  checklist('D30_TEAM_DOCUMENTS_CHECKED', 'MOBILIZATION_PLANNING', 'D30_TEAM', 'Documentação da equipe conferida', ['efetivo:operations']),

  checklist('D30_EQUIPMENT_LIST_DEFINED', 'MOBILIZATION_PLANNING', 'D30_EQUIPMENT', 'Lista de equipamentos definida', ['efetivo:assets']),
  checklist('D30_EQUIPMENT_LOCATION_CHECKED', 'MOBILIZATION_PLANNING', 'D30_EQUIPMENT', 'Localização atual dos equipamentos verificada', ['efetivo:assets']),
  checklist('D30_EQUIPMENT_AVAILABILITY_CONFIRMED', 'MOBILIZATION_PLANNING', 'D30_EQUIPMENT', 'Disponibilidade para a data confirmada', ['efetivo:assets']),
  checklist('D30_EQUIPMENT_OTHER_PROJECTS_IDENTIFIED', 'MOBILIZATION_PLANNING', 'D30_EQUIPMENT', 'Equipamentos que estão em outras obras identificados', ['efetivo:assets']),
  checklist('D30_EQUIPMENT_RETURN_CONFIRMED', 'MOBILIZATION_PLANNING', 'D30_EQUIPMENT', 'Data prevista de retorno confirmada', ['efetivo:assets']),
  checklist('D30_EQUIPMENT_MAINTENANCE_IDENTIFIED', 'MOBILIZATION_PLANNING', 'D30_EQUIPMENT', 'Manutenções necessárias identificadas', ['efetivo:assets']),
  checklist('D30_EQUIPMENT_CERTIFICATES_CHECKED', 'MOBILIZATION_PLANNING', 'D30_EQUIPMENT', 'Calibrações e certificações verificadas', ['efetivo:assets']),
  checklist('D30_EQUIPMENT_ACCESSORIES_DEFINED', 'MOBILIZATION_PLANNING', 'D30_EQUIPMENT', 'Acessórios necessários definidos', ['efetivo:assets']),

  checklist('D30_MATERIALS_LIST_DEFINED', 'MOBILIZATION_PLANNING', 'D30_MATERIALS', 'Lista de insumos definida', ['efetivo:supplies']),
  checklist('D30_MATERIALS_QUANTITIES_DEFINED', 'MOBILIZATION_PLANNING', 'D30_MATERIALS', 'Quantidades definidas', ['efetivo:supplies']),
  checklist('D30_MATERIALS_INVENTORY_CHECKED', 'MOBILIZATION_PLANNING', 'D30_MATERIALS', 'Estoque consultado', ['efetivo:supplies']),
  checklist('D30_MATERIALS_PURCHASES_IDENTIFIED', 'MOBILIZATION_PLANNING', 'D30_MATERIALS', 'Necessidades de compra identificadas', ['efetivo:supplies']),
  checklist('D30_MATERIALS_QUOTES_REQUESTED', 'MOBILIZATION_PLANNING', 'D30_MATERIALS', 'Orçamentos solicitados', ['efetivo:supplies']),
  checklist('D30_MATERIALS_PURCHASES_REQUESTED', 'MOBILIZATION_PLANNING', 'D30_MATERIALS', 'Compras solicitadas', ['efetivo:supplies']),

  checklist('D30_LOGISTICS_VEHICLE_DEFINED', 'MOBILIZATION_PLANNING', 'D30_LOGISTICS', 'Necessidade de veículo definida', ['efetivo:operations']),
  checklist('D30_LOGISTICS_FREIGHT_IDENTIFIED', 'MOBILIZATION_PLANNING', 'D30_LOGISTICS', 'Necessidade de frete identificada', ['efetivo:operations']),
  checklist('D30_LOGISTICS_LODGING_DEFINED', 'MOBILIZATION_PLANNING', 'D30_LOGISTICS', 'Necessidade de hospedagem definida', ['efetivo:operations']),
  checklist('D30_LOGISTICS_PEOPLE_DAYS_ESTIMATED', 'MOBILIZATION_PLANNING', 'D30_LOGISTICS', 'Quantidade de pessoas e dias estimada', ['efetivo:operations']),
  checklist('D30_LOGISTICS_DEPARTURE_DEFINED', 'MOBILIZATION_PLANNING', 'D30_LOGISTICS', 'Data prevista de saída definida', ['efetivo:operations']),

  checklist('D15_TEAM_DEFINITIVE_CONFIRMED', 'PREPARATION', 'D15_TEAM', 'Equipe definitiva confirmada com o Gerente de Operações', ['efetivo:operations']),
  checklist('D15_TEAM_COLLABORATORS_NOTIFIED', 'PREPARATION', 'D15_TEAM', 'Colaboradores comunicados', ['efetivo:operations']),
  checklist('D15_TEAM_INDIVIDUAL_DOCUMENTS_CHECKED', 'PREPARATION', 'D15_TEAM', 'Documentação individual conferida', ['efetivo:administrative']),
  checklist('D15_TEAM_EXAMS_RELEASED', 'PREPARATION', 'D15_TEAM', 'Exames liberados', ['efetivo:administrative']),
  checklist('D15_TEAM_TRAININGS_RELEASED', 'PREPARATION', 'D15_TEAM', 'Treinamentos liberados', ['efetivo:administrative']),

  checklist('D15_CLIENT_ATTENDANCE_CONFIRMED', 'PREPARATION', 'D15_CLIENT', 'Cliente confirmou o atendimento', ['efetivo:operations']),
  checklist('D15_CLIENT_REGISTRATION_REQUESTED', 'PREPARATION', 'D15_CLIENT', 'Cadastro no cliente solicitado', ['efetivo:administrative']),
  checklist('D15_CLIENT_DOCUMENTS_SENT', 'PREPARATION', 'D15_CLIENT', 'Documentação enviada ao cliente', ['efetivo:administrative']),
  checklist('D15_CLIENT_INTEGRATION_SCHEDULED', 'PREPARATION', 'D15_CLIENT', 'Integração solicitada ou agendada', ['efetivo:administrative']),
  checklist('D15_CLIENT_TEAM_RELEASED', 'PREPARATION', 'D15_CLIENT', 'Equipe liberada pelo cliente', ['efetivo:administrative', 'efetivo:operations']),

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
  checklist('D15_QSMS_RELEASE_CONFIRMED', 'PREPARATION', 'D15_QSMS', 'Liberação de QSMS confirmada, quando aplicável', ['efetivo:qsms'])
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
    issueDescription: 'Regularizar treinamentos, exames ou documentos específicos do cliente'
  }
];

export const PROJECT_WORKFLOW_CHECKLIST_STATUSES = ['PENDING', 'DONE', 'NOT_APPLICABLE'];
export const PROJECT_WORKFLOW_ISSUE_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];
export const PROJECT_WORKFLOW_CRITICALITIES = ['HIGH', 'MEDIUM', 'LOW'];

export const PROJECT_WORKFLOW_COMMERCIAL_FACT_STATUSES = ['PENDING', 'CONFIRMED', 'NOT_APPLICABLE'];
export const PROJECT_WORKFLOW_COMMERCIAL_FACT_SOURCES = ['MANUAL', 'CRM'];
export const PROJECT_WORKFLOW_COMMERCIAL_FACTS = [
  { key: 'COMMERCIAL_PROPOSAL_CREATED', label: 'Proposta comercial criada', allowNotApplicable: false, evidence: 'reference', handoverChecklistKey: 'HANDOVER_COMMERCIAL_PROPOSAL' },
  { key: 'TECHNICAL_PROPOSAL_CREATED', label: 'Proposta técnica criada', allowNotApplicable: false, evidence: 'reference', handoverChecklistKey: 'HANDOVER_TECHNICAL_PROPOSAL' },
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
  return z.object({
    action: z.literal('commercial_fact'),
    version: z.coerce.number().int().min(1, 'A versão deve ser positiva.'),
    key: z.enum(PROJECT_WORKFLOW_COMMERCIAL_FACTS.map(item => item.key)),
    status: z.enum(PROJECT_WORKFLOW_COMMERCIAL_FACT_STATUSES),
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
    if (definition?.evidence === 'reference' && !value.reference?.trim()) ctx.addIssue({ code: 'custom', path: ['reference'], message: 'Informe a referência ou número do documento.' });
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
  const critical = z.object({
    action: z.literal('critical'),
    version,
    key: z.enum(PROJECT_WORKFLOW_CRITICAL_QUESTIONS.map(item => item.key)),
    answer: z.boolean()
  }).strict();
  const issue = z.object({
    action: z.literal('issue'),
    version,
    issueId: id,
    description: z.string().trim().min(1, 'Informe a pendência.').max(500),
    area: z.string().trim().min(1, 'Informe a área responsável.').max(120),
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
    stage: z.enum(PROJECT_WORKFLOW_STAGES)
  }).strict();
  const authorizeMobilization = z.object({ action: z.literal('authorize_mobilization'), version }).strict();
  const commercialFact = makeProjectWorkflowCommercialFactSchema(z);
  return {
    start,
    patch: z.discriminatedUnion('action', [settings, checklist, critical, issue, accept, stage, authorizeMobilization, commercialFact]),
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
