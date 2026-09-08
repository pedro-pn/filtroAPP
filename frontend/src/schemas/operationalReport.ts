import { z } from 'zod';

const requiredText = (message: string) => z.string().trim().min(1, message);
const date = requiredText('Informe a data.').regex(
  /^\d{4}-\d{2}-\d{2}$/,
  'Informe uma data válida.'
);
const time = requiredText('Informe o horário.').regex(
  /^([01]\d|2[0-3]):[0-5]\d$/,
  'Informe um horário válido.'
);
const breakTime = requiredText('Informe o intervalo.').regex(
  /^\d{1,2}:[0-5]\d(?::[0-5]\d)?$/,
  'Use o formato HH:mm ou HH:mm:ss.'
);

export const maintenanceFormSchema = z.object({
  id: z.string().optional(),
  equipmentId: requiredText('Selecione o equipamento.'),
  selectedServiceIds: z.array(z.string()).min(1, 'Marque ao menos um serviço.'),
  observations: z.string().max(5000).optional(),
  thirdPartyServices: z.array(
    z.object({
      serviceDate: date,
      location: requiredText('Informe o local.'),
      description: requiredText('Informe o serviço.')
    })
  ),
  photos: z
    .array(
      z.object({
        fileName: z.string(),
        mimeType: z.string(),
        dataUrl: z.string()
      })
    )
    .max(10, 'Cada manutenção aceita no máximo 10 fotos.'),
  removePhotoIds: z.array(z.string()).optional()
});

export const chemicalCleaningFormSchema = z
  .object({
    description: requiredText('Informe a descrição.'),
    material: z.enum(['CARBON_STEEL', 'STAINLESS_STEEL', 'CUNIFE', 'OTHER']),
    otherMaterial: z.string().optional(),
    quantityKg: z.number().positive('Informe uma quantidade maior que zero.')
  })
  .superRefine((item, context) => {
    if (item.material === 'OTHER' && !item.otherMaterial?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['otherMaterial'],
        message: 'Informe o outro material.'
      });
    }
  });

export const operationalReportFormSchema = z
  .object({
    kind: z.enum(['MAINTENANCE', 'PRODUCTION']),
    reportDate: date,
    arrivalTime: time,
    departureTime: time,
    lunchBreak: breakTime,
    collaboratorIds: z
      .array(z.string())
      .min(1, 'Selecione ao menos um colaborador.'),
    nightShift: z.object({
      enabled: z.boolean(),
      arrivalTime: z.string(),
      departureTime: z.string(),
      breakTime: z.string(),
      collaboratorIds: z.array(z.string())
    }),
    overtimeReason: z.string().max(2000).optional(),
    dailyDescription: z.string().trim().max(10000).optional(),
    maintenanceRecords: z.array(maintenanceFormSchema),
    chemicalCleanings: z.array(chemicalCleaningFormSchema)
  })
  .superRefine((value, context) => {
    if (value.nightShift.enabled) {
      for (const field of ['arrivalTime', 'departureTime'] as const) {
        if (!time.safeParse(value.nightShift[field]).success) {
          context.addIssue({
            code: 'custom',
            path: ['nightShift', field],
            message: 'Informe o horário noturno.'
          });
        }
      }
      if (!breakTime.safeParse(value.nightShift.breakTime).success) {
        context.addIssue({
          code: 'custom',
          path: ['nightShift', 'breakTime'],
          message: 'Informe o intervalo noturno.'
        });
      }
      if (!value.nightShift.collaboratorIds.length) {
        context.addIssue({
          code: 'custom',
          path: ['nightShift', 'collaboratorIds'],
          message: 'Selecione a equipe noturna.'
        });
      }
    }
    if (value.kind === 'MAINTENANCE' && !value.maintenanceRecords.length) {
      context.addIssue({
        code: 'custom',
        path: ['maintenanceRecords'],
        message: 'Adicione ao menos uma manutenção.'
      });
    }
    if (value.kind === 'MAINTENANCE' && !value.dailyDescription) {
      context.addIssue({
        code: 'custom',
        path: ['dailyDescription'],
        message: 'Descreva as atividades.'
      });
    }
    if (value.kind === 'PRODUCTION' && !value.chemicalCleanings.length) {
      context.addIssue({
        code: 'custom',
        path: ['chemicalCleanings'],
        message: 'Adicione ao menos uma limpeza química.'
      });
    }
  });

export const standaloneMaintenanceFormSchema = maintenanceFormSchema.extend({
  maintenanceDate: date
});

export const standaloneOperationalReportFormSchema = z.object({
  kind: z.literal('MAINTENANCE'),
  reportDate: date,
  arrivalTime: z.string(),
  departureTime: z.string(),
  lunchBreak: z.string(),
  collaboratorIds: z.array(z.string()),
  nightShift: z.object({
    enabled: z.boolean(),
    arrivalTime: z.string(),
    departureTime: z.string(),
    breakTime: z.string(),
    collaboratorIds: z.array(z.string())
  }),
  overtimeReason: z.string().optional(),
  dailyDescription: z.string().optional(),
  maintenanceRecords: z
    .array(maintenanceFormSchema)
    .length(1, 'Informe uma manutenção.'),
  chemicalCleanings: z.array(chemicalCleaningFormSchema).max(0)
});

export const maintenanceProfileFormSchema = z
  .object({
    name: requiredText('Informe o nome do perfil.').max(120),
    isActive: z.boolean(),
    items: z
      .array(
        z.object({
          id: z.string().optional(),
          label: requiredText('Informe o nome do serviço.').max(300),
          order: z.number().int().positive(),
          isActive: z.boolean()
        })
      )
      .min(1, 'Adicione ao menos um serviço.')
      .max(100)
  })
  .superRefine((value, context) => {
    const labels = value.items.map((item) =>
      item.label.trim().toLocaleLowerCase('pt-BR')
    );
    if (new Set(labels).size !== labels.length) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'O checklist não pode conter serviços duplicados.'
      });
    }
  });

export const maintenanceCategoryIntervalFormSchema = z.object({
  maintenanceIntervalDays: z
    .string()
    .trim()
    .refine(
      (value) =>
        value === '' ||
        (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 3650),
      'Informe um intervalo entre 1 e 3650 dias.'
    )
});

export type OperationalReportFormValues = z.input<
  typeof operationalReportFormSchema
>;
export type StandaloneMaintenanceFormValues = z.input<
  typeof standaloneMaintenanceFormSchema
>;
export type MaintenanceProfileFormValues = z.input<
  typeof maintenanceProfileFormSchema
>;
export type MaintenanceCategoryIntervalFormValues = z.input<
  typeof maintenanceCategoryIntervalFormSchema
>;
