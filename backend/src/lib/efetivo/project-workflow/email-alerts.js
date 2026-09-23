import env from '../../../config/env.js';
import {
  buildProjectWorkflowClientRegistrationEmailTemplate,
  buildProjectWorkflowMilestoneEmailTemplate,
  buildProjectWorkflowResourceConflictEmailTemplate
} from '../../email-templates.js';
import { runTrackedJob } from '../../jobs/runner.js';
import { getMissingMailerConfig, outboundEmailsEnabled, sendMail } from '../../mailer.js';
import prisma from '../../prisma.js';
import {
  PROJECT_WORKFLOW_STAGE_LABELS,
  isHeadquartersWorkflow,
  projectWorkflowMilestones,
  projectWorkflowReferenceDate
} from '../../../../../shared/schemas/project-workflow.js';

const ALERT_INTERVAL_MS = 30 * 60 * 1000;
const ALERT_TIME_ZONE = 'America/Sao_Paulo';
const ALERT_WINDOW_START_HOUR = 7;
const ALERT_WINDOW_END_HOUR = 10;
const ALERT_STAGES = ['HANDOVER', 'INITIAL_ANALYSIS', 'WAITING_PLANNING', 'MOBILIZATION_PLANNING', 'PREPARATION'];

const HEADQUARTERS_MILESTONE_DESCRIPTIONS = {
  D90: 'Revisar itens de longo prazo, documentos técnicos e insumos especiais.',
  D30: 'Concluir o planejamento da equipe; equipamentos, materiais e logística são opcionais na Sede.'
};

const MILESTONE_DESCRIPTIONS = {
  D90: 'Revisar itens de longo prazo, documentos adicionais, exames, treinamentos e insumos especiais.',
  D30: 'Concluir o planejamento de equipe, equipamentos, materiais e logística.',
  D15: 'Confirmar equipe, liberações do cliente, recursos, pré-job, viagem e QSMS.',
  D7: 'Revisar todos os avisos e pendências ainda abertos antes da mobilização.',
  D1: 'Tratar imediatamente qualquer risco restante para a mobilização.'
};

function dateKey(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10) || null;
}

function utcDate(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function localDateKey(value = new Date(), timeZone = ALERT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone
  }).formatToParts(value);
  const part = type => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function hourInTimeZone(now, timeZone = ALERT_TIME_ZONE) {
  const hour = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', hour12: false, timeZone
  }).formatToParts(now).find(part => part.type === 'hour')?.value;
  return Number(hour);
}

export function isProjectWorkflowAlertWindow(now = new Date(), timeZone = ALERT_TIME_ZONE) {
  const hour = hourInTimeZone(now, timeZone);
  return hour >= ALERT_WINDOW_START_HOUR && hour < ALERT_WINDOW_END_HOUR;
}

function alertRecipients(workflow) {
  const users = [workflow.leader, workflow.planner].filter(user => user?.isActive && user?.email?.trim());
  const byEmail = new Map();
  for (const user of users) {
    const email = user.email.trim().toLocaleLowerCase('pt-BR');
    if (!byEmail.has(email)) byEmail.set(email, { userId: user.id, name: user.name, email });
  }
  return [...byEmail.values()];
}

// Os marcos contam a partir da mobilização em campo ou, na Sede, do início da execução prevista. A coluna
// `plannedMobilizationDate` do registro de aviso guarda essa data-base, para o aviso ser enviado uma vez por data.
function withReferenceDate(workflow) {
  return { ...workflow, plannedMobilizationDate: projectWorkflowReferenceDate(workflow) };
}

function notificationKey({ projectId, milestone, plannedMobilizationDate, recipientEmail }) {
  return [projectId, milestone, dateKey(plannedMobilizationDate), recipientEmail.toLocaleLowerCase('pt-BR')].join('|');
}

function projectUrl(projectId) {
  const base = String(env.appUrl || '').replace(/\/$/, '');
  return base ? `${base}/efetivo?section=evolucao&projeto=${encodeURIComponent(projectId)}` : '';
}

async function recordNotification(client, workflow, recipient, milestone, now, status, error = null) {
  const plannedMobilizationDate = utcDate(dateKey(workflow.plannedMobilizationDate));
  return client.projectWorkflowEmailNotification.upsert({
    where: {
      projectId_milestone_plannedMobilizationDate_recipientEmail: {
        projectId: workflow.projectId,
        milestone,
        plannedMobilizationDate,
        recipientEmail: recipient.email
      }
    },
    create: {
      projectId: workflow.projectId,
      milestone,
      plannedMobilizationDate,
      recipientUserId: recipient.userId,
      recipientEmail: recipient.email,
      status,
      attempts: 1,
      lastAttemptAt: now,
      sentAt: status === 'SENT' ? now : null,
      error
    },
    update: {
      recipientUserId: recipient.userId,
      status,
      attempts: { increment: 1 },
      lastAttemptAt: now,
      sentAt: status === 'SENT' ? now : null,
      error
    }
  });
}

/**
 * Avisa o Líder e o Gestor de Contrato quando a mudança da data de mobilização deixa a equipe ou os equipamentos
 * definidos incompatíveis. Cada tipo de conflito é enviado uma vez por data e destinatário; falhas de envio
 * ficam registradas, mas nunca desfazem a alteração da data.
 */
export async function notifyProjectWorkflowResourceConflicts({
  client = prisma,
  mailer = sendMail,
  projectId,
  conflicts = [],
  now = new Date(),
  missingMailerConfig = getMissingMailerConfig(),
  logger = console
} = {}) {
  if (!conflicts.length) return { emailsSent: 0 };
  if (mailer === sendMail && !outboundEmailsEnabled()) return { emailsSent: 0, skipped: true, reason: 'outbound_emails_disabled' };
  if (mailer === sendMail && missingMailerConfig.length) return { emailsSent: 0, skipped: true, reason: 'mailer_not_configured' };
  const workflow = await client.projectWorkflow.findUnique({
    where: { projectId },
    select: {
      projectId: true,
      stage: true,
      executedAtHeadquarters: true,
      plannedMobilizationDate: true,
      plannedExecutionStartDate: true,
      project: { select: { code: true, name: true, clientName: true } },
      leader: { select: { id: true, name: true, email: true, isActive: true } },
      planner: { select: { id: true, name: true, email: true, isActive: true } }
    }
  });
  if (!workflow || !projectWorkflowReferenceDate(workflow)) return { emailsSent: 0 };
  workflow.plannedMobilizationDate = projectWorkflowReferenceDate(workflow);
  const recipients = alertRecipients(workflow);
  const milestoneOf = conflict => `RESOURCE_${conflict.type}`;
  const sentLogs = recipients.length && client.projectWorkflowEmailNotification?.findMany
    ? await client.projectWorkflowEmailNotification.findMany({
      where: { projectId, status: 'SENT', milestone: { in: conflicts.map(milestoneOf) } },
      select: { projectId: true, milestone: true, plannedMobilizationDate: true, recipientEmail: true }
    })
    : [];
  const sentKeys = new Set(sentLogs.map(notificationKey));
  let emailsSent = 0;
  for (const recipient of recipients) {
    const pending = conflicts.filter(conflict => !sentKeys.has(notificationKey({
      projectId,
      milestone: milestoneOf(conflict),
      plannedMobilizationDate: workflow.plannedMobilizationDate,
      recipientEmail: recipient.email
    })));
    if (!pending.length) continue;
    const template = buildProjectWorkflowResourceConflictEmailTemplate({
      recipientName: recipient.name,
      projectCode: workflow.project.code,
      projectName: workflow.project.name,
      clientName: workflow.project.clientName,
      stageLabel: PROJECT_WORKFLOW_STAGE_LABELS[workflow.stage] || workflow.stage,
      plannedMobilizationDate: workflow.plannedMobilizationDate,
      conflicts: pending,
      appUrl: projectUrl(projectId)
    });
    try {
      await mailer({ to: recipient.email, ...template });
      for (const conflict of pending) await recordNotification(client, workflow, recipient, milestoneOf(conflict), now, 'SENT');
      emailsSent += 1;
    } catch (error) {
      const message = String(error?.message || error).slice(0, 2000);
      for (const conflict of pending) await recordNotification(client, workflow, recipient, milestoneOf(conflict), now, 'FAILED', message);
      logger.error('Falha ao avisar incompatibilidade de recursos da gestão de projetos.', { projectId, recipient: recipient.email, error: message });
    }
  }
  return { emailsSent };
}

/**
 * Avisa o Administrativo quando o Líder confirma, nos itens críticos da Análise inicial, que é necessário o
 * cadastro da Filtrovali junto ao cliente. Envio único e melhor esforço: falhas não desfazem a solicitação já
 * registrada, apenas ficam no log.
 */
export async function notifyProjectWorkflowClientRegistrationRequested({
  client = prisma,
  mailer = sendMail,
  projectId,
  email,
  now = new Date(),
  missingMailerConfig = getMissingMailerConfig(),
  logger = console
} = {}) {
  if (!email) return { emailsSent: 0 };
  if (mailer === sendMail && !outboundEmailsEnabled()) return { emailsSent: 0, skipped: true, reason: 'outbound_emails_disabled' };
  if (mailer === sendMail && missingMailerConfig.length) return { emailsSent: 0, skipped: true, reason: 'mailer_not_configured' };
  const workflow = await client.projectWorkflow.findUnique({
    where: { projectId },
    select: {
      projectId: true,
      project: { select: { code: true, name: true, clientName: true } },
      leader: { select: { name: true } }
    }
  });
  if (!workflow) return { emailsSent: 0 };
  const template = buildProjectWorkflowClientRegistrationEmailTemplate({
    projectCode: workflow.project.code,
    projectName: workflow.project.name,
    clientName: workflow.project.clientName,
    leaderName: workflow.leader?.name || '',
    appUrl: projectUrl(projectId)
  });
  try {
    await mailer({ to: email, ...template });
    return { emailsSent: 1 };
  } catch (error) {
    const message = String(error?.message || error).slice(0, 2000);
    logger.error('Falha ao avisar solicitação de cadastro de cliente.', { projectId, email, error: message, now });
    return { emailsSent: 0, error: message };
  }
}

export async function processProjectWorkflowEmailAlerts({
  client = prisma,
  mailer = sendMail,
  now = new Date(),
  missingMailerConfig = getMissingMailerConfig(),
  logger = console
} = {}) {
  if (mailer === sendMail && !outboundEmailsEnabled()) {
    return { checked: 0, projectsNotified: 0, emailsSent: 0, skipped: true, reason: 'outbound_emails_disabled' };
  }
  if (mailer === sendMail && missingMailerConfig.length) {
    return { checked: 0, projectsNotified: 0, emailsSent: 0, skipped: true, reason: 'mailer_not_configured' };
  }

  const today = localDateKey(now);
  const workflows = await client.projectWorkflow.findMany({
    where: { stage: { in: ALERT_STAGES }, project: { deletedAt: null } },
    select: {
      projectId: true,
      stage: true,
      executedAtHeadquarters: true,
      plannedMobilizationDate: true,
      plannedExecutionStartDate: true,
      preparationLeadTimeDays: true,
      project: { select: { code: true, name: true, clientName: true } },
      leader: { select: { id: true, name: true, email: true, isActive: true } },
      planner: { select: { id: true, name: true, email: true, isActive: true } },
      issues: {
        where: { status: { not: 'RESOLVED' }, criticality: 'HIGH' },
        select: { description: true, dueDate: true },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }]
      }
    }
  });

  const candidates = workflows.map(withReferenceDate).map(workflow => {
    const due = projectWorkflowMilestones(dateKey(workflow.plannedMobilizationDate), today, workflow.preparationLeadTimeDays).items.filter(item => item.due);
    return { workflow, due, recipients: alertRecipients(workflow) };
  }).filter(item => item.due.length && item.recipients.length);

  const sentLogs = candidates.length && client.projectWorkflowEmailNotification?.findMany
    ? await client.projectWorkflowEmailNotification.findMany({
      where: { projectId: { in: candidates.map(item => item.workflow.projectId) }, status: 'SENT' },
      select: { projectId: true, milestone: true, plannedMobilizationDate: true, recipientEmail: true }
    })
    : [];
  const sentKeys = new Set(sentLogs.map(notificationKey));
  let emailsSent = 0;
  const notifiedProjects = new Set();
  let failed = 0;

  for (const candidate of candidates) {
    const workflow = candidate.workflow;
    for (const recipient of candidate.recipients) {
      const pendingMilestones = candidate.due.filter(item => !sentKeys.has(notificationKey({
        projectId: workflow.projectId,
        milestone: item.key,
        plannedMobilizationDate: workflow.plannedMobilizationDate,
        recipientEmail: recipient.email
      })));
      if (!pendingMilestones.length) continue;
      const milestones = pendingMilestones.map(item => ({
        key: item.key,
        label: item.label,
        description: (isHeadquartersWorkflow(workflow) && HEADQUARTERS_MILESTONE_DESCRIPTIONS[item.key])
          || MILESTONE_DESCRIPTIONS[item.key]
          || (item.days === workflow.preparationLeadTimeDays
            ? isHeadquartersWorkflow(workflow)
              ? 'Confirmar equipe, atendimento do cliente e pré-job.'
              : 'Confirmar equipe, liberações do cliente, recursos, pré-job, viagem e QSMS.'
            : 'Revisar o planejamento do projeto.')
      }));
      const template = buildProjectWorkflowMilestoneEmailTemplate({
        recipientName: recipient.name,
        projectCode: workflow.project.code,
        projectName: workflow.project.name,
        clientName: workflow.project.clientName,
        stageLabel: PROJECT_WORKFLOW_STAGE_LABELS[workflow.stage] || workflow.stage,
        plannedMobilizationDate: workflow.plannedMobilizationDate,
        headquarters: isHeadquartersWorkflow(workflow),
        milestones,
        criticalIssues: workflow.issues.map(issue => issue.description),
        appUrl: projectUrl(workflow.projectId)
      });
      try {
        await mailer({ to: recipient.email, ...template });
        for (const milestone of pendingMilestones) {
          await recordNotification(client, workflow, recipient, milestone.key, now, 'SENT');
          sentKeys.add(notificationKey({
            projectId: workflow.projectId,
            milestone: milestone.key,
            plannedMobilizationDate: workflow.plannedMobilizationDate,
            recipientEmail: recipient.email
          }));
        }
        emailsSent += 1;
        notifiedProjects.add(workflow.projectId);
      } catch (error) {
        failed += 1;
        const message = String(error?.message || error).slice(0, 2000);
        for (const milestone of pendingMilestones) {
          await recordNotification(client, workflow, recipient, milestone.key, now, 'FAILED', message);
        }
        logger.error('Falha ao enviar alerta da gestão de projetos.', { projectId: workflow.projectId, recipient: recipient.email, error: message });
      }
    }
  }

  return { checked: workflows.length, projectsNotified: notifiedProjects.size, emailsSent, failed };
}

export function startProjectWorkflowEmailAlertJob({
  processFn = processProjectWorkflowEmailAlerts,
  nowFn = () => new Date(),
  intervalMs = ALERT_INTERVAL_MS,
  track = processFn === processProjectWorkflowEmailAlerts
} = {}) {
  const run = () => {
    if (!isProjectWorkflowAlertWindow(nowFn())) return;
    const promise = track
      ? runTrackedJob('project-workflow-email-alerts', () => processFn(), {
        lockTtlMs: intervalMs * 2,
        metadata: { intervalMs }
      })
      : Promise.resolve(processFn());
    promise.catch(error => console.error('Falha no job de alertas da gestão de projetos.', error));
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}
