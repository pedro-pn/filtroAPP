import { randomInt } from 'node:crypto';

import env from '../config/env.js';
import { buildClientProjectLinkedEmailTemplate, buildClientWelcomeEmailTemplate } from './email-templates.js';
import { getMissingMailerConfig, sendMail } from './mailer.js';
import { hashPassword } from './password.js';

function generateClientPassword() {
  return String(randomInt(0, 1000000)).padStart(6, '0');
}

function queueClientMail(message, meta) {
  const missingMailerConfig = getMissingMailerConfig();
  if (missingMailerConfig.length) {
    console.warn('Notificacao de conta CLIENT nao enviada por falta de configuracao SMTP.', {
      missingMailerConfig,
      meta
    });
    return;
  }

  setImmediate(() => {
    sendMail(message).catch(error => {
      console.error('Falha ao enviar notificacao da conta CLIENT.', {
        meta,
        error: error?.message || error
      });
    });
  });
}

export async function ensureClientAccountForProject(prisma, projectData, options = {}) {
  const project = projectData || {};
  const previousProject = options.previousProject || null;
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
      throw new Error(`Ja existe um usuario interno com o identificador ${clientCnpj}.`);
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

  if (created) {
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
  } else {
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
