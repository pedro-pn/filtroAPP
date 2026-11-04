import { z } from 'zod';

// Schemas Zod da API de conferência de alocação (contracts/allocation-review-api.md).

export const REVIEW_KINDS = ['PROJECT', 'TRAVEL', 'SEDE', 'FOLGA', 'FERIAS', 'AFASTAMENTO', 'TREINAMENTO'];
export const PROJECT_KINDS = new Set(['PROJECT', 'TRAVEL']);
export const ABSENCE_ALERT_KINDS = new Set(['FOLGA', 'FERIAS', 'AFASTAMENTO']);
export const MAX_ITEMS = 200;
export const MAX_NOTE = 500;

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida. Use AAAA-MM-DD.').refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Data inválida.');

export function isMonday(value) {
  return new Date(`${value}T00:00:00.000Z`).getUTCDay() === 1;
}

export const yearMonthParamSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês inválido. Use AAAA-MM.');

export const weekStartParamSchema = dateKey.refine(isMonday, 'A semana deve começar numa segunda-feira.');

const id = z.string().trim().min(1);

export function validateKindProjects(item, context, path = []) {
  const count = item.projectIds.length;
  if (item.kind === 'PROJECT' && count < 1) {
    context.addIssue({ code: 'custom', path: [...path, 'projectIds'], message: 'Escolha ao menos um projeto.' });
  } else if (item.kind === 'TRAVEL' && count !== 1) {
    context.addIssue({ code: 'custom', path: [...path, 'projectIds'], message: 'Viagem precisa de exatamente um projeto de destino.' });
  } else if (!PROJECT_KINDS.has(item.kind) && count > 0) {
    context.addIssue({ code: 'custom', path: [...path, 'projectIds'], message: 'Esta situação não leva projeto.' });
  }
}

const dayItemSchema = z.object({
  collaboratorId: id,
  date: dateKey,
  kind: z.enum(REVIEW_KINDS),
  projectIds: z.array(id).max(10).default([]).transform(list => [...new Set(list)]),
  note: z.string().trim().max(MAX_NOTE).nullable().optional()
}).superRefine((item, context) => validateKindProjects(item, context));

export const saveDaysBodySchema = z.object({
  items: z.array(dayItemSchema).min(1).max(MAX_ITEMS)
}).strict();

export const discardDaysBodySchema = z.object({
  items: z.array(z.object({ collaboratorId: id, date: dateKey })).min(1).max(MAX_ITEMS)
}).strict();

export const confirmRowsBodySchema = z.union([
  z.object({ collaboratorIds: z.array(id).min(1).max(MAX_ITEMS) }).strict(),
  z.object({ allReady: z.literal(true) }).strict()
]);

export const unconfirmRowsBodySchema = z.object({
  collaboratorIds: z.array(id).min(1).max(MAX_ITEMS)
}).strict();

export const reopenBodySchema = z.object({
  note: z.string().trim().max(MAX_NOTE).nullable().optional()
}).strict();

// Versão 0 = semana ainda sem registro (nenhuma escrita feita).
export const ifMatchVersionSchema = z.coerce.number().int().min(0);

export function parseIfMatchVersion(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const parsed = ifMatchVersionSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
