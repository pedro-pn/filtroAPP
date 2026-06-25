import { Router } from 'express';
import { AccountType, UserRole } from '@prisma/client';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import env from '../../config/env.js';
import { createPasswordResetToken, publicUser } from '../../lib/auth.js';
import { missingClientAccessResetConfig, sendClientAccessResetEmail } from '../../lib/client-access-reset.js';
import { projectHasClientSignerEmail } from '../../lib/client-project-access.js';
import { normalizeCnpj } from '../../lib/cnpj.js';
import { buildInternalUserWelcomeEmailTemplate, buildPasswordResetEmailTemplate } from '../../lib/email-templates.js';
import { clientEmailsEnabled, getMissingMailerConfig, sendClientMail, sendMail } from '../../lib/mailer.js';
import {
  accountTypeForLegacyRole,
  defaultPublicModuleRolesForLegacyRole,
  moduleRoleRows,
  normalizePublicModuleRoles,
  prismaModuleRole,
  serializeModuleRoles
} from '../../lib/module-roles.js';
import { hashPassword } from '../../lib/password.js';
import prisma from '../../lib/prisma.js';
import { requireAuth, requireHubAdmin } from '../../middleware/auth.js';

const router = Router();
const INTERNAL_ACCOUNT_ROLES = new Set([UserRole.MANAGER, UserRole.COLLABORATOR, UserRole.COORDINATOR]);
const INTERNAL_ROLE_LABELS = {
  [UserRole.MANAGER]: 'gestor',
  [UserRole.COLLABORATOR]: 'colaborador',
  [UserRole.COORDINATOR]: 'coordenador'
};

const schema = z.object({
  username: z.string().min(1),
  name: z.string().min(1),
  email: z.union([z.string().trim().email(), z.literal(''), z.null()]).optional(),
  password: z.string().min(6).optional(),
  role: z.nativeEnum(UserRole),
  accountType: z.nativeEnum(AccountType).optional(),
  moduleRoles: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  collaboratorId: z.string().nullable().optional()
});

function clientCnpjForAccount(username, accountType) {
  if (accountType !== AccountType.CLIENT) return null;
  const cnpj = normalizeCnpj(username);
  return cnpj.length === 14 ? cnpj : null;
}

const ACCOUNT_MODULE_ROLE_COMPATIBILITY = {
  [AccountType.ADMIN]: new Set([
    'rdo:manager',
    'romaneio:manager',
    'romaneio:operator',
    'epi:technician',
    'epi:collaborator',
    'privacy:admin',
    'equipamentos:manager',
    'equipamentos:viewer',
    'acompanhamento:manager',
    'acompanhamento:viewer'
  ]),
  [AccountType.INTERNAL]: new Set([
    'rdo:coordinator',
    'rdo:collaborator',
    'romaneio:manager',
    'romaneio:operator',
    'epi:technician',
    'epi:collaborator',
    'privacy:admin',
    'equipamentos:manager',
    'equipamentos:viewer',
    'acompanhamento:manager',
    'acompanhamento:viewer'
  ]),
  [AccountType.CLIENT]: new Set(['rdo:client'])
};

function assertRoleAccountCompatibility(accountType, role, moduleRoles) {
  if (accountType === AccountType.ADMIN && role !== UserRole.MANAGER) {
    const error = new Error('Contas ADMIN devem usar role legado MANAGER.');
    error.status = 400;
    throw error;
  }
  if (accountType === AccountType.INTERNAL && (role === UserRole.MANAGER || role === UserRole.CLIENT)) {
    const error = new Error('Contas INTERNAL não podem usar role legado MANAGER ou CLIENT.');
    error.status = 400;
    throw error;
  }
  if (accountType === AccountType.CLIENT && role !== UserRole.CLIENT) {
    const error = new Error('Contas CLIENT devem usar role legado CLIENT.');
    error.status = 400;
    throw error;
  }

  const allowedRoles = ACCOUNT_MODULE_ROLE_COMPATIBILITY[accountType] || new Set();
  const incompatibleRole = moduleRoles.find(moduleRole => !allowedRoles.has(moduleRole));
  if (incompatibleRole) {
    const error = new Error(`Role de módulo ${incompatibleRole} incompatível com conta ${accountType}.`);
    error.status = 400;
    throw error;
  }

  if (accountType === AccountType.INTERNAL) {
    if (moduleRoles.includes('rdo:coordinator') && role !== UserRole.COORDINATOR) {
      const error = new Error('Role de módulo rdo:coordinator exige role legado COORDINATOR.');
      error.status = 400;
      throw error;
    }
    if (moduleRoles.includes('rdo:collaborator') && role !== UserRole.COLLABORATOR) {
      const error = new Error('Role de módulo rdo:collaborator exige role legado COLLABORATOR.');
      error.status = 400;
      throw error;
    }
  }
}

function defaultModuleRolesForAccount(accountType, role) {
  if (accountType === AccountType.CLIENT) return ['rdo:client'];
  if (accountType === AccountType.ADMIN) return ['rdo:manager'];
  return defaultPublicModuleRolesForLegacyRole(role);
}

function accountShapeChanged(data, existingUser) {
  if (!existingUser) return false;
  return (data.role !== undefined && data.role !== existingUser.role)
    || (data.accountType !== undefined && data.accountType !== existingUser.accountType);
}

function normalizeAccountEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function emailIdentifier(value) {
  const normalized = normalizeAccountEmail(value);
  return normalized.includes('@') ? normalized : '';
}

async function assertAccountEmailAvailable(email, currentUserId = null) {
  const normalizedEmail = emailIdentifier(email);
  if (!normalizedEmail) return;

  const conflict = await prisma.user.findFirst({
    where: {
      ...(currentUserId ? { id: { not: currentUserId } } : {}),
      OR: [
        { username: { equals: normalizedEmail, mode: 'insensitive' } },
        { email: { equals: normalizedEmail, mode: 'insensitive' } }
      ]
    },
    select: { id: true }
  });
  if (conflict) {
    const error = new Error('Já existe uma conta cadastrada para este e-mail.');
    error.status = 409;
    throw error;
  }
}

export function resolveAccountPayload(data, existingUser = null) {
  if (data.accountType === AccountType.ADMIN && data.role !== undefined && data.role !== UserRole.MANAGER) {
    const error = new Error('Contas ADMIN devem usar role legado MANAGER.');
    error.status = 400;
    throw error;
  }
  if (data.accountType === AccountType.INTERNAL && (data.role === UserRole.MANAGER || data.role === UserRole.CLIENT)) {
    const error = new Error('Contas INTERNAL não podem usar role legado MANAGER ou CLIENT.');
    error.status = 400;
    throw error;
  }
  if (data.accountType === AccountType.CLIENT && data.role !== undefined && data.role !== UserRole.CLIENT) {
    const error = new Error('Contas CLIENT devem usar role legado CLIENT.');
    error.status = 400;
    throw error;
  }

  const targetAccountType = data.accountType
    || (data.role ? accountTypeForLegacyRole(data.role) : existingUser?.accountType)
    || accountTypeForLegacyRole(existingUser?.role);
  let role = data.role || existingUser?.role || UserRole.COLLABORATOR;
  let collaboratorId = data.collaboratorId !== undefined ? data.collaboratorId : existingUser?.collaboratorId || null;

  if (targetAccountType === AccountType.CLIENT) {
    role = UserRole.CLIENT;
    collaboratorId = null;
  } else if (targetAccountType === AccountType.ADMIN) {
    role = UserRole.MANAGER;
  } else if (role === UserRole.CLIENT) {
    role = UserRole.COLLABORATOR;
  }

  let requestedModuleRoles = null;
  if (data.moduleRoles !== undefined) {
    const invalidRole = data.moduleRoles.find(roleCode => !prismaModuleRole(roleCode));
    if (invalidRole) {
      const error = new Error(`Role de módulo inválida: ${invalidRole}`);
      error.status = 400;
      throw error;
    }
    requestedModuleRoles = normalizePublicModuleRoles(data.moduleRoles);
  }
  const moduleRoles = requestedModuleRoles
    || (existingUser && !accountShapeChanged(data, existingUser) && Object.prototype.hasOwnProperty.call(existingUser, 'moduleRoles')
      ? serializeModuleRoles(existingUser)
      : defaultModuleRolesForAccount(targetAccountType, role));

  if (!moduleRoles.length && targetAccountType !== AccountType.INTERNAL) {
    const error = new Error('A conta deve possuir ao menos uma role de módulo.');
    error.status = 400;
    throw error;
  }

  if (targetAccountType === AccountType.CLIENT && (moduleRoles.length !== 1 || moduleRoles[0] !== 'rdo:client')) {
    const error = new Error('Contas CLIENT só podem receber a role rdo:client.');
    error.status = 400;
    throw error;
  }

  if (existingUser?.accountType === AccountType.CLIENT && targetAccountType === AccountType.ADMIN) {
    const error = new Error('Não é permitido transformar uma conta CLIENT diretamente em ADMIN.');
    error.status = 400;
    throw error;
  }

  assertRoleAccountCompatibility(targetAccountType, role, moduleRoles);

  return {
    accountType: targetAccountType,
    role,
    collaboratorId,
    moduleRoles
  };
}

function queueInternalAccountMail(message, meta) {
  const missingMailerConfig = getMissingMailerConfig();
  if (missingMailerConfig.length) {
    console.warn('Notificação de conta interna não enviada por falta de configuração SMTP.', {
      missingMailerConfig,
      meta
    });
    return;
  }

  setImmediate(() => {
    sendMail(message).catch(error => {
      console.error('Falha ao enviar notificação da conta interna.', {
        meta,
        error: error?.message || error
      });
    });
  });
}

router.use(requireAuth, requireHubAdmin);

router.get('/', asyncHandler(async (req, res) => {
  const group = String(req.query.group || '').trim().toLowerCase();
  const where = {};
  if (group === 'internal') {
    where.role = { in: [UserRole.MANAGER, UserRole.COLLABORATOR, UserRole.COORDINATOR] };
  } else if (group === 'client') {
    where.role = UserRole.CLIENT;
  }

  const users = await prisma.user.findMany({
    where,
    include: { collaborator: true, moduleRoles: true },
    orderBy: [{ role: 'asc' }, { name: 'asc' }]
  });

  const clientUsers = users.filter(user => user.role === UserRole.CLIENT);

  const cnpjUsernames = clientUsers
    .flatMap(u => [u.username, u.clientCnpj])
    .filter(Boolean)
    .map(value => String(value).replace(/\D/g, ''))
    .filter(value => /^\d{14}$/.test(value));
  const accountEmails = Array.from(new Set(clientUsers
    .flatMap(u => [u.username, u.email])
    .filter(Boolean)
    .map(e => String(e).trim().toLowerCase())
    .filter(e => e.includes('@'))));

  const linkedProjectSelect = {
    id: true,
    clientCnpj: true,
    clientEmailPrimary: true,
    clientEmailCc: true,
    clientSigners: true,
    code: true,
    name: true,
    contractCode: true,
    isActive: true
  };
  const directLinkedProjects = clientUsers.length
    ? await prisma.project.findMany({
        where: {
          managerOnly: false,
          deletedAt: null,
          OR: [
            ...(cnpjUsernames.length ? [{ clientCnpj: { in: cnpjUsernames } }] : []),
            ...(accountEmails.length ? [
              ...accountEmails.map(email => ({ clientEmailPrimary: { equals: email, mode: 'insensitive' } })),
              { clientEmailCc: { hasSome: accountEmails } }
            ] : [])
          ]
        },
        orderBy: [{ name: 'asc' }],
        select: linkedProjectSelect
      })
    : [];
  const signerLinkedProjects = clientUsers.length && accountEmails.length
    ? (await prisma.project.findMany({
        where: {
          managerOnly: false,
          deletedAt: null
        },
        orderBy: [{ name: 'asc' }],
        select: linkedProjectSelect
      })).filter(project => projectHasClientSignerEmail(project, accountEmails))
    : [];
  const linkedProjects = Array.from(new Map([
    ...directLinkedProjects,
    ...signerLinkedProjects
  ].map(project => [project.id, project])).values());

  res.json(users.map(user => {
    const isCnpj = /^\d{14}$/.test(user.username);
    const storedClientCnpj = String(user.clientCnpj || '').replace(/\D/g, '') || null;
    const userEmail = String(user.email || '').toLowerCase();
    const projects = linkedProjects.filter(p => {
      if ((isCnpj && p.clientCnpj === user.username) || (storedClientCnpj && p.clientCnpj === storedClientCnpj)) return true;
      if (!isCnpj && userEmail && String(p.clientEmailPrimary || '').toLowerCase() === userEmail) return true;
      if (!isCnpj && userEmail && Array.isArray(p.clientEmailCc) && p.clientEmailCc.some(cc => cc.toLowerCase() === userEmail)) return true;
      if (!isCnpj && userEmail && projectHasClientSignerEmail(p, [userEmail])) return true;
      return false;
    });
    return {
      ...publicUser(user),
      linkedProjects: projects,
      clientCnpj: storedClientCnpj || (isCnpj ? user.username : (linkedProjects.find(p =>
        String(p.clientEmailPrimary || '').toLowerCase() === userEmail
        || (Array.isArray(p.clientEmailCc) && p.clientEmailCc.some(cc => cc.toLowerCase() === userEmail))
        || projectHasClientSignerEmail(p, [userEmail])
      )?.clientCnpj || null))
    };
  }));
}));

router.post('/', asyncHandler(async (req, res) => {
  const data = schema.parse(req.body);
  if (!data.password) {
    return res.status(400).json({ error: 'Senha obrigatória para novo usuário.' });
  }

  const accountPayload = resolveAccountPayload(data);
  await assertAccountEmailAvailable(data.email);
  await assertAccountEmailAvailable(data.username);
  const passwordHash = await hashPassword(data.password);
  const user = await prisma.user.create({
    data: {
      username: data.username,
      name: data.name,
      email: data.email || null,
      emailVerifiedAt: data.email ? new Date() : null,
      passwordHash,
      role: accountPayload.role,
      accountType: accountPayload.accountType,
      clientCnpj: clientCnpjForAccount(data.username, accountPayload.accountType),
      isActive: data.isActive ?? true,
      collaboratorId: accountPayload.collaboratorId || null,
      moduleRoles: {
        create: moduleRoleRows('', accountPayload.moduleRoles).map(({ module, role }) => ({ module, role }))
      }
    },
    include: { collaborator: true, moduleRoles: true }
  });

  if (user.email && INTERNAL_ACCOUNT_ROLES.has(user.role)) {
    const template = buildInternalUserWelcomeEmailTemplate({
      userName: user.name,
      username: user.username,
      password: data.password,
      roleLabel: INTERNAL_ROLE_LABELS[user.role],
      appUrl: env.appUrl
    });
    queueInternalAccountMail({
      to: user.email,
      ...template
    }, {
      type: 'internal-account-welcome',
      userId: user.id,
      role: user.role
    });
  }

  res.status(201).json(publicUser(user));
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const data = schema.partial().parse(req.body);
  const currentUser = await prisma.user.findUniqueOrThrow({
    where: { id: req.params.id },
    include: { moduleRoles: true }
  });
  const accountPayload = resolveAccountPayload(data, currentUser);
  if (data.email !== undefined) {
    await assertAccountEmailAvailable(data.email, req.params.id);
  }
  if (data.username !== undefined) {
    await assertAccountEmailAvailable(data.username, req.params.id);
  }
  const payload = {
    ...(data.username !== undefined ? { username: data.username } : {}),
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.email !== undefined ? {
      email: data.email || null,
      emailVerifiedAt: data.email ? new Date() : null
    } : {}),
    role: accountPayload.role,
    accountType: accountPayload.accountType,
    clientCnpj: clientCnpjForAccount(data.username !== undefined ? data.username : currentUser.username, accountPayload.accountType),
    ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    collaboratorId: accountPayload.collaboratorId || null,
    ...(data.password ? { passwordHash: await hashPassword(data.password) } : {}),
    ...(data.moduleRoles !== undefined || accountShapeChanged(data, currentUser)
      ? {
          moduleRoles: {
            deleteMany: {},
            create: moduleRoleRows(req.params.id, accountPayload.moduleRoles).map(({ module, role }) => ({ module, role }))
          }
        }
      : {})
  };

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: payload,
    include: { collaborator: true, moduleRoles: true }
  });

  res.json(publicUser(user));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await prisma.user.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

router.post('/:id/resend-client-access', asyncHandler(async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.params.id }
  });

  if (user.role !== UserRole.CLIENT) {
    return res.status(400).json({ error: 'Esta ação é exclusiva para contas CLIENT.' });
  }

  if (!user.email) {
    return res.status(400).json({ error: 'A conta CLIENT não possui e-mail principal cadastrado.' });
  }

  const missingConfig = missingClientAccessResetConfig(env, getMissingMailerConfig());
  if (clientEmailsEnabled() && missingConfig.length) {
    return res.status(400).json({
      error: `Configuração ausente: ${missingConfig.join(', ')}`
    });
  }

  await sendClientAccessResetEmail({
    user,
    prismaClient: prisma,
    envConfig: env,
    createToken: createPasswordResetToken,
    mailer: sendClientMail,
    templateBuilder: buildPasswordResetEmailTemplate
  });

  res.json({ ok: true });
}));

export default router;
