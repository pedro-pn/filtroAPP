import { randomBytes } from 'node:crypto';

import env from '../config/env.js';
import { buildClientProjectLinkedEmailTemplate, buildClientWelcomeEmailTemplate } from './email-templates.js';
import { getMissingMailerConfig, sendMail } from './mailer.js';
import { defaultPublicModuleRolesForLegacyRole, moduleRoleRows } from './module-roles.js';
import { hashPassword } from './password.js';

const CLIENT_MODULE_ROLES = defaultPublicModuleRolesForLegacyRole('CLIENT');

const CC_WELCOME_SUBJECT_PREFIX = '[Filtrovali] Acesso ao portal do cliente criado';

function generateClientPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*_-';
  const bytes = randomBytes(12);
  let password = '';
  for (let i = 0; i < bytes.length; i += 1) {
    password += alphabet[bytes[i] % alphabet.length];
  }
  return password;
}

function queueClientMail(message, meta) {
  const missingMailerConfig = getMissingMailerConfig();
  if (missingMailerConfig.length) {
    console.warn('Notificação de conta CLIENT não enviada por falta de configuração SMTP.', {
      missingMailerConfig,
      meta
    });
    return;
  }

  setImmediate(() => {
    sendMail(message).catch(error => {
      console.error('Falha ao enviar notificação da conta CLIENT.', {
        meta,
        error: error?.message || error
      });
    });
  });
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

async function findClientUserForEmail(prisma, email, options = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;
  const throwOnInternalUsername = options.throwOnInternalUsername !== false;

  const usernameMatch = await prisma.user.findFirst({
    where: { username: { equals: normalizedEmail, mode: 'insensitive' } },
    include: { collaborator: true, moduleRoles: true }
  });
  if (usernameMatch) {
    if (usernameMatch.role !== 'CLIENT') {
      if (!throwOnInternalUsername) return null;
      throw new Error(`Já existe um usuário interno com o identificador ${normalizedEmail}.`);
    }
    return usernameMatch;
  }

  const emailMatch = await prisma.user.findFirst({
    where: {
      role: 'CLIENT',
      email: { equals: normalizedEmail, mode: 'insensitive' }
    },
    include: { collaborator: true, moduleRoles: true },
    orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }, { createdAt: 'asc' }]
  });
  if (!emailMatch) return null;

  return prisma.user.update({
    where: { id: emailMatch.id },
    data: {
      username: normalizedEmail,
      email: normalizedEmail,
      emailVerifiedAt: new Date()
    },
    include: { collaborator: true, moduleRoles: true }
  });
}

async function deactivateDuplicateClientEmailAccounts(prisma, email, keepUserId) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !keepUserId) return;

  await prisma.user.updateMany({
    where: {
      role: 'CLIENT',
      id: { not: keepUserId },
      OR: [
        { username: { equals: normalizedEmail, mode: 'insensitive' } },
        { email: { equals: normalizedEmail, mode: 'insensitive' } }
      ]
    },
    data: { isActive: false }
  });
}

function projectDataIncludesClientEmail(projectData, email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return false;
  if (normalizeEmail(projectData?.clientEmailPrimary) === normalizedEmail) return true;
  if (Array.isArray(projectData?.clientEmailCc)
    && projectData.clientEmailCc.some(value => normalizeEmail(value) === normalizedEmail)) {
    return true;
  }
  return Array.isArray(projectData?.clientSigners)
    && projectData.clientSigners.some(value => normalizeEmail(value?.email) === normalizedEmail);
}

async function deactivateClientEmailIfUnlinked(prisma, email, projectData) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || projectDataIncludesClientEmail(projectData, normalizedEmail)) return;

  const stillLinked = await prisma.project.findFirst({
    where: {
      OR: [
        { clientEmailPrimary: { equals: normalizedEmail, mode: 'insensitive' } },
        { clientEmailCc: { has: normalizedEmail } }
      ],
      ...(projectData?.id ? { id: { not: projectData.id } } : {})
    }
  });
  if (stillLinked) return;

  if (typeof prisma.project.findMany === 'function') {
    const signerLinkedProjects = await prisma.project.findMany({
      where: {
        ...(projectData?.id ? { id: { not: projectData.id } } : {})
      },
      select: {
        clientSigners: true
      }
    });
    if (signerLinkedProjects.some(project => projectDataIncludesClientEmail(project, normalizedEmail))) return;
  }

  await prisma.user.updateMany({
    where: {
      role: 'CLIENT',
      OR: [
        { username: { equals: normalizedEmail, mode: 'insensitive' } },
        { email: { equals: normalizedEmail, mode: 'insensitive' } }
      ]
    },
    data: { isActive: false }
  });
}

export async function ensureClientAccountForProject(prisma, projectData, options = {}) {
  const project = projectData || {};
  const previousProject = options.previousProject || null;
  const shouldNotify = options.notify !== false;
  const clientCnpj = String(project.clientCnpj || '').trim();
  const primaryEmail = normalizeEmail(project.clientEmailPrimary);

  if (!clientCnpj || clientCnpj.length !== 14 || !primaryEmail) {
    return { user: null, created: false, notified: false };
  }

  let user = await findClientUserForEmail(prisma, primaryEmail);
  let created = false;
  let initialPassword = '';

  if (user) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        name: project.clientName,
        username: primaryEmail,
        email: primaryEmail,
        emailVerifiedAt: new Date(),
        clientCnpj,
        isActive: true,
        accountType: 'CLIENT',
        moduleRoles: {
          deleteMany: {},
          create: moduleRoleRows(user.id, CLIENT_MODULE_ROLES).map(({ module, role }) => ({ module, role }))
        }
      },
      include: { collaborator: true, moduleRoles: true }
    });
  } else {
    initialPassword = generateClientPassword();
    const passwordHash = await hashPassword(initialPassword);
    user = await prisma.user.create({
      data: {
        username: primaryEmail,
        name: project.clientName,
        email: primaryEmail,
        emailVerifiedAt: new Date(),
        passwordHash,
        role: 'CLIENT',
        clientCnpj,
        accountType: 'CLIENT',
        isActive: true,
        moduleRoles: {
          create: moduleRoleRows('', CLIENT_MODULE_ROLES).map(({ module, role }) => ({ module, role }))
        }
      },
      include: { collaborator: true, moduleRoles: true }
    });
    created = true;
  }
  await deactivateDuplicateClientEmailAccounts(prisma, primaryEmail, user.id);

  let notified = false;

  if (created && shouldNotify) {
    const template = buildClientWelcomeEmailTemplate({
      clientName: project.clientName,
      cnpj: primaryEmail,
      password: initialPassword,
      appUrl: env.appUrl,
      projectCode: project.code,
      projectName: project.name
    });
    queueClientMail({
      to: primaryEmail,
      ...template
    }, {
      type: 'client-welcome',
      userId: user.id,
      projectCode: project.code
    });
    notified = true;
  } else if (shouldNotify) {
    const notifyExisting =
      !previousProject ||
      previousProject.managerOnly ||
      String(previousProject.clientCnpj || '') !== clientCnpj ||
      String(previousProject.clientEmailPrimary || '').trim().toLowerCase() !== primaryEmail;

    if (notifyExisting) {
      const template = buildClientProjectLinkedEmailTemplate({
        clientName: project.clientName,
        appUrl: env.appUrl,
        projectCode: project.code,
        projectName: project.name,
        contractCode: project.contractCode
      });
      queueClientMail({
        to: primaryEmail,
        ...template
      }, {
        type: 'client-project-linked',
        userId: user.id,
        projectCode: project.code
      });
      notified = true;
    }
  }

  const previousPrimaryEmail = normalizeEmail(previousProject?.clientEmailPrimary);
  if (previousPrimaryEmail && previousPrimaryEmail !== primaryEmail) {
    await deactivateClientEmailIfUnlinked(prisma, previousPrimaryEmail, project);
  }

  return { user, created, notified };
}

export async function ensureClientCcAccounts(prisma, projectData, options = {}) {
  const ccEmails = Array.isArray(projectData.clientEmailCc)
    ? projectData.clientEmailCc.map(normalizeEmail).filter(Boolean)
    : [];
  const clientSigners = Array.isArray(projectData.clientSigners) ? projectData.clientSigners : [];
  const previousProject = options.previousProject || null;
  const shouldNotify = options.notify !== false;

  for (const email of ccEmails) {
    const signerEntry = clientSigners.find(s => normalizeEmail(s?.email) === email);
    const name = signerEntry?.name || projectData.clientName;

    const existingUser = await findClientUserForEmail(prisma, email, { throwOnInternalUsername: false });

    if (existingUser) {
      await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          name,
          username: email,
          email,
          emailVerifiedAt: new Date(),
          clientCnpj: projectData.clientCnpj,
          isActive: true,
          accountType: 'CLIENT',
          moduleRoles: {
            deleteMany: {},
            create: moduleRoleRows(existingUser.id, CLIENT_MODULE_ROLES).map(({ module, role }) => ({ module, role }))
          }
        }
      });
      await deactivateDuplicateClientEmailAccounts(prisma, email, existingUser.id);
      continue;
    }

    const usernameOwner = await prisma.user.findFirst({
      where: { username: { equals: email, mode: 'insensitive' } }
    });
    if (usernameOwner && usernameOwner.role !== 'CLIENT') continue;

    const initialPassword = generateClientPassword();
    const passwordHash = await hashPassword(initialPassword);
    const user = await prisma.user.create({
      data: {
        username: email,
        name,
        email,
        emailVerifiedAt: new Date(),
        passwordHash,
        role: 'CLIENT',
        clientCnpj: projectData.clientCnpj,
        accountType: 'CLIENT',
        isActive: true,
        moduleRoles: {
          create: moduleRoleRows('', CLIENT_MODULE_ROLES).map(({ module, role }) => ({ module, role }))
        }
      }
    });

    if (shouldNotify) {
      const template = buildClientWelcomeEmailTemplate({
        clientName: name,
        cnpj: email,
        password: initialPassword,
        appUrl: env.appUrl,
        projectCode: projectData.code,
        projectName: projectData.name
      });
      queueClientMail({ to: email, ...template }, {
        type: 'client-cc-welcome',
        userId: user.id,
        projectCode: projectData.code
      });
    }
    await deactivateDuplicateClientEmailAccounts(prisma, email, user.id);
  }

  if (previousProject && Array.isArray(previousProject.clientEmailCc)) {
    const removedEmails = previousProject.clientEmailCc
      .map(normalizeEmail)
      .filter(e => e && !ccEmails.includes(e));

    for (const email of removedEmails) {
      await deactivateClientEmailIfUnlinked(prisma, email, projectData);
    }
  }
}

export async function ensureClientAccountForCnpj(prisma, clientCnpj, options = {}) {
  const normalizedCnpj = String(clientCnpj || '').trim();
  if (!normalizedCnpj || normalizedCnpj.length !== 14) {
    return { user: null, created: false, notified: false };
  }

  const project = await prisma.project.findFirst({
    where: {
      clientCnpj: normalizedCnpj,
      clientEmailPrimary: { not: '' }
    },
    orderBy: [
      { isActive: 'desc' },
      { updatedAt: 'desc' },
      { createdAt: 'desc' }
    ]
  });

  if (!project) {
    return { user: null, created: false, notified: false };
  }

  return ensureClientAccountForProject(prisma, project, {
    notify: options.notify !== false
  });
}
