import { z } from 'zod';

export const dateOnlySchema = z.string().date();

export const collaboratorJobRoleInputSchema = z.object({
  jobRoleId: z.string().trim().min(1)
}).strict();

export const epiCollaboratorProfileInputSchema = z.object({
  roleOverrideJobRoleId: z.string().trim().min(1).nullable()
}).strict();

export const workforceCalendarQuerySchema = z.object({
  from: dateOnlySchema,
  to: dateOnlySchema,
  collaboratorId: z.union([z.string(), z.array(z.string())]).optional()
}).superRefine((value, context) => {
  if (value.to < value.from) {
    context.addIssue({ code: 'custom', path: ['to'], message: 'A data final não pode ser anterior à inicial.' });
  }
});

export const workforceAbsenceQuerySchema = z.object({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  collaboratorId: z.string().trim().min(1).optional()
}).superRefine((value, context) => {
  if (value.from && value.to && value.to < value.from) {
    context.addIssue({ code: 'custom', path: ['to'], message: 'A data final não pode ser anterior à inicial.' });
  }
});

const workforceAbsenceFieldsSchema = z.object({
  collaboratorId: z.string().trim().min(1),
  type: z.enum(['FERIAS', 'FOLGA', 'AFASTAMENTO']),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
  note: z.string().trim().max(1000).nullable().optional()
});

function validateAbsencePeriod(value, context) {
  if (value.endDate < value.startDate) {
    context.addIssue({ code: 'custom', path: ['endDate'], message: 'A data final não pode ser anterior à inicial.' });
  }
}

export const workforceAbsenceInputSchema = workforceAbsenceFieldsSchema.superRefine(validateAbsencePeriod);

export const workforceAbsenceUpdateSchema = workforceAbsenceFieldsSchema.partial().superRefine((value, context) => {
  if (value.startDate && value.endDate) validateAbsencePeriod(value, context);
});

export const workforceAvailabilityInputSchema = z.object({
  collaboratorIds: z.array(z.string().trim().min(1)).min(1).max(500),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
  context: z.enum(['PLANNING', 'ACTUAL_REPORT'])
}).superRefine((value, context) => {
  if (value.endDate < value.startDate) {
    context.addIssue({ code: 'custom', path: ['endDate'], message: 'A data final não pode ser anterior à inicial.' });
  }
});

export const officialMissionContextQuerySchema = z.object({
  projectId: z.string().trim().min(1),
  date: dateOnlySchema
});

export function parseIfMatchVersion(value) {
  const parsed = z.coerce.number().int().positive().safeParse(value);
  return parsed.success ? parsed.data : null;
}
