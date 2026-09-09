import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROJECT_WORKFLOW_CHECKLISTS,
  PROJECT_WORKFLOW_CRITICAL_QUESTIONS,
  makeProjectWorkflowSchemas,
  projectWorkflowMilestones
} from '../../shared/schemas/project-workflow.js';
import { z } from 'zod';
import {
  analysisGateIssues,
  allowedProjectWorkflowTransition,
  handoverGateIssues,
  projectWorkflowTransitionIssues
} from '../src/lib/efetivo/project-workflow/rules.js';

function completed(stage) {
  return PROJECT_WORKFLOW_CHECKLISTS.filter(item => item.stage === stage).map(item => ({ key: item.key, status: 'DONE' }));
}

test('contrato exige justificativa para não aplicável e versão nas alterações', () => {
  const { patch } = makeProjectWorkflowSchemas(z);
  assert.equal(patch.safeParse({ action: 'checklist', version: 1, key: 'HANDOVER_PROJECT_CREATED', status: 'NOT_APPLICABLE' }).success, false);
  assert.equal(patch.safeParse({ action: 'checklist', version: 1, key: 'HANDOVER_PROJECT_CREATED', status: 'NOT_APPLICABLE', note: 'Documento incorporado à proposta.' }).success, true);
  assert.equal(patch.safeParse({ action: 'accept' }).success, false);
});

test('handover identifica somente itens ainda não concluídos', () => {
  const checklists = completed('HANDOVER');
  checklists.pop();
  const issues = handoverGateIssues({ leaderUserId: 'leader-1', checklists });
  assert.equal(issues.length, 1);
  assert.match(issues[0], /Condições e premissas/);
});

test('análise exige todas as respostas e encaminhamento para cada resposta positiva', () => {
  const workflow = {
    checklists: completed('INITIAL_ANALYSIS'),
    criticalAnswers: PROJECT_WORKFLOW_CRITICAL_QUESTIONS.map(question => ({ key: question.key, answer: question.key === 'SPECIAL_EQUIPMENT' })),
    issues: [{ sourceQuestion: 'SPECIAL_EQUIPMENT', area: 'Ativos', ownerName: null, requiredLeadTimeDays: null, dueDate: null }]
  };
  assert.deepEqual(analysisGateIssues(workflow), ['Encaminhar a pendência: Providenciar equipamento especial']);
  workflow.issues[0] = { ...workflow.issues[0], ownerName: 'Leandro', requiredLeadTimeDays: 45, dueDate: new Date('2026-09-20T00:00:00Z') };
  assert.deepEqual(analysisGateIssues(workflow), []);
});

test('transições não confundem marcos de prazo com colunas', () => {
  assert.equal(allowedProjectWorkflowTransition('INITIAL_ANALYSIS', 'WAITING_PLANNING'), true);
  assert.equal(allowedProjectWorkflowTransition('INITIAL_ANALYSIS', 'MOBILIZATION_PLANNING'), true);
  assert.equal(allowedProjectWorkflowTransition('HANDOVER', 'WAITING_PLANNING'), false);
  const workflow = { stage: 'INITIAL_ANALYSIS', acceptedAt: new Date(), checklists: [], criticalAnswers: [], issues: [] };
  assert.ok(projectWorkflowTransitionIssues(workflow, 'WAITING_PLANNING').length > 0);
});

test('marco D-30 usa datas civis e projetos curtos ficam imediatamente vencidos', () => {
  assert.deepEqual(projectWorkflowMilestones('2026-10-09', '2026-09-09'), {
    daysUntilMobilization: 30,
    d30Date: '2026-09-09',
    d30Due: true
  });
  assert.equal(projectWorkflowMilestones('2026-09-29', '2026-09-09').d30Due, true);
  assert.equal(projectWorkflowMilestones('2027-02-15', '2026-09-08').d30Due, false);
});
