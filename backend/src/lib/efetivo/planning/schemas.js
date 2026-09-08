import { z } from 'zod';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
export const dateOnlySchema = z.string().regex(datePattern, 'Use o formato AAAA-MM-DD.').refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Informe uma data válida.');

export const idSchema = z.string().trim().min(1).max(100);
export const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i, 'Informe uma cor hexadecimal válida.');
export const absenceTypeSchema = z.enum(['FERIAS', 'FOLGA', 'AFASTAMENTO']);
export const missionScheduleStatusSchema = z.enum(['DRAFT', 'CONFIRMED', 'CANCELLED']);
export const editableMissionScheduleStatusSchema = z.enum(['CONFIRMED', 'CANCELLED']);
export const missionStageSchema = z.enum(['STANDBY', 'MOBILIZATION', 'EXECUTION', 'FINAL_MEASUREMENT', 'FINISHED']);

export const datePositionQuerySchema = z.object({
  date: dateOnlySchema,
  jobRoleId: idSchema.optional()
});

export const intervalQuerySchema = z.object({
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
  jobRoleId: idSchema.optional()
}).refine(value => value.endDate >= value.startDate, {
  path: ['endDate'],
  message: 'A data final não pode ser anterior à inicial.'
}).refine(value => {
  const start = new Date(`${value.startDate}T00:00:00.000Z`).getTime();
  const end = new Date(`${value.endDate}T00:00:00.000Z`).getTime();
  return (end - start) / 86_400_000 <= 370;
}, {
  path: ['endDate'],
  message: 'Consulte no máximo 371 dias por vez.'
});

export const collaboratorInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  jobRoleId: idSchema,
  jobRoleEffectiveDate: dateOnlySchema.optional(),
  admissionDate: dateOnlySchema,
  terminationDate: dateOnlySchema.nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional()
}).refine(value => !value.terminationDate || value.terminationDate >= value.admissionDate, {
  path: ['terminationDate'],
  message: 'O desligamento não pode ser anterior à admissão.'
}).refine(value => !value.jobRoleEffectiveDate || value.jobRoleEffectiveDate >= value.admissionDate, {
  path: ['jobRoleEffectiveDate'],
  message: 'A vigência do cargo não pode ser anterior à admissão.'
});

const absenceInputFields = {
  collaboratorId: idSchema,
  type: absenceTypeSchema,
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
  note: z.string().trim().max(1000).nullable().optional()
};

function validAbsencePeriod(value) {
  return !value.startDate || !value.endDate || value.endDate >= value.startDate;
}

export const absenceInputSchema = z.object(absenceInputFields).refine(validAbsencePeriod, {
  path: ['endDate'],
  message: 'A data final não pode ser anterior à inicial.'
});

export const absenceUpdateSchema = z.object(absenceInputFields).partial()
  .refine(value => Object.keys(value).length > 0, 'Informe ao menos uma alteração.')
  .refine(validAbsencePeriod, {
    path: ['endDate'],
    message: 'A data final não pode ser anterior à inicial.'
  });

export const demandInputSchema = z.object({
  jobRoleId: idSchema,
  requiredCount: z.coerce.number().int().min(0).max(1000)
});

export const missionAllocationPeriodInputSchema = z.object({
  collaboratorId: idSchema,
  mobilizationDate: dateOnlySchema,
  demobilizationDate: dateOnlySchema
}).refine(value => value.demobilizationDate >= value.mobilizationDate, {
  path: ['demobilizationDate'],
  message: 'A desmobilização individual não pode ser anterior à mobilização.'
});

export const missionInputSchema = z.object({
  planId: idSchema.optional(),
  projectId: idSchema,
  scheduleStatus: editableMissionScheduleStatusSchema,
  headquartersResponsibleUserId: idSchema,
  mobilizationDate: dateOnlySchema,
  executionStartDate: dateOnlySchema,
  executionEndDate: dateOnlySchema,
  returnDate: dateOnlySchema.nullable().optional(),
  collaboratorIds: z.array(idSchema).max(500).refine(
    values => new Set(values).size === values.length,
    'Cada colaborador deve aparecer uma única vez na equipe.'
  ),
  allocationPeriods: z.array(missionAllocationPeriodInputSchema).max(500).optional().default([]).refine(
    values => new Set(values.map(item => item.collaboratorId)).size === values.length,
    'Cada colaborador deve possuir somente um período individual.'
  ),
  confirmedMissionOverlapCollaboratorIds: z.array(idSchema).max(500).optional().default([]),
  confirmedInactiveCollaboratorIds: z.array(idSchema).max(500).optional().default([])
}).superRefine((value, context) => {
  const collaboratorIds = new Set(value.collaboratorIds);
  value.allocationPeriods.forEach((period, index) => {
    if (!collaboratorIds.has(period.collaboratorId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['allocationPeriods', index, 'collaboratorId'],
        message: 'O período individual pertence a um colaborador que não está na equipe.'
      });
    }
    const missionEndDate = value.returnDate || value.executionEndDate;
    if (period.mobilizationDate < value.mobilizationDate || period.demobilizationDate > missionEndDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['allocationPeriods', index],
        message: 'O período individual deve estar dentro das datas da missão.'
      });
    }
  });
});

export const allocationInputSchema = z.object({
  collaboratorId: idSchema,
  jobRoleId: idSchema,
  mobilizationDate: dateOnlySchema.optional(),
  demobilizationDate: dateOnlySchema.optional(),
  allowMissionOverlap: z.boolean().optional().default(false),
  allowInactiveCollaborator: z.boolean().optional().default(false)
}).refine(value => !value.mobilizationDate || !value.demobilizationDate || value.demobilizationDate >= value.mobilizationDate, {
  path: ['demobilizationDate'],
  message: 'A desmobilização individual não pode ser anterior à mobilização.'
});

export const allocationPeriodInputSchema = z.object({
  mobilizationDate: dateOnlySchema,
  demobilizationDate: dateOnlySchema,
  allowMissionOverlap: z.boolean().optional().default(false),
  allowInactiveCollaborator: z.boolean().optional().default(false)
}).refine(value => value.demobilizationDate >= value.mobilizationDate, {
  path: ['demobilizationDate'],
  message: 'A desmobilização individual não pode ser anterior à mobilização.'
});

export const mobilizationCycleInputSchema = z.object({
  mobilizationDate: dateOnlySchema,
  demobilizationDate: dateOnlySchema.nullable().optional(),
  allowInactiveCollaborator: z.boolean().optional().default(false)
}).refine(value => !value.demobilizationDate || value.demobilizationDate >= value.mobilizationDate, {
  path: ['demobilizationDate'],
  message: 'A desmobilização não pode ser anterior à mobilização.'
});

export const stageInputSchema = z.object({
  stage: missionStageSchema,
  order: z.coerce.number().int().min(0),
  returnDate: dateOnlySchema.nullable().optional()
});

// Contratação hipotética informada já na criação do cenário; quantidade 0 significa "sem contratação".
export const initialHireSchema = z.object({
  jobRoleId: idSchema,
  quantity: z.coerce.number().int().min(0).max(1000),
  availableFrom: dateOnlySchema
});

export const scenarioInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  objective: z.string().trim().max(1000).nullable().optional(),
  initialHire: initialHireSchema.nullable().optional()
});

export const plannedHireInputSchema = z.object({
  jobRoleId: idSchema,
  quantity: z.coerce.number().int().min(1).max(1000),
  availableFrom: dateOnlySchema
});


export const holidayInputSchema = z.object({
  holidayDate: dateOnlySchema,
  name: z.string().trim().min(1).max(160)
});

export const jobRolePlanningInputSchema = z.object({
  isOperational: z.boolean().optional(),
  calendarColor: hexColorSchema.optional(),
  continuousWorkLimitDays: z.coerce.number().int().min(1).max(365).nullable().optional()
}).refine(value => Object.keys(value).length > 0, 'Informe ao menos uma alteração.');

export const planningSettingsInputSchema = z.object({
  plannedUtilizationTarget: z.coerce.number().min(0).max(100)
});
