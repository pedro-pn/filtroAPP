export const PROJECT_WORKFLOW_STAGES = [
  'HANDOVER',
  'INITIAL_ANALYSIS',
  'WAITING_PLANNING',
  'MOBILIZATION_PLANNING'
];

export const PROJECT_WORKFLOW_STAGE_LABELS = {
  HANDOVER: 'Handover comercial',
  INITIAL_ANALYSIS: 'Análise inicial',
  WAITING_PLANNING: 'Aguardando planejamento',
  MOBILIZATION_PLANNING: 'Planejamento da mobilização'
};

export const PROJECT_WORKFLOW_CHECKLISTS = [
  { key: 'HANDOVER_PROJECT_CREATED', stage: 'HANDOVER', label: 'Projeto criado no sistema' },
  { key: 'HANDOVER_LEADER_DEFINED', stage: 'HANDOVER', label: 'Líder de Projetos definido' },
  { key: 'HANDOVER_WHATSAPP_GROUP', stage: 'HANDOVER', label: 'Grupo de WhatsApp criado pelo Comercial' },
  { key: 'HANDOVER_PROJECT_PARTICIPANTS', stage: 'HANDOVER', label: 'Áreas e demais envolvidos incluídos no grupo' },
  { key: 'HANDOVER_COMMERCIAL_PROPOSAL', stage: 'HANDOVER', label: 'Proposta comercial anexada' },
  { key: 'HANDOVER_TECHNICAL_PROPOSAL', stage: 'HANDOVER', label: 'Proposta técnica anexada' },
  { key: 'HANDOVER_SOURCE_DOCUMENTS', stage: 'HANDOVER', label: 'Documentos, desenhos e especificações da proposta anexados' },
  { key: 'HANDOVER_CLIENT_CONTACT', stage: 'HANDOVER', label: 'Contato responsável do cliente informado' },
  { key: 'HANDOVER_EXPECTED_START', stage: 'HANDOVER', label: 'Data prevista de início informada' },
  { key: 'HANDOVER_EXPECTED_DURATION', stage: 'HANDOVER', label: 'Prazo previsto informado' },
  { key: 'HANDOVER_RELEVANT_ASSUMPTIONS', stage: 'HANDOVER', label: 'Condições e premissas relevantes repassadas' },
  { key: 'ANALYSIS_TECHNICAL_PROPOSAL', stage: 'INITIAL_ANALYSIS', label: 'Proposta técnica revisada' },
  { key: 'ANALYSIS_COMMERCIAL_PROPOSAL', stage: 'INITIAL_ANALYSIS', label: 'Proposta comercial revisada' },
  { key: 'ANALYSIS_SCOPE', stage: 'INITIAL_ANALYSIS', label: 'Escopo e quantitativos compreendidos' },
  { key: 'ANALYSIS_ASSUMPTIONS', stage: 'INITIAL_ANALYSIS', label: 'Premissas e exclusões identificadas' },
  { key: 'ANALYSIS_RESPONSIBILITIES', stage: 'INITIAL_ANALYSIS', label: 'Responsabilidades Filtrovali e cliente identificadas' },
  { key: 'ANALYSIS_DATES', stage: 'INITIAL_ANALYSIS', label: 'Mobilização e início estimados' },
  { key: 'ANALYSIS_COMMERCIAL_QUESTIONS', stage: 'INITIAL_ANALYSIS', label: 'Dúvidas comerciais levantadas e esclarecidas' },
  { key: 'ANALYSIS_CLIENT_CONTACT', stage: 'INITIAL_ANALYSIS', label: 'Contato inicial com cliente realizado, quando necessário' }
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

function dateOnlySchema(z) {
  return z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.').refine(value => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Informe uma data válida.');
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
  return {
    start,
    patch: z.discriminatedUnion('action', [settings, checklist, critical, issue, accept, stage]),
    list: z.object({
      search: z.string().trim().max(120).optional(),
      page: z.coerce.number().int().min(1).default(1)
    }).strict()
  };
}

export function projectWorkflowMilestones(plannedMobilizationDate, today) {
  if (!plannedMobilizationDate) return { daysUntilMobilization: null, d30Date: null, d30Due: false };
  const start = Date.parse(`${today}T00:00:00.000Z`);
  const mobilization = Date.parse(`${plannedMobilizationDate}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(mobilization)) return { daysUntilMobilization: null, d30Date: null, d30Due: false };
  const dayMs = 86_400_000;
  const daysUntilMobilization = Math.round((mobilization - start) / dayMs);
  const d30Date = new Date(mobilization - 30 * dayMs).toISOString().slice(0, 10);
  return { daysUntilMobilization, d30Date, d30Due: today >= d30Date };
}
