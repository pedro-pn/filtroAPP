import { randomBytes } from 'node:crypto';

import env from '../config/env.js';
import { buildClientProjectLinkedEmailTemplate, buildClientWelcomeEmailTemplate } from './email-templates.js';
import { getMissingMailerConfig, sendMail } from './mailer.js';
import { hashPassword } from './password.js';

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

export async function ensureClientAccountForProject(prisma, projectData, options = {}) {
  const project = projectData || {};
  const previousProject = options.previousProject || null;
  const shouldNotify = options.notify !== false;
  const clientCnpj = String(project.clientCnpj || '').trim();
  const primaryEmail = String(project.clientEmailPrimary || '').trim().toLowerCase();

  if (!clientCnpj || clientCnpj.length !== 14 || !primaryEmail) {
    return { user: null, created: false, notified: false };
  }

  const existingUser = await prisma.user.findFirst({
    where: { username: { equals: clientCnpj, mode: 'insensitive' } },
    include: { collaborator: true }
  });

  let user = existingUser;
  let created = false;
  let initialPassword = '';

  if (user) {
    if (user.role !== 'CLIENT') {
      throw new Error(`Já existe um usuário interno com o identificador ${clientCnpj}.`);
    }

    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        name: project.clientName,
        email: primaryEmail,
        isActive: true
      },
      include: { collaborator: true }
    });
  } else {
    initialPassword = generateClientPassword();
    const passwordHash = await hashPassword(initialPassword);
    user = await prisma.user.create({
      data: {
        username: clientCnpj,
        name: project.clientName,
        email: primaryEmail,
        passwordHash,
        role: 'CLIENT',
        isActive: true
      },
      include: { collaborator: true }
    });
    created = true;
  }

  let notified = false;

  if (created && shouldNotify) {
    const template = buildClientWelcomeEmailTemplate({
      clientName: project.clientName,
      cnpj: clientCnpj,
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

  return { user, created, notified };
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
