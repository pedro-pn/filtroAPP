import { makeApiCredentialSchemas } from './api-credentials.js';

export function localCredentialDate(value) {
  if (!value) return '';
  const date = new Date(value);
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

export function reductionDefaults(credential) {
  return { expectedVersion: credential.version, reason: '', scopeCodes: [...credential.scopeCodes],
    projectAccess: { ...credential.projectAccess, projectIds: [...credential.projectAccess.projectIds] },
    allowedIpCidrs: [...credential.allowedIpCidrs], limits: { ...credential.limits }, expiresAt: localCredentialDate(credential.expiresAt) };
}

export function buildReductionPayload(values) {
  const { expiresAt, ...rest } = values;
  return { ...rest, ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}) };
}

export function makeReductionFormSchema(z, credential, scopes = []) {
  const schemas = makeApiCredentialSchemas(z, { allowLocalDateTime: true });
  return schemas.reduce.extend({ expiresAt: z.preprocess(v => v === '' ? undefined : v, schemas.reduce.shape.expiresAt) }).superRefine((value, ctx) => {
    const reject = path => ctx.addIssue({ code: 'custom', path: path.split('.'), message: 'Esta alteração amplia o acesso. Use a rotação.' });
    if (value.scopeCodes?.some(code => !credential.scopeCodes.includes(code))) reject('scopeCodes');
    for (const code of value.scopeCodes || []) {
      if (scopes.find(s => s.code === code)?.requiredScopes.some(required => !value.scopeCodes.includes(required))) ctx.addIssue({ code: 'custom', path: ['scopeCodes'], message: 'Mantenha as permissões exigidas ou retire também as dependentes.' });
    }
    if (credential.projectAccess.mode === 'SELECTED' && value.projectAccess) {
      if (value.projectAccess.mode === 'ALL') reject('projectAccess.mode');
      if (value.projectAccess.projectIds.some(id => !credential.projectAccess.projectIds.includes(id))) reject('projectAccess.projectIds');
    }
    if (credential.allowedIpCidrs.length && value.allowedIpCidrs && (!value.allowedIpCidrs.length || value.allowedIpCidrs.some(ip => !credential.allowedIpCidrs.includes(ip)))) reject('allowedIpCidrs');
    for (const [key, limit] of Object.entries(value.limits || {})) if (limit > credential.limits[key]) reject(`limits.${key}`);
    if (credential.expiresAt && (!value.expiresAt || new Date(value.expiresAt) > new Date(credential.expiresAt))) reject('expiresAt');
    if (value.expiresAt && new Date(value.expiresAt) <= new Date(credential.startsAt)) ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'A expiração deve ser posterior ao início.' });
  });
}

export function rotationDefaults(credential, now = new Date()) {
  return { name: `${credential.name.slice(0, 89)} (rotação)`, purpose: credential.purpose, recipientName: credential.recipientName,
    recipientContact: credential.recipientContact, description: credential.description,
    startsAt: now.toISOString(), expiresAt: credential.expiresAt, neverExpiresConfirmation: '',
    scopeCodes: [...credential.scopeCodes], projectAccess: { ...credential.projectAccess, projectIds: [...credential.projectAccess.projectIds] },
    allowedIpCidrs: [...credential.allowedIpCidrs], allowedFormats: ['JSON'], limits: { ...credential.limits } };
}

export function makeActionConfirmationSchema(z, action) {
  const text = action === 'rotate' ? 'ROTACIONAR' : 'REVOGAR';
  return z.object({ reason: makeApiCredentialSchemas(z).revoke.shape.reason,
    confirmation: z.string().refine(value => value === text, `Digite ${text} para confirmar.`),
    ...(action === 'rotate' ? { overlapMinutes: z.coerce.number().int().refine(value => [0, 15, 30, 60].includes(value), 'Escolha uma sobreposição de até 60 minutos.') } : {}) }).strict();
}
