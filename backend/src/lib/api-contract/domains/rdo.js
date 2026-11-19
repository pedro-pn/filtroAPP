import { z } from 'zod';

// Contratos do domínio RDO/relatórios (spec 042, fase 2). As rotas antigas já
// validam a entrada no próprio handler com schemas zod; aqui o contrato
// reaproveita esses schemas para documentar e, por padrão, deixa a validação no
// handler (`validateInput: 'handler'`), para não mudar a ordem das respostas
// (ex.: 403 de papel antes do 400 de dados). Rotas que não tinham schema (lacunas
// do critério 7.2) passam a ser validadas pelo contrato.
//
// Respostas usam `looseObject`: documentam os campos que o frontend usa sem
// recusar campos novos. `null` = arquivo ou corpo vazio.

const isoDate = z.union([z.string(), z.date()]).describe('Data/hora ISO 8601');

export const reportSummarySchema = z.looseObject({
  id: z.string(),
  projectId: z.string(),
  reportType: z.string(),
  status: z.string(),
  reportDate: isoDate,
  sequenceNumber: z.number().int().nullable().optional()
}).describe('Relatório (RDO ou derivado)');

export const reportListSchema = z.union([
  z.array(reportSummarySchema),
  z.looseObject({ items: z.array(reportSummarySchema) })
]).describe('Lista de relatórios');

export const operationalReportSchema = z.looseObject({ id: z.string() }).describe('Relatório operacional ou manutenção');
export const draftSchema = z.looseObject({ id: z.string() }).describe('Rascunho de relatório');
export const pdfAttachmentSchema = z.looseObject({ id: z.string() }).describe('PDF anexado ao relatório');
export const recipientSchema = z.looseObject({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  isActive: z.boolean()
}).describe('Destinatário do relatório mensal de alocação');
export const okSchema = z.looseObject({ ok: z.boolean().optional() }).describe('Confirmação');
export const jsonObjectSchema = z.looseObject({}).describe('Objeto JSON (ver o handler para os campos)');
export const jsonArraySchema = z.array(z.unknown()).describe('Lista JSON');

// Arquivos (PDF, DOCX, ZIP, CSV) e respostas sem corpo.
export const FILE = null;
export const EMPTY = null;

function pathParamsSchema(path) {
  const names = [...path.matchAll(/[:*]([A-Za-z0-9_]+)/g)].map(match => match[1]);
  if (!names.length) return undefined;
  return z.object(Object.fromEntries(names.map(name => [name, z.string()])));
}

// rdoRoute('POST /:id/status', { summary, body, ... }) → contrato para defineRoute.
// Padrões do domínio: auth 'session', validação no handler, parâmetros de caminho
// documentados a partir do próprio caminho.
export function rdoRoute(key, options = {}) {
  const [verb, path] = key.split(' ');
  const { tag = 'rdo', ...rest } = options;
  const spec = {
    method: verb.toLowerCase(),
    path,
    auth: 'session',
    tags: [tag],
    errors: [401, 403],
    validateInput: 'handler',
    validatedBy: 'handler',
    ...rest
  };
  if (spec.params === undefined) {
    const params = pathParamsSchema(path);
    if (params) spec.params = params;
  }
  if (spec.validateInput === 'handler' && spec.validatedBy === 'handler') {
    spec.validatedBy = spec.body ? 'handler (mesmo schema do contrato)' : 'handler (sem corpo; parâmetros e consulta conferidos no handler)';
  }
  return spec;
}
