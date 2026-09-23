import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROJECT_WORKFLOW_CHECKLISTS,
  PROJECT_WORKFLOW_CLIENT_CONTACT_CHECKLIST,
  PROJECT_WORKFLOW_CLIENT_RELEASES,
  PROJECT_WORKFLOW_COMMERCIAL_FACTS,
  PROJECT_WORKFLOW_CRITICAL_QUESTIONS,
  PROJECT_WORKFLOW_PREPARATION_ITEM_CHECKS,
  PROJECT_WORKFLOW_TEAM_MEMBER_CHECKS,
  makeProjectWorkflowCommercialFactSchema,
  makeProjectWorkflowSchemas,
  projectWorkflowMilestones,
  projectWorkflowReferenceDate,
  projectWorkflowVisibleStages
} from '../../shared/schemas/project-workflow.js';
import { z } from 'zod';
import {
  analysisGateIssues,
  allowedProjectWorkflowTransition,
  commercialFactIssues,
  commercialScheduleConfirmationStatus,
  demobilizationGateIssues,
  handoverGateIssues,
  planningGateIssues,
  projectWorkflowAnalysisReadiness,
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

// Checklist de verificação do contato com o cliente todo respondido (fixture padrão para não poluir os testes
// que não são sobre esse checklist especificamente).
function fullClientContactChecklist() {
  return Object.fromEntries(PROJECT_WORKFLOW_CLIENT_CONTACT_CHECKLIST.map(item => [item.key, { answer: false, note: null, updatedAt: '2026-09-01' }]));
}

test('contrato exige justificativa para não aplicável, valida documentação e exige versão', () => {
  const { patch } = makeProjectWorkflowSchemas(z);
  const commercialFact = makeProjectWorkflowCommercialFactSchema(z);
  assert.equal(patch.safeParse({ action: 'checklist', version: 1, key: 'ANALYSIS_RESPONSIBILITIES', status: 'NOT_APPLICABLE' }).success, false);
  assert.equal(patch.safeParse({ action: 'checklist', version: 1, key: 'ANALYSIS_RESPONSIBILITIES', status: 'NOT_APPLICABLE', note: 'Responsabilidades já definidas no contrato.' }).success, true);
  assert.equal(patch.safeParse({ action: 'analysis_contact', version: 1, made: true }).success, false);
  assert.equal(patch.safeParse({ action: 'analysis_contact', version: 1, made: true, contactName: 'Marina', contactPhone: '(11) 99999-9999', contactDate: '2026-09-10' }).success, true);
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
  assert.equal(patch.safeParse({ action: 'authorize_mobilization', version: 7 }).success, false);
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

test('handover exige líder, Sede/campo e documento explicitamente obrigatório', () => {
  assert.deepEqual(handoverGateIssues({ leaderUserId: 'leader-1', executedAtHeadquarters: false, checklists: [] }), []);
  assert.deepEqual(handoverGateIssues({ leaderUserId: null, executedAtHeadquarters: false, checklists: [] }), ['Definir o Líder de Projetos']);
  assert.deepEqual(handoverGateIssues({ leaderUserId: 'leader-1', executedAtHeadquarters: null, checklists: [] }), ['Informar se o projeto será executado na Sede ou em campo']);
  assert.deepEqual(handoverGateIssues({ leaderUserId: 'leader-1', executedAtHeadquarters: true, checklists: [] }), []);
});

test('sinais comerciais incompletos não criam bloqueio no handover', () => {
  assert.deepEqual(handoverGateIssues({ leaderUserId: 'leader-1', executedAtHeadquarters: false, checklists: [], commercialFacts: [] }), []);
});

test('documento de proposta aparece no handover sem confirmar os sinais comerciais', () => {
  const workflow = {
    leaderUserId: 'leader-1',
    executedAtHeadquarters: false,
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
    executedAtHeadquarters: false,
    preparationLeadTimeDays: 15,
    criticalAnswers: PROJECT_WORKFLOW_CRITICAL_QUESTIONS.map(question => ({ key: question.key, answer: question.key === 'SPECIAL_EQUIPMENT' })),
    clientContactChecklist: fullClientContactChecklist(),
    issues: [{ sourceQuestion: 'SPECIAL_EQUIPMENT', area: 'Ativos', ownerName: null, requiredLeadTimeDays: null, dueDate: null }]
  };
  assert.deepEqual(analysisGateIssues(workflow), [
    'Realizar e confirmar o contato inicial com o cliente',
    'Encaminhar a pendência: Providenciar equipamento especial'
  ]);
  workflow.issues[0] = { ...workflow.issues[0], ownerName: 'Leandro', requiredLeadTimeDays: 45, dueDate: new Date('2026-09-20T00:00:00Z') };
  assert.deepEqual(analysisGateIssues(workflow), ['Realizar e confirmar o contato inicial com o cliente']);
  workflow.analysisClientContactMade = true;
  assert.deepEqual(analysisGateIssues(workflow), ['Informar o nome do contato inicial com o cliente', 'Informar o telefone do contato inicial com o cliente', 'Informar a data do contato inicial com o cliente']);
  workflow.analysisClientContactName = 'Marina';
  workflow.analysisClientContactPhone = '(11) 99999-9999';
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
  const workflow = { stage: 'INITIAL_ANALYSIS', acceptedAt: new Date(), executedAtHeadquarters: false, checklists: [], criticalAnswers: [], issues: [] };
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
      teamTransportMode: 'OWN',
      teamTransportVehicleType: 'PICKUP',
      teamTransportQuantity: 1,
      freightDefined: true,
      freightMode: 'THIRD_PARTY',
      freightVehicleType: 'TRUCK',
      freightQuantity: 1,
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
  assert.equal(readiness.sections.length, 9);
  prepared.teamPreparation.members[0].checks[0].status = 'PENDING';
  assert.equal(projectWorkflowPreparationReadiness(prepared).completed, readiness.total - 1);
  assert.equal(projectWorkflowTransitionIssues({ stage: 'MOBILIZATION_PLANNING', checklists: [] }, 'PREPARATION').length, 6);
  assert.deepEqual(projectWorkflowTransitionIssues({ stage: 'MOBILIZATION_PLANNING', ...structuredPlanning }, 'PREPARATION'), []);
});

test('QSMS começa sem resposta e não exige o registro da verificação para liberar', () => {
  const workflow = readyMobilizationWorkflow({ qsmsVerified: null, qsmsVerificationNote: null });
  let qsms = projectWorkflowPreparationReadiness(workflow).sections.find(item => item.key === 'D15_QSMS');
  assert.equal(qsms.completed, 0);
  assert.ok(projectWorkflowMobilizationGate(workflow).blockers.some(item => item.key === 'QSMS_VERIFIED'));
  workflow.qsmsVerified = false;
  assert.equal(projectWorkflowMobilizationGate(workflow).fronts.find(item => item.key === 'QSMS').status, 'BLOCKED');
  // marcar como verificado já libera, mesmo sem o registro do que foi verificado
  workflow.qsmsVerified = true;
  qsms = projectWorkflowPreparationReadiness(workflow).sections.find(item => item.key === 'D15_QSMS');
  assert.equal(qsms.completed, 1);
  assert.equal(projectWorkflowMobilizationGate(workflow).fronts.find(item => item.key === 'QSMS').status, 'READY');
  assert.ok(!projectWorkflowMobilizationGate(workflow).blockers.some(item => item.key === 'QSMS_VERIFICATION_NOTE'));
  workflow.qsmsVerificationNote = 'APR, documentação e requisitos do cliente.';
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
  // marcado como verificado, mesmo sem o registro do que foi verificado, não bloqueia mais
  workflow.qsmsVerificationNote = null;
  gate = projectWorkflowMobilizationGate(workflow);
  assert.equal(gate.ready, true);
  workflow.qsmsVerified = false;
  gate = projectWorkflowMobilizationGate(workflow);
  assert.equal(gate.ready, false);
  assert.equal(gate.blockers.some(item => item.key === 'QSMS_VERIFIED'), true);
  workflow.qsmsVerified = true;
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
      teamTransportMode: 'OWN',
      teamTransportVehicleType: 'PASSENGER',
      teamTransportQuantity: 1
    }
  });
  const gate = projectWorkflowMobilizationGate(workflow);
  assert.equal(gate.fronts.find(item => item.key === 'LODGING').status, 'READY');
  assert.equal(gate.fronts.find(item => item.key === 'LOGISTICS').status, 'READY');
  assert.equal(gate.ready, true);
});

test('seletor de veículo: "Locação de carro" dispensa o tipo, mas "Nosso"/"Frete" exigem tipo e quantidade', () => {
  const base = () => readyMobilizationWorkflow({
    logisticsPlan: { lodgingRequired: false, freightRequired: true },
    travelPlan: {
      teamTransportDefined: true,
      teamTransportMode: 'OWN',
      teamTransportVehicleType: null,
      teamTransportQuantity: null,
      freightDefined: true,
      freightMode: 'THIRD_PARTY',
      freightVehicleType: 'TRUCK',
      freightQuantity: 2,
      freightDepartureDate: '2026-09-19',
      freightDepartureTime: '07:30'
    }
  });
  // "Nosso" sem tipo nem quantidade bloqueia
  let gate = projectWorkflowMobilizationGate(base());
  assert.equal(gate.blockers.some(item => item.key === 'TRAVEL_TEAM_TRANSPORT'), true);
  // com tipo e quantidade, libera
  const withVehicle = base();
  withVehicle.travelPlan.teamTransportVehicleType = 'PICKUP';
  withVehicle.travelPlan.teamTransportQuantity = 1;
  gate = projectWorkflowMobilizationGate(withVehicle);
  assert.equal(gate.blockers.some(item => item.key === 'TRAVEL_TEAM_TRANSPORT'), false);
  // "Locação de carro" não precisa de tipo, só quantidade
  const rental = base();
  rental.travelPlan.teamTransportMode = 'RENTAL';
  rental.travelPlan.teamTransportVehicleType = null;
  rental.travelPlan.teamTransportQuantity = 1;
  gate = projectWorkflowMobilizationGate(rental);
  assert.equal(gate.blockers.some(item => item.key === 'TRAVEL_TEAM_TRANSPORT'), false);
  // frete sem tipo bloqueia mesmo com data/horário preenchidos
  const freightMissingType = base();
  freightMissingType.travelPlan.teamTransportVehicleType = 'PICKUP';
  freightMissingType.travelPlan.teamTransportQuantity = 1;
  freightMissingType.travelPlan.freightVehicleType = null;
  gate = projectWorkflowMobilizationGate(freightMissingType);
  assert.equal(gate.blockers.some(item => item.key === 'TRAVEL_FREIGHT'), true);
});

test('ônibus e avião servem à equipe, e escolhas individuais incompletas bloqueiam a logística', () => {
  const { patch } = makeProjectWorkflowSchemas(z);
  assert.equal(patch.safeParse({ action: 'travel', version: 1, teamTransportMode: 'BUS' }).success, true);
  assert.equal(patch.safeParse({ action: 'travel', version: 1, teamTransportMode: 'PLANE' }).success, true);
  assert.equal(patch.safeParse({ action: 'travel', version: 1, freightMode: 'BUS' }).success, false);
  assert.equal(patch.safeParse({ action: 'travel', version: 1, teamTransportMember: { collaboratorId: 'collaborator-1', mode: 'PLANE', vehicleType: null } }).success, true);
  const workflow = readyMobilizationWorkflow({ logisticsPlan: { lodgingRequired: false, freightRequired: false } });
  workflow.travelPlan.teamTransportMode = 'BUS';
  workflow.travelPlan.teamTransportVehicleType = null;
  assert.equal(projectWorkflowMobilizationGate(workflow).blockers.some(item => item.key === 'TRAVEL_TEAM_TRANSPORT'), false);
  workflow.travelPlan.teamTransportOverrides = { 'collaborator-1': { mode: 'OWN', vehicleType: null } };
  assert.equal(projectWorkflowMobilizationGate(workflow).blockers.some(item => item.key === 'TRAVEL_TEAM_TRANSPORT'), true);
  workflow.travelPlan.teamTransportOverrides['collaborator-1'].vehicleType = 'PICKUP';
  assert.equal(projectWorkflowMobilizationGate(workflow).blockers.some(item => item.key === 'TRAVEL_TEAM_TRANSPORT'), false);
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

  const handover = { leaderUserId: 'leader-1', executedAtHeadquarters: false, checklists: completed('HANDOVER'), documentRequirements: { HANDOVER: { ready: false, blockers: [{ documentId: 'doc_2', title: 'Especificação', reason: 'Especificação não possui uma versão vigente.' }] } } };
  assert.match(handoverGateIssues(handover)[0], /Especificação não possui/);
});

test('autorização reflete o gate continuamente, sem flag fixo nem suspensão', () => {
  const workflow = readyMobilizationWorkflow({ stage: 'MOBILIZATION', version: 11 });
  const gate = projectWorkflowMobilizationGate(workflow);
  assert.equal(projectWorkflowMobilizationAuthorization(workflow, gate).status, 'AUTHORIZED');
  // mudar a versão do workflow não "suspende" nada: a autorização é sempre recalculada do gate atual
  workflow.version = 12;
  assert.equal(projectWorkflowMobilizationAuthorization(workflow, gate).status, 'AUTHORIZED');
  const blockedGate = { ...gate, ready: false };
  assert.equal(projectWorkflowMobilizationAuthorization(workflow, blockedGate).status, 'NOT_AUTHORIZED');
});

test('autorização vigente continua válida durante mobilização e execução', () => {
  const workflow = readyMobilizationWorkflow({ stage: 'EXECUTION', version: 12 });
  const gate = projectWorkflowMobilizationGate(workflow);
  assert.equal(projectWorkflowMobilizationAuthorization(workflow, gate).status, 'AUTHORIZED');
  workflow.stage = 'MOBILIZATION';
  assert.equal(projectWorkflowMobilizationAuthorization(workflow, gate).status, 'AUTHORIZED');
  assert.equal(allowedProjectWorkflowTransition('PREPARATION', 'MOBILIZATION'), true);
  assert.equal(allowedProjectWorkflowTransition('MOBILIZATION', 'EXECUTION'), true);
  assert.equal(allowedProjectWorkflowTransition('PREPARATION', 'EXECUTION'), false);
  assert.equal(allowedProjectWorkflowTransition('EXECUTION', 'MOBILIZATION'), true);
});

test('transições incluem Preparação e Mobilização, sem etapa de autorização separada', () => {
  assert.equal(allowedProjectWorkflowTransition('MOBILIZATION_PLANNING', 'PREPARATION'), true);
  assert.equal(allowedProjectWorkflowTransition('PREPARATION', 'MOBILIZATION'), true);
  assert.equal(allowedProjectWorkflowTransition('MOBILIZATION', 'PREPARATION'), true);
  assert.equal(allowedProjectWorkflowTransition('PREPARATION', 'INITIAL_ANALYSIS'), false);
  const workflow = readyMobilizationWorkflow();
  assert.deepEqual(projectWorkflowTransitionIssues(workflow, 'MOBILIZATION'), []);
});

test('entrada em mobilização ou execução exige o gate de mobilização limpo', () => {
  const workflow = readyMobilizationWorkflow({ stage: 'PREPARATION', version: 11 });
  assert.deepEqual(projectWorkflowTransitionIssues(workflow, 'MOBILIZATION'), []);
  assert.match(projectWorkflowTransitionIssues(workflow, 'EXECUTION')[0], /transição de etapa não permitida/i);
  workflow.stage = 'MOBILIZATION';
  assert.deepEqual(projectWorkflowTransitionIssues(workflow, 'EXECUTION'), []);
  workflow.qsmsVerified = false;
  assert.ok(projectWorkflowTransitionIssues(workflow, 'EXECUTION').length > 0);
});

test('desmobilização possui 15 controles e permite retorno revalidado à execução', () => {
  const checklists = PROJECT_WORKFLOW_CHECKLISTS
    .filter(item => item.stage === 'DEMOBILIZATION')
    .slice(0, 6)
    .map(item => ({ key: item.key, status: 'DONE' }));
  const readiness = projectWorkflowDemobilizationReadiness({ checklists });
  assert.equal(readiness.total, 17);
  assert.equal(readiness.completed, 6);
  assert.equal(readiness.percentage, 35);
  assert.deepEqual(readiness.sections.map(item => item.key), ['DEMOBILIZATION_FIELD', 'DEMOBILIZATION_LOGISTICS', 'DEMOBILIZATION_ASSETS', 'DEMOBILIZATION_DATES']);
  const withDates = projectWorkflowDemobilizationReadiness({ checklists, fieldCompletionDate: '2026-09-20', demobilizationDate: '2026-09-22' });
  assert.equal(withDates.completed, 8);
  assert.equal(allowedProjectWorkflowTransition('EXECUTION', 'DEMOBILIZATION'), true);
  assert.equal(allowedProjectWorkflowTransition('DEMOBILIZATION', 'EXECUTION'), true);

  const workflow = readyMobilizationWorkflow({ stage: 'DEMOBILIZATION', version: 13 });
  assert.deepEqual(projectWorkflowTransitionIssues(workflow, 'EXECUTION'), []);
  workflow.qsmsVerified = false;
  assert.ok(projectWorkflowTransitionIssues(workflow, 'EXECUTION').length > 0);
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
  assert.equal(readiness.total, 10);
  assert.equal(readiness.completed, 5);
  assert.equal(readiness.percentage, 50);
  assert.deepEqual(readiness.sections.map(item => item.key), ['POST_JOB_FEEDBACK', 'POST_JOB_LEARNING', 'POST_JOB_MEETING']);
  assert.equal(projectWorkflowPostJobReadiness({ checklists: postJobChecklists, postJob: { meetingDate: '2026-09-25' } }).completed, 6);
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
  assert.equal(readiness.total, 16);
  assert.equal(readiness.completed, 8);
  assert.equal(readiness.percentage, 50);
  assert.deepEqual(readiness.sections.map(item => item.key), ['CLOSEOUT_DOCUMENTATION', 'CLOSEOUT_MEASUREMENT', 'CLOSEOUT_MEASUREMENT_APPROVAL']);
  const approved = projectWorkflowCloseoutReadiness({ checklists: completed('FINAL_MEASUREMENT').slice(0, 8), measurement: { approvedAt: '2026-09-30', approvedAmount: 0 } });
  assert.equal(approved.completed, 10);
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
  assert.equal(gate.total, 27);
  assert.equal(gate.completed, 27);
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

test('progresso da análise inicial só chega a 100% quando o gate não tem pendências', () => {
  const workflow = {
    stage: 'INITIAL_ANALYSIS',
    checklists: completed('INITIAL_ANALYSIS'),
    isCritical: false,
    executedAtHeadquarters: false,
    preparationLeadTimeDays: 15,
    analysisClientContactMade: false,
    analysisClientContactName: null,
    analysisClientContactPhone: null,
    analysisClientContactDate: null,
    criticalAnswers: PROJECT_WORKFLOW_CRITICAL_QUESTIONS.map(item => ({ key: item.key, answer: false })),
    clientContactChecklist: fullClientContactChecklist(),
    issues: []
  };
  const checklistCount = PROJECT_WORKFLOW_CHECKLISTS.filter(item => item.stage === 'INITIAL_ANALYSIS').length;
  const expectedTotal = checklistCount + 2 + PROJECT_WORKFLOW_CRITICAL_QUESTIONS.length + PROJECT_WORKFLOW_CLIENT_CONTACT_CHECKLIST.length;

  // tudo preenchido, exceto o contato com o cliente: pendência no gate e progresso abaixo de 100%
  let readiness = projectWorkflowAnalysisReadiness(workflow);
  assert.equal(readiness.total, expectedTotal);
  assert.equal(readiness.completed, expectedTotal - 1);
  assert.ok(readiness.percentage < 100);
  assert.deepEqual(analysisGateIssues(workflow), ['Realizar e confirmar o contato inicial com o cliente']);

  // contato marcado como realizado, mas incompleto, continua pendente
  workflow.analysisClientContactMade = true;
  workflow.analysisClientContactName = 'Maria';
  readiness = projectWorkflowAnalysisReadiness(workflow);
  assert.equal(readiness.completed, expectedTotal - 1);
  assert.equal(analysisGateIssues(workflow).length, 2);

  workflow.analysisClientContactPhone = '+5541999990000';
  workflow.analysisClientContactDate = '2026-09-21';
  readiness = projectWorkflowAnalysisReadiness(workflow);
  assert.equal(readiness.percentage, 100);
  assert.deepEqual(analysisGateIssues(workflow), []);

  // criticidade não informada, checklist e resposta crítica também contam
  workflow.isCritical = null;
  assert.equal(projectWorkflowAnalysisReadiness(workflow).completed, expectedTotal - 1);
  workflow.isCritical = false;
  workflow.checklists = workflow.checklists.slice(1);
  assert.equal(projectWorkflowAnalysisReadiness(workflow).completed, expectedTotal - 1);
  workflow.checklists = completed('INITIAL_ANALYSIS');
  workflow.criticalAnswers = workflow.criticalAnswers.slice(1);
  assert.equal(projectWorkflowAnalysisReadiness(workflow).completed, expectedTotal - 1);

  // resposta "sim" sem pendência encaminhada não conclui a pergunta
  const question = PROJECT_WORKFLOW_CRITICAL_QUESTIONS.find(item => item.createsIssue !== false);
  workflow.criticalAnswers = PROJECT_WORKFLOW_CRITICAL_QUESTIONS.map(item => ({ key: item.key, answer: item.key === question.key }));
  assert.equal(projectWorkflowAnalysisReadiness(workflow).completed, expectedTotal - 1);
  assert.match(analysisGateIssues(workflow)[0], /Encaminhar a pendência/);
});

test('a ação analysis_schedule exige fim depois do início', () => {
  const { patch } = makeProjectWorkflowSchemas(z);
  const base = { action: 'analysis_schedule', version: 1 };
  assert.equal(patch.safeParse({ ...base, plannedExecutionStartDate: '2027-02-20', plannedExecutionEndDate: '2027-04-30' }).success, true);
  assert.equal(patch.safeParse({ ...base, plannedExecutionStartDate: null, plannedExecutionEndDate: null }).success, true);
  const invalid = patch.safeParse({ ...base, plannedExecutionStartDate: '2027-04-30', plannedExecutionEndDate: '2027-02-20' });
  assert.equal(invalid.success, false);
  assert.match(invalid.error.issues[0].message, /não pode ser anterior/);
});

test('checklist do contato com o cliente: 17 perguntas obrigatórias, sem repetir os itens críticos já existentes', () => {
  const { patch } = makeProjectWorkflowSchemas(z);
  assert.equal(PROJECT_WORKFLOW_CLIENT_CONTACT_CHECKLIST.length, 17);
  const overlappingKeys = ['CLIENT_REQUIREMENTS', 'CLIENT_REGISTRATION', 'SPECIAL_EQUIPMENT', 'LONG_LEAD_MATERIAL', 'MORE_THAN_TEN_FILTERS', 'SPECIFIC_HIRING'];
  const checklistKeys = new Set(PROJECT_WORKFLOW_CLIENT_CONTACT_CHECKLIST.map(item => item.key));
  for (const key of overlappingKeys) assert.equal(checklistKeys.has(key), false);

  const base = { action: 'client_contact_check', version: 1, key: 'MULTI_DAY_INTEGRATION' };
  assert.equal(patch.safeParse({ ...base, answer: true }).success, true);
  assert.equal(patch.safeParse({ ...base, answer: true, note: 'Três dias, presencial.' }).success, true);
  assert.equal(patch.safeParse({ ...base, answer: null }).success, false);
  assert.equal(patch.safeParse({ ...base }).success, false);
  assert.equal(patch.safeParse({ action: 'client_contact_check', version: 1, key: 'NAO_EXISTE', answer: true }).success, false);

  const workflow = {
    checklists: completed('INITIAL_ANALYSIS'),
    analysisClientContactMade: true,
    analysisClientContactName: 'Marina',
    analysisClientContactPhone: '(11) 99999-9999',
    analysisClientContactDate: '2026-09-10',
    isCritical: false,
    executedAtHeadquarters: false,
    preparationLeadTimeDays: 15,
    criticalAnswers: PROJECT_WORKFLOW_CRITICAL_QUESTIONS.map(item => ({ key: item.key, answer: false })),
    clientContactChecklist: {},
    issues: []
  };
  // nenhuma pergunta respondida: bloqueia as 17
  assert.equal(analysisGateIssues(workflow).length, 17);
  assert.ok(analysisGateIssues(workflow).every(issue => issue.startsWith('Responder: ')));
  // responder só uma libera as outras 16
  workflow.clientContactChecklist = { MULTI_DAY_INTEGRATION: { answer: false, note: null } };
  assert.equal(analysisGateIssues(workflow).length, 16);
  // todas respondidas libera de vez (observação é sempre opcional)
  workflow.clientContactChecklist = fullClientContactChecklist();
  assert.deepEqual(analysisGateIssues(workflow), []);
});

test('datas comerciais estimadas: editáveis a qualquer momento (sem CRM) e início não pode ser antes da mobilização', () => {
  const { patch } = makeProjectWorkflowSchemas(z);
  const base = { action: 'commercial_dates', version: 1 };
  assert.equal(patch.safeParse({ ...base, expectedMobilizationDate: '2027-02-01', expectedStartDate: '2027-02-05' }).success, true);
  assert.equal(patch.safeParse({ ...base, expectedStartDate: null }).success, true);
  assert.equal(patch.safeParse(base).success, false);
  const invalid = patch.safeParse({ ...base, expectedMobilizationDate: '2027-02-10', expectedStartDate: '2027-02-01' });
  assert.equal(invalid.success, false);
  assert.match(invalid.error.issues[0].message, /não pode ser anterior/);
});

test('confirmação da data comercial no D-15: "Sim, continua igual" confirma o valor atual; editar a data desconfirma sozinho', () => {
  const withoutConfirmation = commercialScheduleConfirmationStatus({
    executedAtHeadquarters: false,
    commercialExpectedStartDate: new Date('2027-02-05T00:00:00Z'),
    commercialExpectedMobilizationDate: new Date('2027-02-01T00:00:00Z'),
    commercialScheduleConfirmation: {}
  });
  assert.equal(withoutConfirmation.start.relevant, true);
  assert.equal(withoutConfirmation.start.confirmed, false);
  assert.equal(withoutConfirmation.mobilization.relevant, true);
  assert.equal(withoutConfirmation.mobilization.confirmed, false);

  const confirmed = commercialScheduleConfirmationStatus({
    executedAtHeadquarters: false,
    commercialExpectedStartDate: new Date('2027-02-05T00:00:00Z'),
    commercialExpectedMobilizationDate: new Date('2027-02-01T00:00:00Z'),
    commercialScheduleConfirmation: { startConfirmedValue: '2027-02-05', mobilizationConfirmedValue: '2027-02-01' }
  });
  assert.equal(confirmed.start.confirmed, true);
  assert.equal(confirmed.mobilization.confirmed, true);

  // a data mudou depois de confirmada (ex.: editada de novo na Análise inicial): volta a exigir confirmação sozinho
  const drifted = commercialScheduleConfirmationStatus({
    executedAtHeadquarters: false,
    commercialExpectedStartDate: new Date('2027-02-10T00:00:00Z'),
    commercialExpectedMobilizationDate: new Date('2027-02-01T00:00:00Z'),
    commercialScheduleConfirmation: { startConfirmedValue: '2027-02-05', mobilizationConfirmedValue: '2027-02-01' }
  });
  assert.equal(drifted.start.confirmed, false);
  assert.equal(drifted.mobilization.confirmed, true);

  // sem data preenchida, o item não é relevante (não força confirmação de algo que nem existe)
  const empty = commercialScheduleConfirmationStatus({ executedAtHeadquarters: false, commercialScheduleConfirmation: {} });
  assert.equal(empty.start.relevant, false);
  assert.equal(empty.mobilization.relevant, false);

  // na Sede, mobilização não conta (só início)
  const sede = commercialScheduleConfirmationStatus({
    executedAtHeadquarters: true,
    commercialExpectedStartDate: new Date('2027-02-05T00:00:00Z'),
    commercialExpectedMobilizationDate: new Date('2027-02-01T00:00:00Z'),
    commercialScheduleConfirmation: {}
  });
  assert.equal(sede.start.relevant, true);
  assert.equal(sede.mobilization.relevant, false);
});

test('D-15 bloqueia até confirmar (ou corrigir) a data comercial estimada, quando ela existe', () => {
  const withItem = extra => projectWorkflowPreparationReadiness({
    executedAtHeadquarters: false,
    clientReleases: { attendance: { date: '2026-09-09', confirmed: true }, items: PROJECT_WORKFLOW_CLIENT_RELEASES.map(item => ({ ...item, requested: true, requestedAt: '2026-09-09', completed: true, completedAt: '2026-09-10' })) },
    ...extra
  });
  const clientSection = readiness => readiness.sections.find(item => item.key === 'D15_CLIENT');
  const unconfirmed = withItem({ commercialExpectedStartDate: '2026-09-20', commercialScheduleConfirmation: {} });
  assert.ok(clientSection(unconfirmed).blockers.some(item => item.key === 'COMMERCIAL_START_CONFIRMATION'));
  const confirmed = withItem({ commercialExpectedStartDate: '2026-09-20', commercialScheduleConfirmation: { startConfirmedValue: '2026-09-20' } });
  assert.ok(!clientSection(confirmed).blockers.some(item => item.key === 'COMMERCIAL_START_CONFIRMATION'));
  const noCommercialDate = withItem({});
  assert.ok(!clientSection(noCommercialDate).blockers.some(item => item.key === 'COMMERCIAL_START_CONFIRMATION'));
});

test('liberação do cliente só exige a data da solicitação, sem destinatário', () => {
  const base = { key: 'DOCUMENTS_SENT', requested: true, requestedAt: '2026-09-10', requestedTo: null, completed: false, completedAt: null };
  const request = readiness => readiness.sections.find(item => item.key === 'D15_CLIENT');
  const withItem = item => projectWorkflowPreparationReadiness({
    clientReleases: { attendance: { date: '2026-09-09', confirmed: true }, items: [item] }
  });
  // solicitação com data conta como concluída mesmo sem destinatário
  const requested = request(withItem(base));
  const pending = request(withItem({ ...base, requestedAt: null }));
  assert.equal(requested.completed - pending.completed, 1);
  const done = request(withItem({ ...base, completed: true, completedAt: '2026-09-12' }));
  assert.equal(done.completed - requested.completed, 1);
});

// --- Projeto executado na Sede -------------------------------------------------------------------

test('na Sede, a análise dispensa a pergunta de exigências do cliente (Sede/campo já foi exigido no handover)', () => {
  const analysis = {
    checklists: completed('INITIAL_ANALYSIS'),
    analysisClientContactMade: true,
    analysisClientContactName: 'Marina',
    analysisClientContactPhone: '(11) 99999-9999',
    analysisClientContactDate: '2026-09-10',
    isCritical: false,
    preparationLeadTimeDays: 15,
    criticalAnswers: PROJECT_WORKFLOW_CRITICAL_QUESTIONS.filter(item => item.key !== 'CLIENT_REQUIREMENTS').map(item => ({ key: item.key, answer: false })),
    clientContactChecklist: fullClientContactChecklist(),
    issues: []
  };
  // sem resposta (projeto legado anterior à feature, já dentro da análise) a análise não trava por isso:
  // a exigência agora é do gate do Handover.
  assert.deepEqual(analysisGateIssues({ ...analysis, executedAtHeadquarters: null }), [
    'Responder: Existem treinamentos, exames ou documentos específicos do cliente?'
  ]);
  assert.deepEqual(analysisGateIssues({ ...analysis, executedAtHeadquarters: true }), []);
  assert.deepEqual(analysisGateIssues({ ...analysis, executedAtHeadquarters: false }), [
    'Responder: Existem treinamentos, exames ou documentos específicos do cliente?'
  ]);
});

test('na Sede, a análise também dispensa a pergunta de cadastro no cliente', () => {
  const analysis = {
    checklists: completed('INITIAL_ANALYSIS'),
    analysisClientContactMade: true,
    analysisClientContactName: 'Marina',
    analysisClientContactPhone: '(11) 99999-9999',
    analysisClientContactDate: '2026-09-10',
    isCritical: false,
    preparationLeadTimeDays: 15,
    criticalAnswers: PROJECT_WORKFLOW_CRITICAL_QUESTIONS.filter(item => !['CLIENT_REQUIREMENTS', 'CLIENT_REGISTRATION'].includes(item.key)).map(item => ({ key: item.key, answer: false })),
    clientContactChecklist: fullClientContactChecklist(),
    issues: []
  };
  // sem resposta de CLIENT_REGISTRATION, em campo a análise trava; na Sede não, porque a pergunta some
  assert.deepEqual(analysisGateIssues({ ...analysis, executedAtHeadquarters: false }), [
    'Responder: Existem treinamentos, exames ou documentos específicos do cliente?',
    'Responder: É necessário cadastro da Filtrovali junto ao cliente?'
  ]);
  assert.deepEqual(analysisGateIssues({ ...analysis, executedAtHeadquarters: true }), []);
});

test('Sede pula Mobilização e Desmobilização (campo não tem mais "Pronto para mobilizar")', () => {
  const sede = { executedAtHeadquarters: true };
  assert.deepEqual(projectWorkflowVisibleStages(true), projectWorkflowVisibleStages(true).filter(stage => !['MOBILIZATION', 'DEMOBILIZATION'].includes(stage)));
  assert.equal(projectWorkflowVisibleStages(false).length, 11);
  assert.equal(allowedProjectWorkflowTransition('PREPARATION', 'EXECUTION', sede), true);
  assert.equal(allowedProjectWorkflowTransition('PREPARATION', 'MOBILIZATION', sede), false);
  assert.equal(allowedProjectWorkflowTransition('EXECUTION', 'POST_JOB', sede), true);
  assert.equal(allowedProjectWorkflowTransition('EXECUTION', 'DEMOBILIZATION', sede), false);
  assert.equal(allowedProjectWorkflowTransition('POST_JOB', 'EXECUTION', sede), true);
  // sem resposta ou em campo o fluxo continua o mesmo (Preparação → Mobilização, sem "Pronto para mobilizar")
  assert.equal(allowedProjectWorkflowTransition('PREPARATION', 'EXECUTION', { executedAtHeadquarters: null }), false);
  assert.equal(allowedProjectWorkflowTransition('PREPARATION', 'MOBILIZATION', { executedAtHeadquarters: false }), true);
  assert.equal(allowedProjectWorkflowTransition('PREPARATION', 'MOBILIZATION'), true);
});

test('Sede usa o início da execução como data-base dos marcos', () => {
  const dates = { plannedMobilizationDate: '2026-10-01', plannedExecutionStartDate: '2026-10-20' };
  assert.equal(projectWorkflowReferenceDate({ ...dates, executedAtHeadquarters: true }), '2026-10-20');
  assert.equal(projectWorkflowReferenceDate({ ...dates, executedAtHeadquarters: false }), '2026-10-01');
  assert.equal(projectWorkflowReferenceDate({ ...dates, executedAtHeadquarters: null }), '2026-10-01');
  assert.equal(projectWorkflowReferenceDate({ plannedMobilizationDate: '2026-10-01', executedAtHeadquarters: true }), null);
});

test('responder "não" para equipe, equipamentos e insumos no planejamento D-30 libera a Preparação (obra pode não precisar de nada disso)', () => {
  const allNo = { teamPlanDefined: false, equipmentPlanDefined: false, supplyPlanDefined: false, logisticsPlan: { vehicleRequired: false, freightRequired: false, lodgingRequired: false } };
  assert.deepEqual(planningGateIssues(allNo), []);
  assert.deepEqual(projectWorkflowTransitionIssues({ stage: 'MOBILIZATION_PLANNING', ...allNo }, 'PREPARATION'), []);
  const readiness = projectWorkflowPlanningReadiness(allNo);
  assert.equal(readiness.completed, readiness.total);
  assert.equal(readiness.percentage, 100);

  // sem responder nada ainda, o gate pede a resposta (não presume "sim" nem "não")
  assert.deepEqual(planningGateIssues({}).slice(0, 3), [
    'Informar se será necessária equipe própria',
    'Informar se serão necessários equipamentos',
    'Informar se serão necessários insumos'
  ]);

  // "sim" sem detalhar nada continua pendente — só "não" ou "sim" com itens resolve
  assert.deepEqual(planningGateIssues({
    teamPlanDefined: true,
    equipmentPlanDefined: true,
    supplyPlanDefined: true,
    logisticsPlan: { vehicleRequired: false, freightRequired: false, lodgingRequired: false }
  }), [
    'Definir os cargos e as quantidades da equipe',
    'Definir os equipamentos necessários',
    'Definir os insumos e as quantidades necessárias'
  ]);

  // a Preparação D-15 não cobra equipamentos/materiais reservados quando o D-30 disse que não eram necessários
  const workflow = readyMobilizationWorkflow({
    equipmentPlanDefined: false,
    supplyPlanDefined: false,
    preparationResources: { equipment: { defined: false, items: [] }, materials: { defined: false, items: [] } }
  });
  const gate = projectWorkflowMobilizationGate(workflow);
  assert.equal(gate.fronts.find(front => front.key === 'EQUIPMENT').total, 0);
  assert.equal(gate.fronts.find(front => front.key === 'MATERIALS').total, 0);
  assert.equal(gate.ready, true, JSON.stringify(gate.blockers));
});

test('planejamento D-30 da Sede exige só a equipe; equipamentos, insumos e logística ficam opcionais', () => {
  const teamOnly = { executedAtHeadquarters: true, teamPlanDefined: true, teamDemands: [{ jobRoleId: 'role-1', requiredCount: 2 }] };
  assert.deepEqual(planningGateIssues(teamOnly), []);
  assert.deepEqual(projectWorkflowTransitionIssues({ stage: 'MOBILIZATION_PLANNING', ...teamOnly }, 'PREPARATION'), []);
  assert.deepEqual(planningGateIssues({ executedAtHeadquarters: true }), ['Informar se será necessária equipe própria']);
  assert.deepEqual(planningGateIssues({ executedAtHeadquarters: true, teamPlanDefined: false }), []);
  assert.equal(planningGateIssues({ ...teamOnly, executedAtHeadquarters: false }).length, 5);
  const readiness = projectWorkflowPlanningReadiness(teamOnly);
  assert.equal(readiness.total, 1);
  assert.equal(readiness.completed, 1);
  assert.equal(readiness.percentage, 100);
  assert.deepEqual(readiness.sections.filter(section => section.optional).map(section => section.key), ['D30_EQUIPMENT', 'D30_MATERIALS', 'D30_LOGISTICS']);
  // logística preliminar da Sede não pergunta hospedagem
  const logistics = projectWorkflowPlanningReadiness({ ...teamOnly, logisticsPlan: { vehicleRequired: false, freightRequired: false } });
  assert.equal(logistics.sections.find(section => section.key === 'D30_LOGISTICS').completed, 1);
  assert.equal(projectWorkflowPlanningReadiness({ ...teamOnly, executedAtHeadquarters: false, logisticsPlan: { vehicleRequired: false, freightRequired: false } }).sections.find(section => section.key === 'D30_LOGISTICS').completed, 0);
});

test('Preparação da Sede remove exames, treinamentos, hospedagem e liberações do cliente e torna o resto opcional', () => {
  const emptyMobilization = readyMobilizationWorkflow({
    executedAtHeadquarters: true,
    // nada do que é opcional foi feito
    preparationResources: { equipment: { defined: false, items: [] }, materials: { defined: false, items: [] } },
    qsmsVerified: null,
    qsmsVerificationNote: null,
    logisticsPlan: {},
    travelPlan: {},
    clientReleases: { attendance: { date: '2026-09-20', confirmed: true }, items: [] }
  });
  // colaborador sem exames/treinamentos liberados nem documentos de cliente
  emptyMobilization.teamPreparation.members[0].checks = emptyMobilization.teamPreparation.members[0].checks.map(check => ({
    ...check,
    status: ['EXAMS_RELEASED', 'TRAININGS_RELEASED'].includes(check.key) ? 'PENDING' : 'DONE'
  }));
  emptyMobilization.documentationCategories = emptyMobilization.documentationCategories.map(category => ({ ...category, required: category.type === 'EXAM' ? true : false }));
  const gate = projectWorkflowMobilizationGate(emptyMobilization);
  assert.equal(gate.ready, true, JSON.stringify(gate.blockers));
  assert.equal(gate.fronts.find(front => front.key === 'LODGING').total, 0);
  const readiness = projectWorkflowPreparationReadiness(emptyMobilization);
  assert.equal(readiness.completed, readiness.total);
  assert.deepEqual(readiness.sections.filter(section => section.optional).map(section => section.key).sort(), ['D15_EQUIPMENT', 'D15_MATERIALS', 'D15_QSMS', 'D15_TRAVEL']);

  // em campo o mesmo cenário continua bloqueado
  const field = { ...emptyMobilization, executedAtHeadquarters: false };
  assert.equal(projectWorkflowMobilizationGate(field).ready, false);
  const fieldKeys = projectWorkflowMobilizationGate(field).blockers.map(item => item.key);
  assert.ok(fieldKeys.includes('QSMS_VERIFIED'));
  assert.ok(fieldKeys.some(key => key.startsWith('TEAM_collaborator-1_EXAMS_RELEASED')));
});

test('Sede continua exigindo a confirmação do atendimento e a equipe notificada', () => {
  const workflow = readyMobilizationWorkflow({ executedAtHeadquarters: true, clientReleases: { attendance: { date: null, confirmed: false }, items: [] } });
  const gate = projectWorkflowMobilizationGate(workflow);
  assert.equal(gate.ready, false);
  assert.deepEqual(gate.blockers.map(item => item.key), ['CLIENT_ATTENDANCE']);
  workflow.clientReleases = { attendance: { date: '2026-09-20', confirmed: true }, items: [] };
  workflow.teamPreparation.members[0].checks.find(check => check.key === 'NOTIFIED').status = 'PENDING';
  assert.deepEqual(projectWorkflowMobilizationGate(workflow).blockers.map(item => item.key), ['TEAM_collaborator-1_NOTIFIED']);
});

test('Sede vai da Preparação para a Execução sem autorização de mobilização, mas com o gate limpo', () => {
  const workflow = readyMobilizationWorkflow({ executedAtHeadquarters: true, stage: 'PREPARATION' });
  assert.deepEqual(projectWorkflowTransitionIssues(workflow, 'EXECUTION'), []);
  assert.deepEqual(projectWorkflowTransitionIssues({ ...workflow, stage: 'EXECUTION' }, 'POST_JOB'), []);
  workflow.preJobCompletedDate = null;
  assert.ok(projectWorkflowTransitionIssues(workflow, 'EXECUTION').length > 0);
  // em campo a Preparação não leva direto à Execução
  assert.deepEqual(projectWorkflowTransitionIssues({ ...readyMobilizationWorkflow({ executedAtHeadquarters: false, stage: 'PREPARATION' }) }, 'EXECUTION'), ['Transição de etapa não permitida']);
  // autorização: em execução com o gate limpo já vale, sem emissão nem revalidação
  const running = readyMobilizationWorkflow({ executedAtHeadquarters: true, stage: 'EXECUTION' });
  const gate = projectWorkflowMobilizationGate(running);
  assert.equal(projectWorkflowMobilizationAuthorization(running, gate).authorized, true);
  assert.equal(projectWorkflowMobilizationAuthorization({ ...running, stage: 'PREPARATION' }, gate).authorized, false);
  assert.equal(projectWorkflowMobilizationAuthorization(running, { ready: false }).authorized, false);
});

test('a categoria "Exames adicionais" some da documentação antecipada da Sede', () => {
  const categories = ['DOCUMENT', 'EXAM', 'TRAINING', 'QUALITY', 'CERTIFICATION'].map(type => ({ type, required: false, requirements: [] }));
  assert.equal(projectWorkflowDocumentationReadiness({ documentationCategories: categories, executedAtHeadquarters: false }, null, null).total, 5);
  const sede = projectWorkflowDocumentationReadiness({ documentationCategories: categories, executedAtHeadquarters: true }, null, null);
  assert.equal(sede.total, 4);
  const unanswered = categories.map(category => ({ ...category, required: category.type === 'EXAM' ? null : false }));
  assert.equal(projectWorkflowDocumentationReadiness({ documentationCategories: unanswered, executedAtHeadquarters: false }, null, null).blockers.length, 1);
  assert.equal(projectWorkflowDocumentationReadiness({ documentationCategories: unanswered, executedAtHeadquarters: true }, null, null).blockers.length, 0);
});

test('o contrato aceita a ação analysis_location', () => {
  const { patch } = makeProjectWorkflowSchemas(z);
  assert.equal(patch.safeParse({ action: 'analysis_location', version: 1, executedAtHeadquarters: true }).success, true);
  assert.equal(patch.safeParse({ action: 'analysis_location', version: 1, executedAtHeadquarters: false }).success, true);
  assert.equal(patch.safeParse({ action: 'analysis_location', version: 1 }).success, false);
  assert.equal(patch.safeParse({ action: 'analysis_location', version: 1, executedAtHeadquarters: null }).success, false);
});
