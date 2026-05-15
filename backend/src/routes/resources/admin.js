import { Router } from 'express';
import { AccountType, AppModule, ModuleRoleCode, UserRole } from '@prisma/client';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import env from '../../config/env.js';
import { createPasswordResetToken, publicUser } from '../../lib/auth.js';
import { missingClientAccessResetConfig, sendClientAccessResetEmail } from '../../lib/client-access-reset.js';
import { buildInternalUserWelcomeEmailTemplate, buildPasswordResetEmailTemplate } from '../../lib/email-templates.js';
import { getMissingMailerConfig, sendMail } from '../../lib/mailer.js';
import { hashPassword } from '../../lib/password.js';
import prisma from '../../lib/prisma.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';

const router = Router();

router.use(requireAuth, requireAdmin);

const moduleRoleSchema = z.object({
  module: z.nativeEnum(AppModule),
  role: z.nativeEnum(ModuleRoleCode)
});

const createAccountSchema = z.object({
  username: z.string().min(1),
  name: z.string().min(1),
  email: z.union([z.string().trim().email(), z.literal(''), z.null()]).optional(),
  password: z.string().min(6),
  accountType: z.nativeEnum(AccountType),
  moduleRoles: z.array(moduleRoleSchema).optional().default([])
});

const updateAccountSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.union([z.string().trim().email(), z.literal(''), z.null()]).optional(),
  password: z.string().min(6).optional(),
  isActive: z.boolean().optional(),
  accountType: z.nativeEnum(AccountType).optional(),
  moduleRoles: z.array(moduleRoleSchema).optional()
});

function resolvedLegacyRole(accountType, moduleRoles) {
  if (accountType === AccountType.CLIENT) return UserRole.CLIENT;
  if (accountType === AccountType.ADMIN) return UserRole.MANAGER;

  if (moduleRoles.some(mr => mr.module === AppModule.RDO && mr.role === ModuleRoleCode.RDO_COORDINATOR)) {
    return UserRole.COORDINATOR;
  }
  if (moduleRoles.some(mr => mr.module === AppModule.RDO && mr.role === ModuleRoleCode.RDO_COLLABORATOR)) {
    return UserRole.COLLABORATOR;
  }
  return UserRole.COLLABORATOR;
}

function moduleRolesForAccountType(accountType) {
  if (accountType === AccountType.CLIENT) {
    return [{ module: AppModule.RDO, role: ModuleRoleCode.RDO_CLIENT }];
  }
  if (accountType === AccountType.ADMIN) {
    return [{ module: AppModule.RDO, role: ModuleRoleCode.RDO_MANAGER }];
  }
  return [];
}

router.get('/accounts', asyncHandler(async (req, res) => {
  const typeFilter = String(req.query.type || '').trim().toUpperCase();
  const moduleFilter = String(req.query.module || '').trim().toUpperCase();

  const where = {};
  if (typeFilter && AccountType[typeFilter]) {
    where.accountType = AccountType[typeFilter];
  }
  if (moduleFilter && AppModule[moduleFilter]) {
    where.moduleRoles = { some: { module: AppModule[moduleFilter] } };
  }

  const users = await prisma.user.findMany({
    where,
    include: { collaborator: true, moduleRoles: true },
    orderBy: [{ accountType: 'asc' }, { name: 'asc' }]
  });

  const clientUsers = users.filter(u => u.accountType === AccountType.CLIENT);
  const cnpjUsernames = clientUsers.map(u => u.username).filter(u => /^\d{14}$/.test(u));
  const ccEmails = clientUsers.map(u => u.email).filter(Boolean).map(e => e.toLowerCase());

  const linkedProjects = clientUsers.length
    ? await prisma.project.findMany({
        where: {
          OR: [
            ...(cnpjUsernames.length ? [{ clientCnpj: { in: cnpjUsernames } }] : []),
            ...(ccEmails.length ? [{ clientEmailCc: { hasSome: ccEmails } }] : [])
          ]
        },
        orderBy: [{ name: 'asc' }],
        select: {
          clientCnpj: true,
          clientEmailCc: true,
          code: true,
          name: true,
          contractCode: true,
          isActive: true
        }
      })
    : [];

  res.json(users.map(user => {
    const pub = publicUser(user);
    if (user.accountType !== AccountType.CLIENT) {
      return { ...pub, linkedProjects: [] };
    }

    const isCnpj = /^\d{14}$/.test(user.username);
    const userEmail = String(user.email || '').toLowerCase();
    const projects = linkedProjects.filter(p => {
      if (isCnpj && p.clientCnpj === user.username) return true;
      if (!isCnpj && userEmail && Array.isArray(p.clientEmailCc) && p.clientEmailCc.some(cc => cc.toLowerCase() === userEmail)) return true;
      return false;
    });
    return { ...pub, linkedProjects: projects };
  }));
}));

router.post('/accounts', asyncHandler(async (req, res) => {
  const data = createAccountSchema.parse(req.body);

  let finalModuleRoles = data.moduleRoles;
  if (data.accountType === AccountType.CLIENT) {
    finalModuleRoles = moduleRolesForAccountType(AccountType.CLIENT);
  } else if (data.accountType === AccountType.ADMIN) {
    const hasRdoManager = finalModuleRoles.some(mr => mr.module === AppModule.RDO && mr.role === ModuleRoleCode.RDO_MANAGER);
    if (!hasRdoManager) {
      finalModuleRoles = [...finalModuleRoles, ...moduleRolesForAccountType(AccountType.ADMIN)];
    }
  }

  const legacyRole = resolvedLegacyRole(data.accountType, finalModuleRoles);
  const passwordHash = await hashPassword(data.password);

  const user = await prisma.user.create({
    data: {
      username: data.username,
      name: data.name,
      email: data.email || null,
      passwordHash,
      role: legacyRole,
      accountType: data.accountType,
      isActive: true,
      moduleRoles: {
        create: finalModuleRoles
      }
    },
    include: { collaborator: true, moduleRoles: true }
  });

  if (user.email && data.accountType !== AccountType.CLIENT) {
    const roleLabels = {
      [AccountType.ADMIN]: 'administrador',
      [AccountType.INTERNAL]: 'colaborador'
    };
    const template = buildInternalUserWelcomeEmailTemplate({
      userName: user.name,
      username: user.username,
      password: data.password,
      roleLabel: roleLabels[data.accountType] || 'usuário',
      appUrl: env.appUrl
    });
    const missingMailerConfig = getMissingMailerConfig();
    if (!missingMailerConfig.length) {
      setImmediate(() => {
        sendMail({ to: user.email, ...template }).catch(error => {
          console.error('Falha ao enviar e-mail de boas-vindas.', { userId: user.id, error: error?.message || error });
        });
      });
    }
  }

  res.status(201).json(publicUser(user));
}));

router.put('/accounts/:id', asyncHandler(async (req, res) => {
  const data = updateAccountSchema.parse(req.body);

  const existing = await prisma.user.findUniqueOrThrow({
    where: { id: req.params.id },
    include: { moduleRoles: true }
  });

  if (
    existing.accountType === AccountType.CLIENT &&
    data.accountType === AccountType.ADMIN
  ) {
    const hasAdminPromotion = req.body.__confirmClientToAdmin === true;
    if (!hasAdminPromotion) {
      return res.status(422).json({
        error: 'Transformar conta CLIENT em ADMIN requer confirmação explícita (__confirmClientToAdmin: true).'
      });
    }
  }

  const newAccountType = data.accountType ?? existing.accountType;
  let moduleRolesUpdate = data.moduleRoles;

  if (newAccountType === AccountType.CLIENT) {
    moduleRolesUpdate = moduleRolesForAccountType(AccountType.CLIENT);
  } else if (data.accountType === AccountType.ADMIN && moduleRolesUpdate) {
    const hasRdoManager = moduleRolesUpdate.some(mr => mr.module === AppModule.RDO && mr.role === ModuleRoleCode.RDO_MANAGER);
    if (!hasRdoManager) {
      moduleRolesUpdate = [...moduleRolesUpdate, ...moduleRolesForAccountType(AccountType.ADMIN)];
    }
  }

  const finalModuleRoles = moduleRolesUpdate ?? existing.moduleRoles.map(mr => ({ module: mr.module, role: mr.role }));
  const legacyRole = resolvedLegacyRole(newAccountType, finalModuleRoles);

  const payload = {
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.email !== undefined ? { email: data.email || null } : {}),
    ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    ...(data.accountType !== undefined ? { accountType: data.accountType } : {}),
    role: legacyRole,
    ...(data.password ? { passwordHash: await hashPassword(data.password) } : {})
  };

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: {
      ...payload,
      ...(moduleRolesUpdate !== undefined
        ? {
            moduleRoles: {
              deleteMany: {},
              create: moduleRolesUpdate
            }
          }
        : {})
    },
    include: { collaborator: true, moduleRoles: true }
  });

  res.json(publicUser(user));
}));

router.patch('/accounts/:id/toggle', asyncHandler(async (req, res) => {
  const existing = await prisma.user.findUniqueOrThrow({
    where: { id: req.params.id },
    include: { moduleRoles: true }
  });

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { isActive: !existing.isActive },
    include: { collaborator: true, moduleRoles: true }
  });

  res.json(publicUser(user));
}));

router.post('/accounts/:id/resend-access', asyncHandler(async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.params.id }
  });

  if (user.accountType !== AccountType.CLIENT) {
    return res.status(400).json({ error: 'Esta ação é exclusiva para contas CLIENT.' });
  }

  if (!user.email) {
    return res.status(400).json({ error: 'A conta CLIENT não possui e-mail cadastrado.' });
  }

  const missingConfig = missingClientAccessResetConfig(env, getMissingMailerConfig());
  if (missingConfig.length) {
    return res.status(400).json({ error: `Configuração ausente: ${missingConfig.join(', ')}` });
  }

  await sendClientAccessResetEmail({
    user,
    prismaClient: prisma,
    envConfig: env,
    createToken: createPasswordResetToken,
    mailer: sendMail,
    templateBuilder: buildPasswordResetEmailTemplate
  });

  res.json({ ok: true });
}));

export default router;
