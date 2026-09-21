import assert from 'node:assert/strict';
import test from 'node:test';

import { notifyProjectWorkflowResourceConflicts } from '../src/lib/efetivo/project-workflow/email-alerts.js';
import {
  RESOURCE_CONFLICT_KEYS,
  detectResourceConflicts,
  isResourceConflictIssue,
  syncResourceConflictIssues
} from '../src/lib/efetivo/project-workflow/resource-conflicts.js';
import { activeProjectWorkflowIssues } from '../src/lib/efetivo/project-workflow/rules.js';

const planning = {
  team: {
    catalog: [{ id: 'role-1' }, { id: 'role-2' }],
    demands: [
      { jobRoleId: 'role-1', jobRoleName: 'Operador', requiredCount: 4, availableCount: 2 },
      { jobRoleId: 'role-2', jobRoleName: 'Mecânico', requiredCount: 1, availableCount: 3 },
      { jobRoleId: 'role-removido', jobRoleName: 'Cargo indisponível', requiredCount: 2, availableCount: 0 }
    ]
  },
  equipment: {
    categories: [{
      equipment: [
        { code: 'BOM-01', name: 'Bomba 1', availableAtMobilization: true, availabilityStatus: 'AVAILABLE', calibration: { status: 'VALID' }, maintenance: { status: 'UPCOMING' } },
        { code: 'BOM-02', name: 'Bomba 2', availableAtMobilization: false, availabilityStatus: 'RESERVED', calibration: { status: 'EXPIRED' }, maintenance: { status: 'OVERDUE' } },
        { code: 'BOM-03', name: 'Bomba 3', availableAtMobilization: false, availabilityStatus: 'ALLOCATED', calibration: { status: 'MISSING' }, maintenance: { status: 'NO_HISTORY' } }
      ]
    }]
  }
};

test('detecta cargos sem disponibilidade e equipamentos incompatíveis com a data', () => {
  const detected = detectResourceConflicts(planning, '2026-10-15');
  assert.deepEqual(detected.TEAM.items, ['Operador: necessário 4, disponível 2']);
  assert.match(detected.TEAM.description, /mobilização em 15\/10\/2026/);
  assert.equal(detected.TEAM.key, RESOURCE_CONFLICT_KEYS.TEAM);
  assert.equal(detected.EQUIPMENT.items.length, 2);
  assert.match(detected.EQUIPMENT.items[0], /BOM-02 · Bomba 2: reservado para outra obra no período; calibração vencida na data; manutenção vencida na data/);
  assert.match(detected.EQUIPMENT.items[1], /BOM-03 · Bomba 3: alocado em outra obra na data/);
  assert.equal(detected.EQUIPMENT.area, 'Ativos');
});

test('sem conflitos, nada é detectado', () => {
  const clean = { team: { catalog: [{ id: 'role-1' }], demands: [{ jobRoleId: 'role-1', requiredCount: 1, availableCount: 5 }] }, equipment: { categories: [] } };
  const detected = detectResourceConflicts(clean, '2026-10-15');
  assert.equal(detected.TEAM, null);
  assert.equal(detected.EQUIPMENT, null);
});

function fakeTx() {
  const issues = [];
  return {
    issues,
    projectWorkflowIssue: {
      upsert: async ({ where, create, update }) => {
        const existing = issues.find(item => item.sourceQuestion === where.projectId_sourceQuestion.sourceQuestion);
        if (existing) Object.assign(existing, update);
        else issues.push({ id: `issue-${issues.length + 1}`, ...create });
      },
      updateMany: async ({ where, data }) => {
        issues.filter(item => item.sourceQuestion === where.sourceQuestion).forEach(item => Object.assign(item, data));
      }
    }
  };
}

test('pendências de conflito são criadas, reabertas e resolvidas automaticamente', async () => {
  const tx = fakeTx();
  const workflow = () => ({ projectId: 'project-1', issues: tx.issues });

  let result = await syncResourceConflictIssues(tx, workflow(), detectResourceConflicts(planning, '2026-10-15'), '2026-10-15');
  assert.deepEqual(result.notify.map(item => item.type), ['TEAM', 'EQUIPMENT']);
  assert.equal(tx.issues.length, 2);
  assert.ok(tx.issues.every(issue => issue.status === 'OPEN' && issue.criticality === 'HIGH'));
  assert.equal(tx.issues[0].dueDate.toISOString().slice(0, 10), '2026-10-15');

  // mesma data e mesmos conflitos: nenhum aviso novo e nada é reaberto
  tx.issues[0].status = 'IN_PROGRESS';
  result = await syncResourceConflictIssues(tx, workflow(), detectResourceConflicts(planning, '2026-10-15'), '2026-10-15');
  assert.deepEqual(result.notify, []);
  assert.equal(tx.issues[0].status, 'IN_PROGRESS');

  // detalhes diferentes na nova data voltam a avisar
  result = await syncResourceConflictIssues(tx, workflow(), detectResourceConflicts(planning, '2026-11-20'), '2026-11-20');
  assert.deepEqual(result.notify.map(item => item.type), ['TEAM', 'EQUIPMENT']);

  // data compatível resolve sozinha
  result = await syncResourceConflictIssues(tx, workflow(), { TEAM: null, EQUIPMENT: null }, '2026-12-01');
  assert.deepEqual(result.resolved, ['TEAM', 'EQUIPMENT']);
  assert.ok(tx.issues.every(issue => issue.status === 'RESOLVED'));

  // e reabre com aviso quando o conflito volta
  result = await syncResourceConflictIssues(tx, workflow(), detectResourceConflicts(planning, '2026-12-10'), '2026-12-10');
  assert.deepEqual(result.notify.map(item => item.type), ['TEAM', 'EQUIPMENT']);
  assert.ok(tx.issues.every(issue => issue.status === 'OPEN'));
});

test('pendências de conflito contam como pendências ativas do projeto', () => {
  const issues = [
    { id: 'a', sourceQuestion: RESOURCE_CONFLICT_KEYS.TEAM, status: 'OPEN' },
    { id: 'b', sourceQuestion: 'SPECIAL_EQUIPMENT', status: 'OPEN' },
    { id: 'c', sourceQuestion: null, status: 'OPEN' }
  ];
  assert.deepEqual(activeProjectWorkflowIssues({ issues, criticalAnswers: [] }).map(issue => issue.id), ['a']);
  assert.equal(isResourceConflictIssue(issues[0]), true);
  assert.equal(isResourceConflictIssue(issues[1]), false);
});

function notificationClient() {
  const logs = [];
  return {
    logs,
    projectWorkflow: {
      findUnique: async () => ({
        projectId: 'project-1',
        stage: 'MOBILIZATION_PLANNING',
        plannedMobilizationDate: new Date('2026-10-15T00:00:00Z'),
        project: { code: 'P-001', name: 'Obra', clientName: 'Cliente' },
        leader: { id: 'u1', name: 'Líder', email: 'lider@example.com', isActive: true },
        planner: { id: 'u2', name: 'Gestor', email: 'gestor@example.com', isActive: true }
      })
    },
    projectWorkflowEmailNotification: {
      findMany: async () => logs.filter(item => item.status === 'SENT'),
      upsert: async ({ where, create, update }) => {
        const key = where.projectId_milestone_plannedMobilizationDate_recipientEmail;
        const existing = logs.find(item => item.milestone === key.milestone && item.recipientEmail === key.recipientEmail);
        if (existing) Object.assign(existing, update);
        else logs.push({ ...create });
      }
    }
  };
}

test('avisa Líder e Gestor de Contrato uma vez por data e tipo de conflito', async () => {
  const client = notificationClient();
  const messages = [];
  const detected = detectResourceConflicts(planning, '2026-10-15');
  const conflicts = [detected.TEAM, detected.EQUIPMENT];
  const options = { client, projectId: 'project-1', conflicts, mailer: async message => messages.push(message), logger: { error() {} } };

  const result = await notifyProjectWorkflowResourceConflicts(options);
  assert.equal(result.emailsSent, 2);
  assert.deepEqual(messages.map(message => message.to).sort(), ['gestor@example.com', 'lider@example.com']);
  assert.match(messages[0].subject, /Incompatibilidade de recursos · P-001/);
  assert.match(messages[0].html, /Operador: necessário 4, disponível 2/);
  assert.match(messages[0].text, /BOM-02 · Bomba 2/);
  assert.equal(client.logs.filter(item => item.status === 'SENT').length, 4);

  // repetir a mesma data e os mesmos conflitos não reenvia
  assert.equal((await notifyProjectWorkflowResourceConflicts(options)).emailsSent, 0);
  assert.equal(messages.length, 2);
});

test('falha no envio fica registrada e não interrompe', async () => {
  const client = notificationClient();
  const errors = [];
  const detected = detectResourceConflicts(planning, '2026-10-15');
  const result = await notifyProjectWorkflowResourceConflicts({
    client,
    projectId: 'project-1',
    conflicts: [detected.TEAM],
    mailer: async () => { throw new Error('SMTP indisponível'); },
    logger: { error: (...args) => errors.push(args) }
  });
  assert.equal(result.emailsSent, 0);
  assert.equal(errors.length, 2);
  assert.ok(client.logs.every(item => item.status === 'FAILED' && /SMTP indisponível/.test(item.error)));
});
