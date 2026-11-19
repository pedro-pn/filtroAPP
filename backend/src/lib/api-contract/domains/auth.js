import { z } from 'zod';

// Schemas de RESPOSTA do domínio auth (spec 042, fase 1). Os de requisição
// ficam junto das rotas (backend/src/routes/resources/auth.js), porque são os
// mesmos que validam. Respostas usam `looseObject`: documentam os campos que o
// frontend usa sem recusar campos novos.

const isoDate = z.union([z.string(), z.date()]).describe('Data/hora ISO 8601');

export const publicUserSchema = z.looseObject({
  id: z.string(),
  username: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  emailVerifiedAt: isoDate.nullable(),
  role: z.string(),
  accountType: z.string(),
  moduleRoles: z.array(z.string()),
  isActive: z.boolean(),
  clientCnpj: z.string().nullable(),
  privacyPolicyRequired: z.boolean(),
  requiredPrivacyPolicyVersion: z.string(),
  twoFactor: z.object({ required: z.boolean(), enabled: z.boolean() })
}).describe('Usuário autenticado');

export const userEnvelopeSchema = z.object({ user: publicUserSchema });

export const sessionSchema = z.looseObject({
  token: z.string().optional().describe('Só durante a transição para o cookie (spec 041)'),
  expiresAt: isoDate,
  user: publicUserSchema,
  trustedDeviceExpiresAt: isoDate.optional(),
  trustedDeviceToken: z.string().optional()
}).describe('Sessão criada; o token principal vai no cookie HttpOnly fv_session');

export const twoFactorChallengeResponseSchema = z.object({
  twoFactorRequired: z.literal(true),
  challengeToken: z.string(),
  emailHint: z.string().nullable(),
  expiresAt: isoDate,
  trustedDeviceDays: z.number()
}).describe('Senha correta; falta confirmar o código enviado por e-mail');

export const loginResponseSchema = z.union([sessionSchema, twoFactorChallengeResponseSchema]);

export const twoFactorResendResponseSchema = z.object({ ok: z.literal(true), emailHint: z.string().nullable() });

export const twoFactorEnableResponseSchema = z.object({
  challengeToken: z.string(),
  emailHint: z.string().nullable(),
  expiresAt: isoDate
});

export const twoFactorStatusSchema = z.looseObject({
  enforced: z.boolean(),
  required: z.boolean(),
  enabled: z.boolean(),
  canToggle: z.boolean(),
  emailHint: z.string().nullable(),
  hasEmail: z.boolean(),
  trustedDeviceDays: z.number(),
  trustedDevices: z.array(z.looseObject({
    id: z.string(),
    label: z.string(),
    createdAt: isoDate,
    lastUsedAt: isoDate.nullable(),
    expiresAt: isoDate,
    current: z.boolean()
  }))
});

export const okSchema = z.looseObject({ ok: z.literal(true) });

export const okMessageSchema = z.object({ ok: z.literal(true), message: z.string() });

export const tokenStatusSchema = z.looseObject({ valid: z.boolean() }).describe('Situação do token informado');

export const notificationPreferencesSchema = z.looseObject({
  reports: z.boolean(),
  signatures: z.boolean(),
  signatureReminders: z.boolean(),
  surveyReminders: z.boolean(),
  calibrationReminders: z.boolean()
});

export const accountUpdateResponseSchema = z.looseObject({
  user: publicUserSchema,
  emailChangePending: z.boolean().optional()
});

export const tokenParamsSchema = z.object({ token: z.string().min(1).max(500) });

export const deviceParamsSchema = z.object({ id: z.string().min(1).max(100) });

export const tokenQuerySchema = z.looseObject({ token: z.string().max(500).optional() });
