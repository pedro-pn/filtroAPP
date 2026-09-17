import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isProjectWorkflowAlertWindow,
  processProjectWorkflowEmailAlerts
} from '../src/lib/efetivo/project-workflow/email-alerts.js';

function workflow(overrides = {}) {
  return {
    projectId: 'project-1',
    stage: 'MOBILIZATION_PLANNING',
    plannedMobilizationDate: new Date('2026-10-17T00:00:00.000Z'),
    project: { code: 'P-001', name: 'Projeto teste', clientName: 'Cliente teste' },
    leader: { id: 'leader-1', name: 'Líder', email: 'lider@example.com', isActive: true },
    planner: { id: 'planner-1', name: 'Planejador', email: 'planejador@example.com', isActive: true },
    issues: [{ description: 'Equipamento especial pendente', dueDate: new Date('2026-10-10T00:00:00.000Z') }],
    ...overrides
  };
}

function clientFor(workflows, sentLogs = []) {
  const upserts = [];
  return {
    upserts,
    projectWorkflow: { findMany: async () => workflows },
    projectWorkflowEmailNotification: {
      findMany: async () => sentLogs,
      upsert: async input => {
        upserts.push(input);
        return input.create;
      }
    }
  };
}

test('janela do job usa o horário de São Paulo', () => {
  assert.equal(isProjectWorkflowAlertWindow(new Date('2026-09-17T10:30:00.000Z')), true);
  assert.equal(isProjectWorkflowAlertWindow(new Date('2026-09-17T13:30:00.000Z')), false);
});

test('alerta envia para líder e planejador e registra cada marco sem duplicar destinatários', async () => {
  const client = clientFor([workflow()]);
  const messages = [];
  const result = await processProjectWorkflowEmailAlerts({
    client,
    mailer: async message => messages.push(message),
    now: new Date('2026-09-17T12:00:00.000Z'),
    missingMailerConfig: []
  });

  assert.equal(result.projectsNotified, 1);
  assert.equal(result.emailsSent, 2);
  assert.deepEqual(messages.map(message => message.to).sort(), ['lider@example.com', 'planejador@example.com']);
  assert.ok(messages.every(message => message.subject.includes('D-30')));
  assert.ok(messages.every(message => message.text.includes('Equipamento especial pendente')));
  assert.equal(client.upserts.length, 4);
  assert.ok(client.upserts.every(input => input.create.status === 'SENT'));

  const duplicateClient = clientFor([workflow({
    planner: { id: 'planner-1', name: 'Planejador', email: 'LIDER@example.com', isActive: true }
  })]);
  const duplicateMessages = [];
  await processProjectWorkflowEmailAlerts({
    client: duplicateClient,
    mailer: async message => duplicateMessages.push(message),
    now: new Date('2026-09-17T12:00:00.000Z'),
    missingMailerConfig: []
  });
  assert.equal(duplicateMessages.length, 1);
});

test('marco já enviado para a data vigente não gera novo e-mail', async () => {
  const current = workflow({ issues: [] });
  const sentLogs = ['D90', 'D30'].map(milestone => ({
    projectId: current.projectId,
    milestone,
    plannedMobilizationDate: current.plannedMobilizationDate,
    recipientEmail: current.leader.email
  }));
  const client = clientFor([current], sentLogs);
  const messages = [];
  await processProjectWorkflowEmailAlerts({
    client,
    mailer: async message => messages.push(message),
    now: new Date('2026-09-17T12:00:00.000Z'),
    missingMailerConfig: []
  });
  assert.equal(messages.filter(message => message.to === 'lider@example.com').length, 0);
  assert.equal(messages.filter(message => message.to === 'planejador@example.com').length, 1);
});

