export const API_PROJECT_ACCESS_MODES = ['ALL', 'SELECTED'];
export const API_ALLOWED_FORMATS = ['JSON'];
export const API_CREDENTIAL_STATUSES = ['SCHEDULED', 'ACTIVE', 'NEAR_EXPIRY', 'EXPIRED', 'REVOKED'];
export const NEVER_EXPIRES_CONFIRMATION = 'SEM EXPIRAÇÃO';
const SECRET_MATERIAL_PATTERN = /fva_[A-Za-z0-9_-]{16}_[A-Za-z0-9_-]{20,}|\bBearer\s+\S{20,}|\b[a-f0-9]{64}\b/i;

function secretFree(schema) {
  return schema.refine(value => !SECRET_MATERIAL_PATTERN.test(value), {
    message: 'Não informe tokens, Authorization ou material criptográfico neste campo.'
  });
}

function uniqueArray(z, item, { min = 0, max = 500 } = {}) {
  return z.array(item).min(min).max(max).refine(values => new Set(values).size === values.length, {
    message: 'Não repita valores.'
  });
}

function nullableTrimmed(z, max) {
  return secretFree(z.string().trim().max(max)).nullable().optional().transform(value => value || null);
}

export function makeApiCredentialSchemas(z, { globalMaxPageSize = 500, allowLocalDateTime = false } = {}) {
  const ipAddress = z.union([z.ipv4(), z.ipv6()]);
  const cidr = z.string().trim().min(3).max(64).refine(value => {
    const [address, prefix, extra] = value.split('/');
    if (extra !== undefined || !ipAddress.safeParse(address).success) return false;
    return prefix === undefined || (/^\d{1,3}$/.test(prefix) && Number(prefix) <= (address.includes(':') ? 128 : 32));
  }, 'Informe um IP ou CIDR IPv4/IPv6 válido.');
  const reason = secretFree(z.string().trim().min(10, 'Informe uma justificativa com ao menos 10 caracteres.').max(500, 'Use no máximo 500 caracteres.'));
  const isoDate = allowLocalDateTime
    ? z.string().refine(value => !Number.isNaN(Date.parse(value)), { message: 'Informe uma data e hora válidas.' })
    : z.string().datetime({ offset: true });
  const scopeCodes = uniqueArray(z, z.string().trim().min(3).max(120), { min: 1 });
  const projectAccess = z.object({
    mode: z.enum(API_PROJECT_ACCESS_MODES),
    projectIds: uniqueArray(z, z.string().trim().min(1).max(100))
  }).strict().superRefine((value, ctx) => {
    if (value.mode === 'SELECTED' && value.projectIds.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['projectIds'], message: 'Selecione ao menos um projeto.' });
    }
    if (value.mode === 'ALL' && value.projectIds.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['projectIds'], message: 'O modo Todos não aceita projetos individuais.' });
    }
  });
  const limits = z.object({
    requestsPerMinute: z.coerce.number().int().min(1).max(600),
    requestsPerDay: z.coerce.number().int().min(1).max(100000),
    rowsPerDay: z.coerce.number().int().min(1).max(10000000),
    maxPageSize: z.coerce.number().int().min(1).max(globalMaxPageSize)
  }).strict().superRefine((value, ctx) => {
    if (value.requestsPerDay < value.requestsPerMinute) {
      ctx.addIssue({ code: 'custom', path: ['requestsPerDay'], message: 'O limite diário não pode ser menor que o limite por minuto.' });
    }
  });
  const identity = {
    name: secretFree(z.string().trim().min(3).max(100)),
    purpose: secretFree(z.string().trim().min(10).max(500)),
    recipientName: secretFree(z.string().trim().min(2).max(120)),
    recipientContact: nullableTrimmed(z, 200),
    description: nullableTrimmed(z, 1000)
  };
  const policy = {
    scopeCodes,
    projectAccess,
    allowedIpCidrs: uniqueArray(z, cidr, { max: 100 }),
    allowedFormats: uniqueArray(z, z.enum(API_ALLOWED_FORMATS), { min: 1, max: 1 }),
    limits
  };
  const create = z.object({
    ...identity,
    startsAt: isoDate,
    expiresAt: isoDate.nullable(),
    neverExpiresConfirmation: z.string().optional(),
    ...policy
  }).strict().superRefine((value, ctx) => {
    const startsAt = new Date(value.startsAt);
    if (value.expiresAt && new Date(value.expiresAt) <= startsAt) {
      ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'A expiração deve ser posterior ao início.' });
    }
    if (!value.expiresAt && value.neverExpiresConfirmation !== NEVER_EXPIRES_CONFIRMATION) {
      ctx.addIssue({ code: 'custom', path: ['neverExpiresConfirmation'], message: `Digite ${NEVER_EXPIRES_CONFIRMATION}.` });
    }
  });
  const reduce = z.object({
    expectedVersion: z.coerce.number().int().min(1),
    reason,
    ...Object.fromEntries(Object.entries(identity).map(([key, schema]) => [key, schema.optional()])),
    scopeCodes: scopeCodes.optional(),
    projectAccess: projectAccess.optional(),
    allowedIpCidrs: policy.allowedIpCidrs.optional(),
    limits: limits.optional(),
    expiresAt: isoDate.optional()
  }).strict();
  const rotate = z.object({
    replacement: create,
    reason,
    expectedVersion: z.coerce.number().int().min(1),
    revokePreviousAt: isoDate
  }).strict();
  const revoke = z.object({
    expectedVersion: z.coerce.number().int().min(1),
    reason
  }).strict();
  const playground = z.object({
    operationId: z.string().trim().min(1).max(120),
    pathParams: z.record(z.string(), z.string()).optional().default({}),
    query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])).optional().default({})
  }).strict();

  return { create, reduce, rotate, revoke, playground, projectAccess, limits, scopeCodes };
}
