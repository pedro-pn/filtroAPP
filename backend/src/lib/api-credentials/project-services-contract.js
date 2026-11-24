import { z } from 'zod';

const nullableText = z.string().nullable();
const nullableNumber = z.number().nullable();
export const projectServiceItemSchema = z.object({
  escopo: nullableText, servico: z.string(), rotuloServico: z.string(), equipamento: nullableText,
  avancoPct: nullableNumber, unidade: nullableText, rotuloUnidade: nullableText,
  previsto: nullableNumber, realizado: nullableNumber, sistemas: z.number().int().nonnegative()
}).strict();

export const projectServicesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  cursor: z.string().min(1).max(4096).optional(),
  updatedSince: z.string().datetime({ offset: true }).optional(),
  updated_since: z.string().datetime({ offset: true }).optional(),
  snapshotAt: z.string().datetime({ offset: true }).optional(),
  projectId: z.string().trim().min(1).max(100).optional(),
  projectCode: z.string().trim().min(1).max(100).optional()
}).strict().refine(value => !(value.projectId && value.projectCode), {
  path: ['projectCode'], message: 'Informe projectCode ou projectId, não ambos.'
}).refine(value => !(value.updatedSince && value.updated_since), {
  path: ['updated_since'], message: 'Informe updatedSince ou updated_since, não ambos.'
});

export const projectServicesItemSchema = z.object({
  projectId: z.string(), projectCode: z.string(), avancoTotal: nullableNumber,
  servicos: z.array(projectServiceItemSchema), updatedAt: z.string().datetime({ offset: true })
}).strict();

export const projectServicesRouteContract = {
  summary: 'Composição do avanço por serviço e equipamento por projeto',
  auth: 'apiToken', tags: ['IntegrationOperational'],
  query: projectServicesQuerySchema, validateInput: 'handler',
  validatedBy: 'prepareOperationalQuery (projectServicesQuerySchema + makeOperationalReadQuerySchema)',
  responses: { 200: z.object({
    items: z.array(projectServicesItemSchema),
    page: z.object({ limit: z.number().int().positive(), hasMore: z.boolean(), nextCursor: nullableText,
      snapshotAt: z.string().datetime({ offset: true }) }).strict(),
    generatedAt: z.string().datetime({ offset: true }), schemaVersion: z.literal('1.0'), requestId: z.string()
  }).strict() },
  errors: [400, 401, 403, 429]
};

const { $schema, ...arraySchema } = z.toJSONSchema(z.array(projectServiceItemSchema));
export const projectServicesArraySchema = arraySchema;
