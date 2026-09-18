import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROJECT_WORKFLOW_CHECKLISTS,
  PROJECT_WORKFLOW_CLIENT_RELEASES,
  PROJECT_WORKFLOW_COMMERCIAL_FACTS,
  PROJECT_WORKFLOW_CRITICAL_QUESTIONS,
  PROJECT_WORKFLOW_PREPARATION_ITEM_CHECKS,
  PROJECT_WORKFLOW_TEAM_MEMBER_CHECKS,
  makeProjectWorkflowCommercialFactSchema,
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
  projectWorkflowStageTimeline,
  projectWorkflowTransitionIssues
} from '../src/lib/efetivo/project-workflow/rules.js';

function completed(stage) {
  return PROJECT_WORKFLOW_CHECKLISTS.filter(item => item.stage === stage).map(item => ({ key: item.key, status: 'DONE' }));
}

test('contrato exige justificativa para não aplicável, valida documentação e exige versão', () => {
  const { patch } = makeProjectWorkflowSchemas(z);
  const commercialFact = makeProjectWorkflowCommercialFactSchema(z);
  assert.equal(patch.safeParse({ action: 'checklist', version: 1, key: 'ANALYSIS_RESPONSIBILITIES', status: 'NOT_APPLICABLE' }).success, false);
  assert.equal(patch.safeParse({ action: 'checklist', version: 1, key: 'ANALYSIS_RESPONSIBILITIES', status: 'NOT_APPLICABLE', note: 'Responsabilidades já definidas no contrato.' }).success, true);
  assert.equal(patch.safeParse({ action: 'analysis_contact', version: 1, made: true }).success, false);
  assert.equal(patch.safeParse({ action: 'analysis_contact', version: 1, made: true, contactName: 'Marina', contactDate: '2026-09-10' }).success, true);
  assert.equal(patch.safeParse({ action: 'analysis_contact', version: 1, made: false }).success, true);
  assert.equal(patch.safeParse({ action: 'team_member_check', version: 1, collaboratorId: 'collaborator-1', key: 'EXAMS_RELEASED', status: 'DONE' }).success, true);
  assert.equal(patch.safeParse({ action: 'team_member_check', version: 1, collaboratorId: 'collaborator-1', key: 'EXAMS_RELEASED', status: 'NOT_APPLICABLE' }).success, false);
  assert.equal(patch.safeParse({ action: 'preparation_item_check', version: 1, itemType: 'EQUIPMENT', itemId: 'equipment-1', key: 'TESTED', status: 'DONE' }).success, true);
  assert.equal(patch.safeParse({ action: 'preparation_item_check', version: 1, itemType: 'MATERIAL', itemId: 'material-1', key: 'TESTED', status: 'DONE' }).success, false);
  assert.equal(patch.safeParse({ action: 'preparation_item_check', version: 1, itemType: 'MATERIAL', itemId: 'material-1', key: 'SEPARATED', status: 'DONE' }).success, true);
  assert.equal(patch.safeParse({ action: 'client_attendance', version: 1, attendanceDate: '2026-09-20' }).success, true);
  assert.equal(patch.safeParse({ action: 'client_release', version: 1, key: 'CUSTOMER_REGISTRATION', requested: true, requestedAt: '2026-09-10', requestedTo: 'Portaria', completed: false, completedAt: null }).success, true);
  assert.equal(patch.safeParse({ action: 'client_release', version: 1, key: 'CUSTOMER_REGISTRATION', requested: false, requestedAt: null, requestedTo: null, completed: true, completedAt: '2026-09-10' }).success, false);
  assert.equal(patch.safeParse({ action: 'pre_job', version: 1 }).success, false);
  assert.equal(patch.safeParse({ action: 'pre_job', version: 1, scheduledDate: '2026-09-10' }).success, true);
  assert.equal(patch.safeParse({ action: 'pre_job', version: 1, scheduledDate: '2026-09-10', completedDate: '2026-09-09' }).success, false);
  assert.equal(patch.safeParse({ action: 'qsms', version: 1 }).success, false);
  assert.equal(patch.safeParse({ action: 'qsms', version: 1, verified: true }).success, true);
  assert.equal(patch.safeParse({ action: 'qsms', version: 1, verificationNote: 'APR e requisitos do cliente.' }).success, true);
  assert.equal(patch.safeParse({ action: 'qsms', version: 1, verificationNote: 'x'.repeat(2001) }).success, false);
  assert.equal(patch.safeParse({ action: 'travel', version: 1, freightDepartureTime: '25:00' }).success, false);
  assert.equal(patch.safeParse({ action: 'travel', version: 1, freightDefined: true }).success, true);
  assert.equal(patch.safeParse({ action: 'team_plan', version: 1, defined: true, demands: [] }).success, false);
  assert.equal(patch.safeParse({ action: 'team_plan', version: 1, defined: true, demands: [{ jobRoleId: 'role-1', requiredCount: 3 }] }).success, true);
  assert.equal(patch.safeParse({ action: 'team_plan', version: 1, defined: false, demands: [] }).success, true);
  assert.equal(patch.safeParse({ action: 'equipment_plan', version: 1, defined: true, selections: [] }).success, false);
  assert.equal(patch.safeParse({ action: 'equipment_plan', version: 1, defined: true, selections: [{ categoryId: 'category-1', equipmentIds: ['equipment-1'] }] }).success, true);
  assert.equal(patch.safeParse({ action: 'equipment_plan', version: 1, defined: false, selections: [] }).success, true);
  assert.equal(patch.safeParse({ action: 'issue', version: 1, issueId: 'issue-1', description: 'Equipamento especial', ownerName: 'Leandro', requiredLeadTimeDays: 30, dueDate: '2026-10-10', criticality: 'HIGH', status: 'OPEN' }).success, true);
  assert.equal(patch.safeParse({ action: 'documentation_category', version: 1, type: 'EXAM', required: true }).success, true);
  assert.equal(patch.safeParse({ action: 'documentation_requirement_create', version: 1, type: 'EXAM', name: 'Audiometria' }).success, true);
  assert.equal(patch.safeParse({ action: 'documentation_requirement_update', version: 1, requirementId: 'req-1', status: 'CONFIRMED', requestedAt: '2026-09-10', confirmedAt: '2026-09-09' }).success, false);
  assert.equal(patch.safeParse({ action: 'accept' }).success, false);
  assert.equal(patch.safeParse({ action: 'commercial_fact', version: 1, key: 'CONTRACT_SIGNED', status: 'PENDING' }).success, false);
  assert.equal(commercialFact.safeParse({ action: 'commercial_fact', version: 1, key: 'CONTRACT_SIGNED', status: 'NOT_APPLICABLE' }).success, false);
  assert.equal(commercialFact.safeParse({ action: 'commercial_fact', version: 1, key: 'CONTRACT_SIGNED', status: 'NOT_APPLICABLE', note: 'Contrato dispensado' }).success, true);
  assert.equal(commercialFact.safeParse({ action: 'commercial_fact', version: 1, key: 'COMMERCIAL_PROPOSAL_CREATED', status: 'NOT_APPLICABLE', note: 'Sem proposta' }).success, false);
  assert.equal(commercialFact.safeParse({ action: 'commercial_fact', version: 1, key: 'PURCHASE_ORDER_RECEIVED', status: 'CONFIRMED', reference: 'PO-1' }).success, false);
  assert.equal(commercialFact.safeParse({ action: 'commercial_fact', version: 1, key: 'PURCHASE_ORDER_RECEIVED', status: 'CONFIRMED', reference: 'PO-1', occurredOn: '2026-09-09' }).success, true);
  assert.equal(commercialFact.safeParse({ action: 'commercial_fact', version: 1, key: 'PURCHASE_ORDER_RECEIVED', status: 'PENDING', source: 'CRM' }).success, false);
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
  assert.deepEqual(readiness.blockedOperations, []);
  assert.equal(readiness.pendingSignals.length, 1);
  assert.deepEqual(commercialFactIssues(facts[0], facts[0]), ['Referência não informada']);
});

test('handover usa os dados comerciais como informação e exige somente líder e documento explicitamente obrigatório', () => {
  assert.deepEqual(handoverGateIssues({ leaderUserId: 'leader-1', checklists: [] }), []);
  assert.deepEqual(handoverGateIssues({ leaderUserId: null, checklists: [] }), ['Definir o Líder de Projetos']);
});

test('sinais comerciais incompletos não criam bloqueio no handover', () => {
  assert.deepEqual(handoverGateIssues({ leaderUserId: 'leader-1', checklists: [], commercialFacts: [] }), []);
});

test('documento de proposta aparece no handover sem confirmar os sinais comerciais', () => {
  const workflow = {
    leaderUserId: 'leader-1',
    checklists: [],
    commercialFacts: []
  };
  assert.deepEqual(handoverGateIssues(workflow), []);
  assert.equal(projectWorkflowCommercialReadiness(workflow).status, 'NOT_RELEASED');
  const commercialFact = makeProjectWorkflowCommercialFactSchema(z);
  assert.equal(commercialFact.safeParse({ action: 'commercial_fact', version: 1, key: 'COMMERCIAL_PROPOSAL_CREATED', status: 'CONFIRMED', evidenceDocumentId: 'doc_1', occurredOn: '2026-09-10' }).success, true);
});

test('análise exige todas as respostas e encaminhamento para cada resposta positiva', () => {
  const workflow = {
    checklists: completed('INITIAL_ANALYSIS'),
    analysisClientContactMade: false,
    isCritical: false,
    preparationLeadTimeDays: 15,
    criticalAnswers: PROJECT_WORKFLOW_CRITICAL_QUESTIONS.map(question => ({ key: question.key, answer: question.key === 'SPECIAL_EQUIPMENT' })),
    issues: [{ sourceQuestion: 'SPECIAL_EQUIPMENT', area: 'Ativos', ownerName: null, requiredLeadTimeDays: null, dueDate: null }]
  };
  assert.deepEqual(analysisGateIssues(workflow), [
    'Realizar e confirmar o contato inicial com o cliente',
    'Encaminhar a pendência: Providenciar equipamento especial'
  ]);
  workflow.issues[0] = { ...workflow.issues[0], ownerName: 'Leandro', requiredLeadTimeDays: 45, dueDate: new Date('2026-09-20T00:00:00Z') };
  assert.deepEqual(analysisGateIssues(workflow), ['Realizar e confirmar o contato inicial com o cliente']);
  workflow.analysisClientContactMade = true;
  assert.deepEqual(analysisGateIssues(workflow), ['Informar o nome do contato inicial com o cliente', 'Informar a data do contato inicial com o cliente']);
  workflow.analysisClientContactName = 'Marina';
  workflow.analysisClientContactDate = '2026-09-10';
  assert.deepEqual(analysisGateIssues(workflow), []);
  workflow.isCritical = null;
  assert.deepEqual(analysisGateIssues(workflow), ['Informar se a obra é crítica']);
  workflow.isCritical = true;
  workflow.preparationLeadTimeDays = 45;
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
  const critical = projectWorkflowMilestones('2026-10-29', '2026-09-09', 45);
  assert.equal(critical.preparationLeadTimeDays, 45);
  assert.equal(critical.preparationDate, '2026-09-14');
  assert.equal(critical.nextMilestone.key, 'D45');
  assert.deepEqual(projectWorkflowMilestones(null, '2026-09-09').items, []);
});

test('documentação usa cinco decisões por tipo e acompanha itens nomeados com datas', () => {
  const milestones = projectWorkflowMilestones('2026-09-20', '2026-09-09');
  let readiness = projectWorkflowDocumentationReadiness({ documentationCategories: [] }, milestones, '2026-09-09');
  assert.equal(readiness.status, 'CRITICAL');
  assert.equal(readiness.total, 5);
  const documentationCategories = [
    { type: 'DOCUMENT', required: false, requirements: [] },
    { type: 'EXAM', required: true, requirements: [{ id: 'exam-1', name: 'Audiometria', status: 'REQUESTED', requestedAt: '2026-09-08', confirmedAt: null }] },
    { type: 'TRAINING', required: false, requirements: [] },
    { type: 'QUALITY', required: false, requirements: [] },
    { type: 'CERTIFICATION', required: false, requirements: [] }
  ];
  readiness = projectWorkflowDocumentationReadiness({ documentationCategories }, milestones, '2026-09-09');
  assert.equal(readiness.completed, 4);
  assert.match(readiness.blockers[0].label, /Audiometria/);
  documentationCategories[1].requirements[0] = { ...documentationCategories[1].requirements[0], status: 'CONFIRMED', confirmedAt: '2026-09-09' };
  readiness = projectWorkflowDocumentationReadiness({ documentationCategories }, milestones, '2026-09-09');
  assert.equal(readiness.status, 'OK');
});

test('progresso D-30 é calculado no total e por frente', () => {
  const result = projectWorkflowPlanningReadiness({
    teamPlanDefined: true,
    teamDemands: [{ jobRoleId: 'role-1', requiredCount: 2 }],
    equipmentPlanDefined: true,
    equipmentCategoryPlans: [{ categoryId: 'category-1' }],
    supplyPlanDefined: true,
    supplyPlan: [{ id: 'stock-1', requiredQuantity: 2 }],
    logisticsPlan: {
      vehicleRequired: false,
      freightRequired: true,
      lodgingRequired: true,
      lodgingPeopleCount: 4,
      lodgingExpectedDate: '2026-09-20',
      lodgingRequested: false
    }
  });
  assert.equal(result.total, 4);
  assert.equal(result.completed, 4);
  assert.equal(result.percentage, 100);
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
    .filter(item => item.section.startsWith('D15_'))
    .map(item => ({ key: item.key, status: 'DONE' }));
  const documentationCategories = ['DOCUMENT', 'EXAM', 'TRAINING', 'QUALITY', 'CERTIFICATION'].map(type => ({ type, required: false, requirements: [] }));
  const teamPreparation = {
    defined: true,
    members: [{
      collaboratorId: 'collaborator-1',
      name: 'João da Silva',
      checks: PROJECT_WORKFLOW_TEAM_MEMBER_CHECKS.map(item => ({ ...item, status: 'DONE' }))
    }]
  };
  const clientReleases = {
    attendance: { date: '2026-09-20', confirmed: true },
    items: PROJECT_WORKFLOW_CLIENT_RELEASES.map(item => ({
      ...item,
      requested: true,
      requestedAt: '2026-09-09',
      requestedTo: 'Marina',
      completed: true,
      completedAt: '2026-09-10'
    }))
  };
  const preparationResources = {
    equipment: {
      defined: true,
      items: [{
        id: 'equipment-1',
        code: 'B-01',
        name: 'Bomba 1',
        checks: PROJECT_WORKFLOW_PREPARATION_ITEM_CHECKS.EQUIPMENT.map(item => ({ ...item, status: 'DONE' }))
      }]
    },
    materials: {
      defined: true,
      items: [{
        id: 'material-1',
        name: 'Filtro 10 µm',
        checks: PROJECT_WORKFLOW_PREPARATION_ITEM_CHECKS.MATERIAL.map(item => ({ ...item, status: 'DONE' }))
      }]
    }
  };
  return {
    stage: 'PREPARATION',
    version: 10,
    checklists: readinessChecklists,
    commercialFacts,
    documentationCategories,
    teamPreparation,
    clientReleases,
    preparationResources,
    logisticsPlan: { lodgingRequired: true },
    preJobScheduledDate: '2026-09-09',
    preJobCompletedDate: '2026-09-10',
    qsmsVerified: true,
    qsmsVerificationNote: 'APR e requisitos específicos do cliente verificados.',
    travelPlan: {
      lodgingRequestedDate: '2026-09-09',
      lodgingConfirmedDate: '2026-09-10',
      teamTransportDefined: true,
      teamTransportDescription: 'Van própria com saída da sede.',
      freightDefined: true,
      freightType: 'THIRD_PARTY',
      freightDepartureDate: '2026-09-19',
      freightDepartureTime: '07:30'
    },
    issues: [],
    ...overrides
  };
}

test('planejamento completo libera Preparação e D-15 acompanha equipe nominal e cliente', () => {
  const structuredPlanning = {
    teamPlanDefined: true,
    teamDemands: [{ jobRoleId: 'role-1', requiredCount: 2 }],
    equipmentPlanDefined: true,
    equipmentCategoryPlans: [{ categoryId: 'category-1' }],
    supplyPlanDefined: true,
    supplyPlan: [{ id: 'stock-1', requiredQuantity: 2 }],
    logisticsPlan: { vehicleRequired: false, freightRequired: false, lodgingRequired: false }
  };
  assert.equal(planningGateIssues({ checklists: [] }).length, 6);
  assert.deepEqual(planningGateIssues(structuredPlanning), []);
  const prepared = readyMobilizationWorkflow();
  const readiness = projectWorkflowPreparationReadiness(prepared);
  assert.ok(readiness.total > 0);
  assert.equal(readiness.completed, readiness.total);
  assert.equal(readiness.sections.length, 7);
  prepared.teamPreparation.members[0].checks[0].status = 'PENDING';
  assert.equal(projectWorkflowPreparationReadiness(prepared).completed, readiness.total - 1);
  assert.equal(projectWorkflowTransitionIssues({ stage: 'MOBILIZATION_PLANNING', checklists: [] }, 'PREPARATION').length, 6);
  assert.deepEqual(projectWorkflowTransitionIssues({ stage: 'MOBILIZATION_PLANNING', ...structuredPlanning }, 'PREPARATION'), []);
});

test('QSMS começa sem resposta e exige o registro da verificação', () => {
  const workflow = readyMobilizationWorkflow({ qsmsVerified: null, qsmsVerificationNote: null });
  let qsms = projectWorkflowPreparationReadiness(workflow).sections.find(item => item.key === 'D15_QSMS');
  assert.equal(qsms.completed, 0);
  assert.ok(projectWorkflowMobilizationGate(workflow).blockers.some(item => item.key === 'QSMS_VERIFIED'));
  workflow.qsmsVerified = false;
  assert.equal(projectWorkflowMobilizationGate(workflow).fronts.find(item => item.key === 'QSMS').status, 'BLOCKED');
  workflow.qsmsVerified = true;
  assert.ok(projectWorkflowMobilizationGate(workflow).blockers.some(item => item.key === 'QSMS_VERIFICATION_NOTE'));
  workflow.qsmsVerificationNote = 'APR, documentação e requisitos do cliente.';
  qsms = projectWorkflowPreparationReadiness(workflow).sections.find(item => item.key === 'D15_QSMS');
  assert.equal(qsms.completed, 1);
  assert.equal(projectWorkflowMobilizationGate(workflow).fronts.find(item => item.key === 'QSMS').status, 'READY');
});

test('gate consolida nove frentes, pré-job e pendências críticas', () => {
  const workflow = readyMobilizationWorkflow();
  let gate = projectWorkflowMobilizationGate(workflow, projectWorkflowMilestones('2026-09-20', '2026-09-09'), '2026-09-09');
  assert.equal(gate.fronts.length, 9);
  assert.equal(gate.preJob.status, 'READY');
  assert.equal(gate.ready, true);
  assert.equal(gate.deadlineStatus, 'READY');
  workflow.commercialFacts = [];
  gate = projectWorkflowMobilizationGate(workflow, projectWorkflowMilestones('2026-09-20', '2026-09-09'), '2026-09-09');
  assert.equal(gate.ready, true);
  assert.equal(gate.fronts.find(item => item.key === 'COMMERCIAL').status, 'READY');
  workflow.preparationResources.equipment.items[0].checks.find(item => item.key === 'TESTED').status = 'PENDING';
  gate = projectWorkflowMobilizationGate(workflow, projectWorkflowMilestones('2026-09-10', '2026-09-09'), '2026-09-09');
  assert.equal(gate.ready, false);
  assert.equal(gate.deadlineStatus, 'RISK');
  assert.match(gate.blockers.find(item => item.key === 'EQUIPMENT_equipment-1_TESTED').label, /Bomba 1/);
  workflow.preparationResources.equipment.items[0].checks.find(item => item.key === 'TESTED').status = 'DONE';
  workflow.criticalAnswers = [{ key: 'SPECIAL_EQUIPMENT', answer: true }];
  workflow.issues = [{ id: 'critical-1', sourceQuestion: 'SPECIAL_EQUIPMENT', status: 'OPEN', criticality: 'HIGH', area: 'Operações', description: 'Risco sem ação' }];
  gate = projectWorkflowMobilizationGate(workflow);
  assert.equal(gate.ready, false);
  assert.equal(gate.blockers.some(item => item.front === 'CRITICAL_ISSUES'), true);
  workflow.criticalAnswers[0].answer = false;
  assert.equal(projectWorkflowMobilizationGate(workflow).ready, true);
  workflow.preJobCompletedDate = null;
  gate = projectWorkflowMobilizationGate(workflow);
  assert.equal(gate.ready, false);
  assert.equal(gate.blockers.some(item => item.key === 'PRE_JOB_COMPLETED'), true);
  workflow.preJobCompletedDate = '2026-09-10';
  workflow.qsmsVerificationNote = null;
  gate = projectWorkflowMobilizationGate(workflow);
  assert.equal(gate.ready, false);
  assert.equal(gate.blockers.some(item => item.key === 'QSMS_VERIFICATION_NOTE'), true);
  workflow.qsmsVerificationNote = 'APR e requisitos específicos do cliente verificados.';
  workflow.travelPlan.teamTransportDefined = false;
  gate = projectWorkflowMobilizationGate(workflow);
  assert.equal(gate.ready, false);
  assert.equal(gate.blockers.some(item => item.key === 'TRAVEL_TEAM_TRANSPORT'), true);
});

test('hospedagem e frete dispensados no D-30 não criam campos obrigatórios no D-15', () => {
  const workflow = readyMobilizationWorkflow({
    logisticsPlan: { lodgingRequired: false, freightRequired: false },
    travelPlan: {
      teamTransportDefined: true,
      teamTransportDescription: 'Carro da empresa.'
    }
  });
  const gate = projectWorkflowMobilizationGate(workflow);
  assert.equal(gate.fronts.find(item => item.key === 'LODGING').status, 'READY');
  assert.equal(gate.fronts.find(item => item.key === 'LOGISTICS').status, 'READY');
  assert.equal(gate.ready, true);
});

test('somente requisitos documentais explícitos participam dos gates', () => {
  const workflow = readyMobilizationWorkflow({
    documentRequirements: {
      MOBILIZATION: { ready: false, blockers: [{ documentId: 'doc_1', title: 'Contrato', reason: 'Contrato aguarda aceite do cliente.' }] }
    }
  });
  const blocked = projectWorkflowMobilizationGate(workflow);
  assert.equal(blocked.ready, false);
  assert.equal(blocked.blockers.some(item => item.key === 'DOCUMENT_doc_1' && item.front === 'DOCUMENTATION'), true);
  assert.equal(projectWorkflowMobilizationGate(readyMobilizationWorkflow()).ready, true);
  assert.equal(projectWorkflowMobilizationGate(readyMobilizationWorkflow({
    criticalAnswers: [{ key: 'CLIENT_REQUIREMENTS', answer: true }],
    issues: [{ id: 'legacy-documentation-issue', sourceQuestion: 'CLIENT_REQUIREMENTS', status: 'OPEN', criticality: 'HIGH', description: 'Pendência documental antiga' }]
  })).ready, true);

  const handover = { leaderUserId: 'leader-1', checklists: completed('HANDOVER'), documentRequirements: { HANDOVER: { ready: false, blockers: [{ documentId: 'doc_2', title: 'Especificação', reason: 'Especificação não possui uma versão vigente.' }] } } };
  assert.match(handoverGateIssues(handover)[0], /Especificação não possui/);
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
    criticalAnswers: [],
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
  workflow.criticalAnswers.push({ key: 'SPECIAL_EQUIPMENT', answer: true });
  workflow.issues.push({ id: 'issue-1', sourceQuestion: 'SPECIAL_EQUIPMENT', description: 'Aceite final', status: 'IN_PROGRESS' });
  assert.match(projectWorkflowTransitionIssues(workflow, 'FINISHED').at(-1), /pendência interna/i);
  workflow.issues = [];
  workflow.criticalAnswers = [];
  workflow.measurement.approvedAt = null;
  assert.match(projectWorkflowTransitionIssues(workflow, 'FINISHED').join(' '), /data de aprovação/i);
  assert.equal(allowedProjectWorkflowTransition('FINAL_MEASUREMENT', 'FINISHED'), true);
  assert.equal(allowedProjectWorkflowTransition('FINISHED', 'FINAL_MEASUREMENT'), true);
});

test('linha do tempo das etapas usa as datas reais registradas no histórico', () => {
  const at = day => new Date(`2026-09-${day}T12:00:00.000Z`);
  const timeline = projectWorkflowStageTimeline([
    { action: 'WORKFLOW_STAGE', data: { stage: 'PREPARATION' }, createdAt: at('11') },
    { action: 'WORKFLOW_STARTED', data: {}, createdAt: at('01') },
    { action: 'WORKFLOW_CHECKLIST', data: { key: 'X' }, createdAt: at('02') },
    { action: 'WORKFLOW_ACCEPT', data: {}, createdAt: at('03') },
    { action: 'WORKFLOW_STAGE', data: { stage: 'MOBILIZATION_PLANNING' }, createdAt: at('05') }
  ]);
  assert.deepEqual(timeline, {
    HANDOVER: { enteredAt: at('01').toISOString(), completedAt: at('03').toISOString() },
    INITIAL_ANALYSIS: { enteredAt: at('03').toISOString(), completedAt: at('05').toISOString() },
    MOBILIZATION_PLANNING: { enteredAt: at('05').toISOString(), completedAt: at('11').toISOString() },
    PREPARATION: { enteredAt: at('11').toISOString(), completedAt: null }
  });
  assert.equal(timeline.WAITING_PLANNING, undefined, 'etapa pulada não recebe data');
});

test('etapa reaberta por retorno do fluxo vale pela última entrada', () => {
  const at = day => new Date(`2026-09-${day}T12:00:00.000Z`);
  const timeline = projectWorkflowStageTimeline([
    { action: 'WORKFLOW_STAGE', data: { stage: 'MOBILIZATION_PLANNING' }, createdAt: at('05') },
    { action: 'WORKFLOW_STAGE', data: { stage: 'PREPARATION' }, createdAt: at('11') },
    { action: 'WORKFLOW_STAGE', data: { stage: 'MOBILIZATION_PLANNING' }, createdAt: at('13') },
    { action: 'WORKFLOW_STAGE', data: { stage: 'UNKNOWN' }, createdAt: at('14') }
  ]);
  assert.deepEqual(timeline.MOBILIZATION_PLANNING, { enteredAt: at('13').toISOString(), completedAt: null });
  assert.deepEqual(timeline.PREPARATION, { enteredAt: at('11').toISOString(), completedAt: at('13').toISOString() });
});
