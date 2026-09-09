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
  planningGateIssues,
  projectWorkflowCommercialReadiness,
  projectWorkflowDocumentationReadiness,
  projectWorkflowMobilizationAuthorization,
  projectWorkflowMobilizationGate,
  projectWorkflowPlanningReadiness,
  projectWorkflowPreparationReadiness,
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
  assert.equal(patch.safeParse({ action: 'authorize_mobilization', version: 7 }).success, true);
  assert.equal(patch.safeParse({ action: 'authorize_mobilization' }).success, false);
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
  const d30 = projectWorkflowMilestones('2026-10-09', '2026-09-09');
  assert.equal(d30.daysUntilMobilization, 30);
  assert.equal(d30.d30Date, '2026-09-09');
  assert.equal(d30.d30Due, true);
  assert.deepEqual(d30.dueMilestones, ['D90', 'D30']);
  assert.equal(d30.nextMilestone.key, 'D15');
  const short = projectWorkflowMilestones('2026-09-29', '2026-09-09');
  assert.deepEqual(short.dueMilestones, ['D90', 'D30']);
  assert.equal(short.nextMilestone.date, '2026-09-14');
  const distant = projectWorkflowMilestones('2027-02-15', '2026-09-08');
  assert.deepEqual(distant.dueMilestones, []);
  assert.equal(distant.nextMilestone.key, 'D90');
  assert.deepEqual(projectWorkflowMilestones(null, '2026-09-09').items, []);
});

test('documentação fica crítica perto da mobilização e OK quando resolvida', () => {
  const definitions = PROJECT_WORKFLOW_CHECKLISTS.filter(item => item.section === 'ADVANCE_DOCUMENTATION');
  const milestones = projectWorkflowMilestones('2026-09-20', '2026-09-09');
  let readiness = projectWorkflowDocumentationReadiness({ checklists: [], issues: [] }, milestones, '2026-09-09');
  assert.equal(readiness.status, 'CRITICAL');
  assert.equal(readiness.total, 11);
  const checklists = definitions.map(item => ({ key: item.key, status: 'DONE' }));
  readiness = projectWorkflowDocumentationReadiness({ checklists, issues: [] }, milestones, '2026-09-09');
  assert.equal(readiness.status, 'OK');
  readiness = projectWorkflowDocumentationReadiness({
    checklists,
    issues: [{ id: 'issue-1', status: 'OPEN', criticality: 'HIGH', area: 'Administrativo/RH', dueDate: '2026-09-08', description: 'ASO vencido' }]
  }, projectWorkflowMilestones('2027-02-15', '2026-09-09'), '2026-09-09');
  assert.equal(readiness.status, 'CRITICAL');
});

test('progresso D-30 é calculado no total e por frente', () => {
  const planning = PROJECT_WORKFLOW_CHECKLISTS.filter(item => item.section.startsWith('D30_'));
  const result = projectWorkflowPlanningReadiness({
    checklists: planning.slice(0, 5).map(item => ({ key: item.key, status: 'DONE' }))
  });
  assert.equal(result.total, 25);
  assert.equal(result.completed, 5);
  assert.equal(result.percentage, 20);
  assert.deepEqual(result.sections.map(item => item.key), ['D30_TEAM', 'D30_EQUIPMENT', 'D30_MATERIALS', 'D30_LOGISTICS']);
});

function readyMobilizationWorkflow(overrides = {}) {
  const commercialFacts = PROJECT_WORKFLOW_COMMERCIAL_FACTS.map(item => ({
    ...item,
    status: 'CONFIRMED',
    occurredOn: new Date('2026-09-09T00:00:00Z'),
    reference: item.evidence === 'reference' ? 'REF-1' : null,
    note: item.evidence === 'note' ? 'Condição definida' : null
  }));
  const readinessChecklists = PROJECT_WORKFLOW_CHECKLISTS
    .filter(item => item.section === 'ADVANCE_DOCUMENTATION' || item.section.startsWith('D15_'))
    .map(item => ({ key: item.key, status: 'DONE' }));
  return { stage: 'PREPARATION', version: 10, checklists: readinessChecklists, commercialFacts, issues: [], ...overrides };
}

test('planejamento completo libera Preparação e D-15 soma 39 confirmações', () => {
  assert.equal(planningGateIssues({ checklists: [] }).length, 25);
  assert.deepEqual(planningGateIssues({ checklists: completed('MOBILIZATION_PLANNING') }), []);
  const readiness = projectWorkflowPreparationReadiness({ checklists: completed('PREPARATION').slice(0, 20) });
  assert.equal(readiness.total, 39);
  assert.equal(readiness.completed, 20);
  assert.equal(readiness.sections.length, 7);
  assert.equal(projectWorkflowTransitionIssues({ stage: 'MOBILIZATION_PLANNING', checklists: [] }, 'PREPARATION').length, 25);
  assert.deepEqual(projectWorkflowTransitionIssues({ stage: 'MOBILIZATION_PLANNING', checklists: completed('MOBILIZATION_PLANNING') }, 'PREPARATION'), []);
});

test('gate consolida nove frentes, pré-job e pendências críticas', () => {
  const workflow = readyMobilizationWorkflow();
  let gate = projectWorkflowMobilizationGate(workflow, projectWorkflowMilestones('2026-09-20', '2026-09-09'), '2026-09-09');
  assert.equal(gate.fronts.length, 9);
  assert.equal(gate.preJob.status, 'READY');
  assert.equal(gate.ready, true);
  assert.equal(gate.deadlineStatus, 'READY');
  workflow.checklists = workflow.checklists.filter(item => item.key !== 'D15_EQUIPMENT_TESTED');
  gate = projectWorkflowMobilizationGate(workflow, projectWorkflowMilestones('2026-09-10', '2026-09-09'), '2026-09-09');
  assert.equal(gate.ready, false);
  assert.equal(gate.deadlineStatus, 'RISK');
  assert.match(gate.blockers.find(item => item.key === 'D15_EQUIPMENT_TESTED').label, /testados/);
  workflow.checklists.push({ key: 'D15_EQUIPMENT_TESTED', status: 'DONE' });
  workflow.issues = [{ id: 'critical-1', status: 'OPEN', criticality: 'HIGH', area: 'Operações', description: 'Risco sem ação' }];
  gate = projectWorkflowMobilizationGate(workflow);
  assert.equal(gate.ready, false);
  assert.equal(gate.blockers.some(item => item.front === 'CRITICAL_ISSUES'), true);
});

test('autorização exige gate verde, etapa pronta e a mesma versão', () => {
  const workflow = readyMobilizationWorkflow({
    stage: 'READY_TO_MOBILIZE',
    version: 11,
    mobilizationAuthorizedAt: new Date('2026-09-09T18:00:00Z'),
    mobilizationAuthorizationVersion: 11
  });
  const gate = projectWorkflowMobilizationGate(workflow);
  assert.equal(projectWorkflowMobilizationAuthorization(workflow, gate).status, 'AUTHORIZED');
  workflow.version = 12;
  assert.equal(projectWorkflowMobilizationAuthorization(workflow, gate).status, 'SUSPENDED');
  workflow.mobilizationAuthorizedAt = null;
  assert.equal(projectWorkflowMobilizationAuthorization(workflow, gate).status, 'NOT_AUTHORIZED');
});

test('transições incluem Preparação e Pronto para mobilizar', () => {
  assert.equal(allowedProjectWorkflowTransition('MOBILIZATION_PLANNING', 'PREPARATION'), true);
  assert.equal(allowedProjectWorkflowTransition('PREPARATION', 'READY_TO_MOBILIZE'), true);
  assert.equal(allowedProjectWorkflowTransition('READY_TO_MOBILIZE', 'PREPARATION'), true);
  assert.equal(allowedProjectWorkflowTransition('PREPARATION', 'INITIAL_ANALYSIS'), false);
  const workflow = readyMobilizationWorkflow();
  assert.deepEqual(projectWorkflowTransitionIssues(workflow, 'READY_TO_MOBILIZE'), []);
});
