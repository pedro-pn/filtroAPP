import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROJECT_WORKFLOW_CHECKLISTS,
  PROJECT_WORKFLOW_COMMERCIAL_FACTS,
  PROJECT_WORKFLOW_CRITICAL_QUESTIONS,
  makeProjectWorkflowSchemas,
  projectWorkflowMilestones
} from '../../shared/schemas/project-workflow.js';
import { z } from 'zod';
import {
  analysisGateIssues,
  allowedProjectWorkflowTransition,
  commercialFactIssues,
  handoverGateIssues,
  projectWorkflowCommercialReadiness,
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
  assert.equal(patch.safeParse({ action: 'commercial_fact', version: 1, key: 'CONTRACT_SIGNED', status: 'NOT_APPLICABLE' }).success, false);
  assert.equal(patch.safeParse({ action: 'commercial_fact', version: 1, key: 'CONTRACT_SIGNED', status: 'NOT_APPLICABLE', note: 'Contrato dispensado' }).success, true);
  assert.equal(patch.safeParse({ action: 'commercial_fact', version: 1, key: 'COMMERCIAL_PROPOSAL_CREATED', status: 'NOT_APPLICABLE', note: 'Sem proposta' }).success, false);
  assert.equal(patch.safeParse({ action: 'commercial_fact', version: 1, key: 'PURCHASE_ORDER_RECEIVED', status: 'CONFIRMED', reference: 'PO-1' }).success, false);
  assert.equal(patch.safeParse({ action: 'commercial_fact', version: 1, key: 'PURCHASE_ORDER_RECEIVED', status: 'CONFIRMED', reference: 'PO-1', occurredOn: '2026-09-09' }).success, true);
  assert.equal(patch.safeParse({ action: 'commercial_fact', version: 1, key: 'PURCHASE_ORDER_RECEIVED', status: 'PENDING', source: 'CRM' }).success, false);
});

test('prontidão comercial exige os oito fatos completos conforme o catálogo', () => {
  const facts = PROJECT_WORKFLOW_COMMERCIAL_FACTS.map(item => ({
    ...item,
    status: 'CONFIRMED',
    occurredOn: new Date('2026-09-09T00:00:00Z'),
    reference: item.evidence === 'reference' ? 'REF-1' : null,
    note: item.evidence === 'note' ? 'Condição definida' : null
  }));
  assert.equal(projectWorkflowCommercialReadiness({ commercialFacts: facts }).status, 'RELEASED');
  facts[0] = { ...facts[0], reference: null };
  const readiness = projectWorkflowCommercialReadiness({ commercialFacts: facts });
  assert.equal(readiness.status, 'NOT_RELEASED');
  assert.equal(readiness.resolvedCount, 7);
  assert.deepEqual(readiness.blockedOperations, ['PURCHASE', 'HIRING', 'MOBILIZATION']);
  assert.deepEqual(commercialFactIssues(facts[0], facts[0]), ['Referência não informada']);
});

test('handover identifica somente itens ainda não concluídos', () => {
  const checklists = completed('HANDOVER');
  checklists.pop();
  const issues = handoverGateIssues({ leaderUserId: 'leader-1', checklists });
  assert.equal(issues.length, 1);
  assert.match(issues[0], /Condições e premissas/);
});

test('propostas comerciais válidas satisfazem os itens equivalentes do handover', () => {
  const proposalKeys = new Set(['HANDOVER_COMMERCIAL_PROPOSAL', 'HANDOVER_TECHNICAL_PROPOSAL']);
  const checklists = completed('HANDOVER').filter(item => !proposalKeys.has(item.key));
  const commercialFacts = PROJECT_WORKFLOW_COMMERCIAL_FACTS
    .filter(item => item.handoverChecklistKey)
    .map(item => ({ ...item, status: 'CONFIRMED', reference: 'PROP-1', occurredOn: new Date('2026-09-09T00:00:00Z') }));
  assert.deepEqual(handoverGateIssues({ leaderUserId: 'leader-1', checklists, commercialFacts }), []);
  commercialFacts[0].reference = null;
  assert.match(handoverGateIssues({ leaderUserId: 'leader-1', checklists, commercialFacts })[0], /Proposta comercial/);
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
