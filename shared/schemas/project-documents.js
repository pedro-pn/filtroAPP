export const PROJECT_DOCUMENT_TYPES = [
  { key: 'COMMERCIAL_PROPOSAL', label: 'Proposta comercial' },
  { key: 'TECHNICAL_PROPOSAL', label: 'Proposta técnica' },
  { key: 'PURCHASE_ORDER', label: 'Pedido de compra' },
  { key: 'CONTRACT', label: 'Contrato' },
  { key: 'DRAWING', label: 'Desenho' },
  { key: 'SPECIFICATION', label: 'Especificação' },
  { key: 'CERTIFICATE', label: 'Certificado' },
  { key: 'CLIENT_REQUIREMENT', label: 'Requisito do cliente' },
  { key: 'TECHNICAL_EVIDENCE', label: 'Evidência técnica' },
  { key: 'OTHER', label: 'Outro' }
];

export const PROJECT_DOCUMENT_REQUIREMENT_STAGES = [
  { key: 'HANDOVER', label: 'Handover' },
  { key: 'MOBILIZATION', label: 'Mobilização' },
  { key: 'CLOSEOUT', label: 'Encerramento' }
];

export const PROJECT_DOCUMENT_ACCEPTANCE_MODES = [
  { key: 'NONE', label: 'Sem aceite' },
  { key: 'INTERNAL', label: 'Aceite interno' },
  { key: 'CLIENT', label: 'Aceite do cliente' },
  { key: 'SIGNATURE', label: 'Assinatura eletrônica' }
];

export const PROJECT_DOCUMENT_SOURCES = ['MANUAL', 'CRM', 'SYSTEM'];
export const PROJECT_DOCUMENT_CONTENT_KINDS = ['MANAGED_FILE', 'EXTERNAL_REFERENCE'];
export const PROJECT_DOCUMENT_ACCEPTANCE_STATUSES = ['NOT_REQUIRED', 'PENDING', 'ACCEPTED', 'REJECTED'];
export const PROJECT_DOCUMENT_CRM_OUTCOMES = ['CREATED', 'CURRENT_UPDATED', 'REPLAYED', 'IGNORED_OLDER'];
export const PROJECT_DOCUMENT_ALLOWED_EXTENSIONS = ['pdf', 'docx', 'xlsx', 'png', 'jpg', 'jpeg', 'dwg', 'dxf'];

const values = items => items.map(item => typeof item === 'string' ? item : item.key);

function optionalText(z, max) {
  return z.string().trim().max(max).nullable().optional();
}

function dateOnly(z) {
  return z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.').refine(value => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Informe uma data válida.');
}

function versionInput(z) {
  return z.object({
    versionLabel: optionalText(z, 80),
    fileName: z.string().trim().min(1, 'Selecione um arquivo.').max(255),
    dataUrl: z.string().trim().min(1, 'Selecione um arquivo.')
  }).strict();
}

export function makeProjectDocumentSchemas(z) {
  const documentType = z.enum(values(PROJECT_DOCUMENT_TYPES));
  const requirementStage = z.enum(values(PROJECT_DOCUMENT_REQUIREMENT_STAGES));
  const acceptanceMode = z.enum(values(PROJECT_DOCUMENT_ACCEPTANCE_MODES));
  const acceptanceStatus = z.enum(['ACCEPTED', 'REJECTED']);
  const expectedVersion = z.coerce.number().int().min(1);
  const id = z.string().trim().min(1).max(100);
  const boolQuery = z.preprocess(value => {
    if (value === undefined) return false;
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return value;
  }, z.boolean());
  const list = z.object({
    includeArchived: boolQuery.default(false),
    includeHistory: boolQuery.default(false)
  }).strict();
  const create = z.object({
    type: documentType,
    title: z.string().trim().min(1, 'Informe o título.').max(160),
    description: optionalText(z, 2000),
    responsibleUserId: id.nullable().optional(),
    requirementStage: requirementStage.nullable().optional(),
    acceptanceMode: acceptanceMode.default('NONE'),
    initialVersion: versionInput(z).optional()
  }).strict();
  const patch = z.object({
    expectedVersion,
    type: documentType.optional(),
    title: z.string().trim().min(1, 'Informe o título.').max(160).optional(),
    description: optionalText(z, 2000),
    responsibleUserId: id.nullable().optional(),
    requirementStage: requirementStage.nullable().optional(),
    acceptanceMode: acceptanceMode.optional()
  }).strict().refine(value => Object.keys(value).some(key => key !== 'expectedVersion'), {
    message: 'Informe ao menos um campo para alterar.'
  });
  const addVersion = z.object({
    expectedVersion,
    versionLabel: optionalText(z, 80),
    fileName: z.string().trim().min(1, 'Selecione um arquivo.').max(255),
    dataUrl: z.string().trim().min(1, 'Selecione um arquivo.')
  }).strict();
  const acceptance = z.object({
    expectedVersion,
    versionId: id,
    status: acceptanceStatus,
    occurredOn: dateOnly(z),
    reference: optionalText(z, 500),
    note: optionalText(z, 2000)
  }).strict();
  const expected = z.object({ expectedVersion }).strict();
  const signature = z.object({ expectedVersion, versionId: id }).strict();
  const crm = z.object({
    projectId: id,
    type: documentType,
    title: z.string().trim().min(1).max(160),
    description: optionalText(z, 2000),
    externalId: z.string().trim().min(1).max(180),
    externalUrl: z.string().url().refine(value => /^https?:\/\//i.test(value), 'Use uma URL HTTP(S).').nullable().optional(),
    sourceVersion: z.string().trim().min(1).max(80),
    sourceUpdatedAt: z.coerce.date(),
    versionLabel: optionalText(z, 80),
    requirementStage: requirementStage.nullable().optional(),
    acceptanceMode: acceptanceMode.default('NONE')
  }).strict();
  return { list, create, patch, addVersion, acceptance, expected, signature, crm, id };
}
