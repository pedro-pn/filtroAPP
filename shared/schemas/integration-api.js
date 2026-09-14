import { QUALITY_RECORD_TYPES, QUALITY_STATUSES } from './qualidade.js';

export const INTEGRATION_REPORT_TYPES = Object.freeze([
  'RDO', 'RDO_MAINTENANCE', 'RDO_PRODUCTION', 'RTP', 'RLQ', 'RCPU', 'RLM', 'RLF', 'RLI'
]);

function optionalText(z, max = 500) {
  return z.preprocess(value => value === undefined || value === null || value === '' ? undefined : String(value), z.string().trim().max(max).optional());
}

function optionalBoolean(z) {
  return z.preprocess(value => {
    if (value === undefined || value === null || value === '') return undefined;
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return value;
  }, z.boolean().optional());
}

function optionalCsvEnum(z, values) {
  return z.preprocess(value => {
    if (value === undefined || value === null || value === '') return undefined;
    return (Array.isArray(value) ? value : String(value).split(',')).map(item => String(item).trim()).filter(Boolean);
  }, z.array(z.enum(values)).max(values.length).optional());
}

export function makeOperationalReadQuerySchema(z, { maxPageSize = 500 } = {}) {
  return z.object({
    limit: z.coerce.number().int().min(1).max(maxPageSize).optional(),
    cursor: z.string().min(1).max(4096).optional(),
    updatedSince: z.string().datetime({ offset: true }).optional(),
    createdSince: z.string().datetime({ offset: true }).optional(),
    reportId: z.string().trim().min(1).max(100).optional(),
    maintenanceId: z.string().trim().min(1).max(100).optional(),
    itemId: z.string().trim().min(1).max(100).optional(),
    reportType: optionalCsvEnum(z, INTEGRATION_REPORT_TYPES),
    snapshotAt: z.string().datetime({ offset: true }).optional(),
    projectId: z.string().trim().min(1).max(100).optional(),
    projectCode: z.string().trim().min(1).max(100).optional(),
    active: z.preprocess(value => value === 'true' ? true : value === 'false' ? false : value, z.boolean().optional())
  }).strict().refine(value => !(value.projectId && value.projectCode), {
    path: ['projectCode'], message: 'Informe projectCode ou projectId, não ambos.'
  });
}

export function makeIntegrationApiSchemas(z, { globalMaxPageSize = 500 } = {}) {
  const isoDate = z.string().datetime({ offset: true });
  const pagination = {
    limit: z.coerce.number().int().min(1).max(globalMaxPageSize).optional().default(100),
    cursor: optionalText(z, 4096),
    updatedSince: isoDate.optional(),
    snapshotAt: isoDate.optional()
  };
  const qualityRecordsQuery = z.object({
    ...pagination,
    updatedUntil: isoDate.optional(),
    projectId: optionalText(z, 100),
    projectCode: optionalText(z, 100),
    natureId: optionalText(z, 100),
    eventDateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    eventDateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    status: optionalCsvEnum(z, QUALITY_STATUSES),
    type: optionalCsvEnum(z, QUALITY_RECORD_TYPES),
    includeDeleted: optionalBoolean(z).default(false)
  }).strict().refine(value => !(value.projectId && value.projectCode), {
    path: ['projectCode'], message: 'Informe projectCode ou projectId, não ambos.'
  });
  const qualityRecordDetailQuery = z.object({ includeDeleted: optionalBoolean(z).default(false) }).strict();
  const qualityNaturesQuery = z.object({ ...pagination, active: optionalBoolean(z) }).strict();
  const idParams = z.object({ id: z.string().trim().min(1).max(100) }).strict();
  const pageMeta = z.object({
    nextCursor: z.string().nullable(), limit: z.number().int().positive(), hasMore: z.boolean(), snapshotAt: isoDate
  }).strict();
  const errorEnvelope = z.object({ code: z.string(), message: z.string(), requestId: z.string() }).strict();
  return { qualityRecordsQuery, qualityRecordDetailQuery, qualityNaturesQuery, idParams, pageMeta, errorEnvelope };
}
