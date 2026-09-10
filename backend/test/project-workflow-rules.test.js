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
  demobilizationGateIssues,
  handoverGateIssues,
  planningGateIssues,
  projectWorkflowCommercialReadiness,
  projectWorkflowCloseoutReadiness,
  projectWorkflowClosureGate,
  projectWorkflowClosureReadiness,
  projectWorkflowDemobilizationReadiness,
  projectWorkflowDocumentationReadiness,
  projectWorkflowMobilizationAuthorization,
  projectWorkflowMobilizationGate,
  projectWorkflowPlanningReadiness,
  projectWorkflowPostJobReadiness,
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
  assert.equal(patch.safeParse({ action: 'demobilization', version: 7 }).success, false);
  assert.equal(patch.safeParse({ action: 'demobilization', version: 7, fieldCompletionDate: '2026-09-20', returnDate: '2026-09-19' }).success, false);
  assert.equal(patch.safeParse({ action: 'demobilization', version: 7, fieldCompletionDate: '2026-09-20', returnDate: '2026-09-21' }).success, true);
  assert.equal(patch.safeParse({ action: 'post_job', version: 8 }).success, false);
  assert.equal(patch.safeParse({ action: 'post_job', version: 8, meetingDate: '2026-09-25', lessonsLearned: 'Separar os kits por sistema.' }).success, true);
  assert.equal(patch.safeParse({ action: 'post_job', version: 8, lessonsLearned: 'x'.repeat(4001) }).success, false);
  assert.equal(patch.safeParse({ action: 'measurement', version: 9 }).success, false);
  assert.equal(patch.safeParse({ action: 'measurement', version: 9, executedAmount: 800, measuredAmount: 900 }).success, false);
  assert.equal(patch.safeParse({ action: 'measurement', version: 9, executedAmount: 900, measuredAmount: 850, approvedAmount: 820 }).success, true);
  assert.equal(patch.safeParse({ action: 'measurement', version: 9, preparedAt: '2026-09-08', sentAt: '2026-09-07' }).success, false);
  assert.equal(patch.safeParse({ action: 'stage', version: 10, stage: 'FINAL_MEASUREMENT', reason: '  ' }).success, false);
  assert.equal(patch.safeParse({ action: 'stage', version: 10, stage: 'FINAL_MEASUREMENT', reason: 'Correção solicitada pelo cliente.' }).success, true);
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

test('autorização vigente continua válida durante mobilização e execução', () => {
  const workflow = readyMobilizationWorkflow({
    stage: 'EXECUTION',
    version: 12,
    mobilizationAuthorizedAt: new Date('2026-09-09T18:00:00Z'),
    mobilizationAuthorizationVersion: 12
  });
  const gate = projectWorkflowMobilizationGate(workflow);
  assert.equal(projectWorkflowMobilizationAuthorization(workflow, gate).status, 'AUTHORIZED');
  workflow.stage = 'MOBILIZATION';
  assert.equal(projectWorkflowMobilizationAuthorization(workflow, gate).status, 'AUTHORIZED');
  assert.equal(allowedProjectWorkflowTransition('READY_TO_MOBILIZE', 'MOBILIZATION'), true);
  assert.equal(allowedProjectWorkflowTransition('MOBILIZATION', 'EXECUTION'), true);
  assert.equal(allowedProjectWorkflowTransition('READY_TO_MOBILIZE', 'EXECUTION'), false);
  assert.equal(allowedProjectWorkflowTransition('EXECUTION', 'MOBILIZATION'), true);
});

test('transições incluem Preparação e Pronto para mobilizar', () => {
  assert.equal(allowedProjectWorkflowTransition('MOBILIZATION_PLANNING', 'PREPARATION'), true);
  assert.equal(allowedProjectWorkflowTransition('PREPARATION', 'READY_TO_MOBILIZE'), true);
  assert.equal(allowedProjectWorkflowTransition('READY_TO_MOBILIZE', 'PREPARATION'), true);
  assert.equal(allowedProjectWorkflowTransition('PREPARATION', 'INITIAL_ANALYSIS'), false);
  const workflow = readyMobilizationWorkflow();
  assert.deepEqual(projectWorkflowTransitionIssues(workflow, 'READY_TO_MOBILIZE'), []);
});

test('entrada em mobilização ou execução exige autorização vigente', () => {
  const workflow = readyMobilizationWorkflow({
    stage: 'READY_TO_MOBILIZE',
    version: 11,
    mobilizationAuthorizedAt: new Date('2026-09-09T18:00:00Z'),
    mobilizationAuthorizationVersion: 11
  });
  assert.deepEqual(projectWorkflowTransitionIssues(workflow, 'MOBILIZATION'), []);
  assert.match(projectWorkflowTransitionIssues(workflow, 'EXECUTION')[0], /transição de etapa não permitida/i);
  workflow.stage = 'MOBILIZATION';
  assert.deepEqual(projectWorkflowTransitionIssues(workflow, 'EXECUTION'), []);
  workflow.mobilizationAuthorizationVersion = 10;
  assert.match(projectWorkflowTransitionIssues(workflow, 'EXECUTION')[0], /autorização de mobilização vigente/i);
});

test('desmobilização possui 15 controles e permite retorno revalidado à execução', () => {
  const checklists = PROJECT_WORKFLOW_CHECKLISTS
    .filter(item => item.stage === 'DEMOBILIZATION')
    .slice(0, 6)
    .map(item => ({ key: item.key, status: 'DONE' }));
  const readiness = projectWorkflowDemobilizationReadiness({ checklists });
  assert.equal(readiness.total, 15);
  assert.equal(readiness.completed, 6);
  assert.equal(readiness.percentage, 40);
  assert.deepEqual(readiness.sections.map(item => item.key), ['DEMOBILIZATION_FIELD', 'DEMOBILIZATION_LOGISTICS', 'DEMOBILIZATION_ASSETS']);
  assert.equal(allowedProjectWorkflowTransition('EXECUTION', 'DEMOBILIZATION'), true);
  assert.equal(allowedProjectWorkflowTransition('DEMOBILIZATION', 'EXECUTION'), true);

  const workflow = readyMobilizationWorkflow({
    stage: 'DEMOBILIZATION',
    version: 13,
    mobilizationAuthorizedAt: new Date('2026-09-09T18:00:00Z'),
    mobilizationAuthorizationVersion: 13
  });
  assert.deepEqual(projectWorkflowTransitionIssues(workflow, 'EXECUTION'), []);
  workflow.mobilizationAuthorizationVersion = 12;
  assert.match(projectWorkflowTransitionIssues(workflow, 'EXECUTION')[0], /autorização de mobilização vigente/i);
});

test('Pós-job exige desmobilização concluída e consolida nove controles', () => {
  const workflow = {
    stage: 'DEMOBILIZATION',
    checklists: completed('DEMOBILIZATION'),
    fieldCompletionDate: new Date('2026-09-20T00:00:00Z'),
    demobilizationDate: new Date('2026-09-22T00:00:00Z')
  };
  assert.deepEqual(demobilizationGateIssues(workflow), []);
  assert.deepEqual(projectWorkflowTransitionIssues(workflow, 'POST_JOB'), []);
  workflow.checklists.pop();
  assert.match(projectWorkflowTransitionIssues(workflow, 'POST_JOB')[0], /Avarias/);
  workflow.checklists = completed('DEMOBILIZATION');
  workflow.demobilizationDate = null;
  assert.match(projectWorkflowTransitionIssues(workflow, 'POST_JOB').at(-1), /data efetiva/i);

  const postJobChecklists = completed('POST_JOB').slice(0, 5);
  const readiness = projectWorkflowPostJobReadiness({ checklists: postJobChecklists });
  assert.equal(readiness.total, 9);
  assert.equal(readiness.completed, 5);
  assert.equal(readiness.percentage, 56);
  assert.deepEqual(readiness.sections.map(item => item.key), ['POST_JOB_FEEDBACK', 'POST_JOB_LEARNING']);
  assert.equal(allowedProjectWorkflowTransition('DEMOBILIZATION', 'POST_JOB'), true);
  assert.equal(allowedProjectWorkflowTransition('POST_JOB', 'DEMOBILIZATION'), true);
});

test('Documentação e medição exige pós-job concluído e consolida 14 controles', () => {
  const workflow = {
    stage: 'POST_JOB',
    checklists: completed('POST_JOB'),
    postJob: { meetingDate: new Date('2026-09-25T00:00:00Z') }
  };
  assert.deepEqual(projectWorkflowTransitionIssues(workflow, 'FINAL_MEASUREMENT'), []);
  workflow.postJob.meetingDate = null;
  assert.match(projectWorkflowTransitionIssues(workflow, 'FINAL_MEASUREMENT').at(-1), /data da reunião/i);
  workflow.postJob.meetingDate = new Date('2026-09-25T00:00:00Z');
  workflow.checklists.pop();
  assert.match(projectWorkflowTransitionIssues(workflow, 'FINAL_MEASUREMENT')[0], /Lições aprendidas/i);

  const readiness = projectWorkflowCloseoutReadiness({ checklists: completed('FINAL_MEASUREMENT').slice(0, 8) });
  assert.equal(readiness.total, 14);
  assert.equal(readiness.completed, 8);
  assert.equal(readiness.percentage, 57);
  assert.deepEqual(readiness.sections.map(item => item.key), ['CLOSEOUT_DOCUMENTATION', 'CLOSEOUT_MEASUREMENT']);
  assert.equal(allowedProjectWorkflowTransition('POST_JOB', 'FINAL_MEASUREMENT'), true);
  assert.equal(allowedProjectWorkflowTransition('FINAL_MEASUREMENT', 'POST_JOB'), true);
});

test('Encerramento consolida os dez controles finais e dependências estruturadas', () => {
  const workflow = {
    stage: 'FINAL_MEASUREMENT',
    checklists: completed('FINAL_MEASUREMENT'),
    postJob: { meetingDate: new Date('2026-09-25T00:00:00Z') },
    measurement: { approvedAt: new Date('2026-09-30T00:00:00Z'), approvedAmount: 0 },
    issues: []
  };
  const readiness = projectWorkflowClosureReadiness(workflow);
  assert.equal(readiness.total, 10);
  assert.equal(readiness.completed, 10);
  const gate = projectWorkflowClosureGate(workflow);
  assert.equal(gate.total, 24);
  assert.equal(gate.ready, true);
  assert.deepEqual(projectWorkflowTransitionIssues(workflow, 'FINISHED'), []);
  workflow.issues.push({ id: 'issue-1', description: 'Aceite final', status: 'IN_PROGRESS' });
  assert.match(projectWorkflowTransitionIssues(workflow, 'FINISHED').at(-1), /pendência interna/i);
  workflow.issues = [];
  workflow.measurement.approvedAt = null;
  assert.match(projectWorkflowTransitionIssues(workflow, 'FINISHED').join(' '), /data de aprovação/i);
  assert.equal(allowedProjectWorkflowTransition('FINAL_MEASUREMENT', 'FINISHED'), true);
  assert.equal(allowedProjectWorkflowTransition('FINISHED', 'FINAL_MEASUREMENT'), true);
});
