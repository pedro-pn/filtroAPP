import {
  PROJECT_WORKFLOW_CHECKLISTS,
  PROJECT_WORKFLOW_COMMERCIAL_FACTS,
  PROJECT_WORKFLOW_CRITICAL_QUESTIONS,
  PROJECT_WORKFLOW_DOCUMENTATION_DEFINITIONS
} from '../../../../../shared/schemas/project-workflow.js';

function answeredChecklistKeys(workflow, stage) {
  const answered = new Set((workflow.checklists || [])
    .filter(item => item.status === 'DONE' || item.status === 'NOT_APPLICABLE')
    .filter(item => PROJECT_WORKFLOW_CHECKLISTS.some(definition => definition.key === item.key && definition.stage === stage))
    .map(item => item.key));
  return answered;
}

export function commercialFactIssues(definition, fact) {
  if (!fact || fact.status === 'PENDING') return ['Situação pendente'];
  if (fact.status === 'NOT_APPLICABLE') {
    const issues = [];
    if (!definition.allowNotApplicable) issues.push('Este fato não aceita “não aplicável”');
    if (!fact.note?.trim()) issues.push('Justificativa não informada');
    return issues;
  }
  if (fact.status !== 'CONFIRMED') return ['Situação inválida'];
  const issues = [];
  if (!fact.occurredOn) issues.push('Data da confirmação não informada');
  if (definition.evidence === 'reference' && !fact.reference?.trim() && !fact.evidenceDocumentId) issues.push('Referência não informada');
  if (definition.evidence === 'note' && !fact.note?.trim()) issues.push('Condição comercial não descrita');
  return issues;
}

export function normalizeProjectWorkflowCommercialFacts(workflow) {
  const factByKey = new Map((workflow?.commercialFacts || []).map(item => [item.key, item]));
  return PROJECT_WORKFLOW_COMMERCIAL_FACTS.map(definition => {
    const fact = factByKey.get(definition.key);
    const normalized = {
      ...definition,
      id: null,
      status: 'PENDING',
      source: 'MANUAL',
      evidenceDocumentId: null,
      reference: null,
      note: null,
      occurredOn: null,
      externalId: null,
      externalUrl: null,
      sourceVersion: null,
      sourceUpdatedAt: null,
      lastSyncedAt: null,
      updatedAt: null,
      updatedBy: null,
      ...fact
    };
    return { ...normalized, readOnly: normalized.source === 'CRM' };
  });
}

export function projectWorkflowCommercialReadiness(workflow) {
  const facts = normalizeProjectWorkflowCommercialFacts(workflow);
  const blockers = facts.map(fact => {
    const reasons = commercialFactIssues(fact, fact);
    return reasons.length ? { key: fact.key, label: fact.label, reasons } : null;
  }).filter(Boolean);
  return {
    status: blockers.length ? 'NOT_RELEASED' : 'RELEASED',
    resolvedCount: facts.length - blockers.length,
    totalCount: facts.length,
    blockers: [],
    pendingSignals: blockers,
    blockedOperations: []
  };
}

export function normalizeProjectWorkflowDocumentation(workflow) {
  const byType = new Map((workflow?.documentationCategories || []).map(item => [item.type, item]));
  return PROJECT_WORKFLOW_DOCUMENTATION_DEFINITIONS.map(definition => {
    const category = byType.get(definition.type);
    return {
      id: null,
      required: null,
      updatedAt: null,
      updatedBy: null,
      requirements: [],
      ...definition,
      ...category,
      requirements: (category?.requirements || []).map(requirement => ({
        ...requirement,
        history: requirement.history || []
      }))
    };
  });
}

function resolvedChecklist(item) {
  return item?.status === 'DONE' || item?.status === 'NOT_APPLICABLE';
}

function checklistProgress(workflow, definitions) {
  const byKey = new Map((workflow?.checklists || []).map(item => [item.key, item]));
  const completed = definitions.filter(definition => resolvedChecklist(byKey.get(definition.key))).length;
  return {
    completed,
    total: definitions.length,
    percentage: definitions.length ? Math.round((completed / definitions.length) * 100) : 0
  };
}

export function projectWorkflowDocumentationReadiness(workflow, milestones, today) {
  const categories = normalizeProjectWorkflowDocumentation(workflow);
  const blockers = [];
  let completed = 0;
  for (const category of categories) {
    const active = category.requirements.filter(item => !item.archivedAt);
    if (category.required == null) {
      blockers.push({ key: `DOCUMENTATION_${category.type}`, label: category.label, reason: 'Informar se este tipo é necessário' });
      continue;
    }
    if (category.required === false) {
      completed += 1;
      continue;
    }
    if (!active.length) {
      blockers.push({ key: `DOCUMENTATION_${category.type}`, label: category.label, reason: `Adicionar ao menos um ${category.singularLabel}` });
      continue;
    }
    const pending = active.filter(item => item.status !== 'CONFIRMED' || !item.requestedAt || !item.confirmedAt);
    if (!pending.length) {
      completed += 1;
      continue;
    }
    blockers.push(...pending.map(item => ({
      key: `DOCUMENTATION_REQUIREMENT_${item.id}`,
      label: item.name,
      reason: item.status === 'PENDING' ? 'Solicitação pendente' : item.status === 'REQUESTED' ? 'Confirmação pendente' : 'Datas de acompanhamento incompletas'
    })));
  }
  const urgentByDate = blockers.length > 0
    && milestones?.daysUntilMobilization != null
    && milestones.daysUntilMobilization <= 15;
  const status = blockers.length === 0
    ? 'OK'
    : urgentByDate ? 'CRITICAL' : 'IN_PROGRESS';
  return {
    status,
    completed,
    total: categories.length,
    blockers: blockers.map(item => ({ ...item, reason: urgentByDate ? `${item.reason} a até 15 dias da mobilização` : item.reason }))
  };
}

export function projectWorkflowPlanningReadiness(workflow) {
  const sectionKeys = ['D30_TEAM', 'D30_EQUIPMENT', 'D30_MATERIALS', 'D30_LOGISTICS'];
  const sections = sectionKeys.map(key => {
    const definitions = PROJECT_WORKFLOW_CHECKLISTS.filter(item => item.section === key);
    return { key, ...checklistProgress(workflow, definitions) };
  });
  const completed = sections.reduce((sum, section) => sum + section.completed, 0);
  const total = sections.reduce((sum, section) => sum + section.total, 0);
  return {
    completed,
    total,
    percentage: total ? Math.round((completed / total) * 100) : 0,
    sections
  };
}

export function projectWorkflowPreparationReadiness(workflow) {
  const sectionKeys = ['D15_TEAM', 'D15_CLIENT', 'D15_EQUIPMENT', 'D15_MATERIALS', 'D15_PRE_JOB', 'D15_TRAVEL', 'D15_QSMS'];
  const sections = sectionKeys.map(key => {
    const definitions = PROJECT_WORKFLOW_CHECKLISTS.filter(item => item.section === key);
    return { key, ...checklistProgress(workflow, definitions) };
  });
  const completed = sections.reduce((sum, section) => sum + section.completed, 0);
  const total = sections.reduce((sum, section) => sum + section.total, 0);
  return {
    completed,
    total,
    percentage: total ? Math.round((completed / total) * 100) : 0,
    sections
  };
}

export function projectWorkflowDemobilizationReadiness(workflow) {
  const sectionKeys = ['DEMOBILIZATION_FIELD', 'DEMOBILIZATION_LOGISTICS', 'DEMOBILIZATION_ASSETS'];
  const sections = sectionKeys.map(key => {
    const definitions = PROJECT_WORKFLOW_CHECKLISTS.filter(item => item.section === key);
    return { key, ...checklistProgress(workflow, definitions) };
  });
  const completed = sections.reduce((sum, section) => sum + section.completed, 0);
  const total = sections.reduce((sum, section) => sum + section.total, 0);
  return {
    completed,
    total,
    percentage: total ? Math.round((completed / total) * 100) : 0,
    sections
  };
}

export function projectWorkflowPostJobReadiness(workflow) {
  const sectionKeys = ['POST_JOB_FEEDBACK', 'POST_JOB_LEARNING'];
  const sections = sectionKeys.map(key => {
    const definitions = PROJECT_WORKFLOW_CHECKLISTS.filter(item => item.section === key);
    return { key, ...checklistProgress(workflow, definitions) };
  });
  const completed = sections.reduce((sum, section) => sum + section.completed, 0);
  const total = sections.reduce((sum, section) => sum + section.total, 0);
  return {
    completed,
    total,
    percentage: total ? Math.round((completed / total) * 100) : 0,
    sections
  };
}

export function projectWorkflowCloseoutReadiness(workflow) {
  const sectionKeys = ['CLOSEOUT_DOCUMENTATION', 'CLOSEOUT_MEASUREMENT'];
  const sections = sectionKeys.map(key => {
    const definitions = PROJECT_WORKFLOW_CHECKLISTS.filter(item => item.section === key);
    return { key, ...checklistProgress(workflow, definitions) };
  });
  const completed = sections.reduce((sum, section) => sum + section.completed, 0);
  const total = sections.reduce((sum, section) => sum + section.total, 0);
  return { completed, total, percentage: total ? Math.round((completed / total) * 100) : 0, sections };
}

export function projectWorkflowClosureReadiness(workflow) {
  const definitions = PROJECT_WORKFLOW_CHECKLISTS.filter(item => item.section === 'FINAL_CLOSEOUT');
  return checklistProgress(workflow, definitions);
}

export function projectWorkflowClosureGate(workflow) {
  const closeoutDefinitions = PROJECT_WORKFLOW_CHECKLISTS.filter(item =>
    ['CLOSEOUT_DOCUMENTATION', 'CLOSEOUT_MEASUREMENT'].includes(item.section)
  );
  const finalDefinitions = PROJECT_WORKFLOW_CHECKLISTS.filter(item => item.section === 'FINAL_CLOSEOUT');
  const closeout = readinessFromDefinitions(workflow, 'CLOSEOUT', 'Documentação e medição', closeoutDefinitions);
  const finalChecklist = readinessFromDefinitions(workflow, 'FINAL_CLOSEOUT', 'Checklist final', finalDefinitions);
  const structuredBlockers = [];
  if (!workflow?.postJob?.meetingDate) {
    structuredBlockers.push({ key: 'POST_JOB_MEETING_DATE', label: 'Pós-job', reason: 'Informar a data da reunião de pós-job' });
  }
  if (!workflow?.measurement?.approvedAt) {
    structuredBlockers.push({ key: 'MEASUREMENT_APPROVED_AT', label: 'Medição', reason: 'Informar a data de aprovação da medição' });
  }
  if (workflow?.measurement?.approvedAmount == null) {
    structuredBlockers.push({ key: 'MEASUREMENT_APPROVED_AMOUNT', label: 'Medição', reason: 'Informar o valor aprovado' });
  }
  const openIssues = (workflow?.issues || []).filter(issue => issue.status !== 'RESOLVED');
  const issueBlockers = openIssues.map(issue => ({
    key: `ISSUE_${issue.id}`,
    label: issue.description,
    reason: 'Pendência interna ainda aberta'
  }));
  const documentBlockers = (workflow?.documentRequirements?.CLOSEOUT?.blockers || []).map(item => ({
    key: `DOCUMENT_${item.documentId}`,
    label: item.title,
    reason: item.reason
  }));
  const blockers = [
    ...closeout.blockers,
    ...finalChecklist.blockers,
    ...structuredBlockers,
    ...issueBlockers,
    ...documentBlockers
  ];
  const documentRequirements = workflow?.documentRequirements?.CLOSEOUT || { ready: true, readyCount: 0, totalCount: 0, blockers: [] };
  const completed = closeout.completed + finalChecklist.completed + documentRequirements.readyCount;
  const total = closeout.total + finalChecklist.total + documentRequirements.totalCount;
  return {
    ready: blockers.length === 0,
    completed,
    total,
    percentage: total ? Math.round((completed / total) * 100) : 0,
    closeout,
    finalChecklist,
    documents: documentRequirements,
    blockers
  };
}

function readinessFromDefinitions(workflow, key, label, definitions, extraBlockers = []) {
  const byKey = new Map((workflow?.checklists || []).map(item => [item.key, item]));
  const pending = definitions.filter(definition => !resolvedChecklist(byKey.get(definition.key)));
  const blockers = [
    ...pending.map(item => ({ key: item.key, label: item.label, reason: 'Pendente' })),
    ...extraBlockers
  ];
  return {
    key,
    label,
    status: blockers.length ? 'BLOCKED' : 'READY',
    completed: definitions.length - pending.length,
    total: definitions.length,
    blockers
  };
}

function checklistDefinitions({ sections = [], keys = [] }) {
  const keySet = new Set(keys);
  return PROJECT_WORKFLOW_CHECKLISTS.filter(item => sections.includes(item.section) || keySet.has(item.key));
}

export function projectWorkflowMobilizationGate(workflow, milestones = null, today = null) {
  const commercial = projectWorkflowCommercialReadiness(workflow);
  const documentation = projectWorkflowDocumentationReadiness(workflow, milestones, today);
  const commercialFront = {
    key: 'COMMERCIAL',
    label: 'Comercial',
    status: 'READY',
    completed: commercial.resolvedCount,
    total: commercial.totalCount,
    blockers: []
  };
  const teamDefinitions = checklistDefinitions({
    sections: ['D15_TEAM'],
    keys: ['D15_CLIENT_TEAM_RELEASED']
  });
  const documentDefinitions = checklistDefinitions({
    keys: [
      'D15_TEAM_INDIVIDUAL_DOCUMENTS_CHECKED',
      'D15_TEAM_EXAMS_RELEASED',
      'D15_TEAM_TRAININGS_RELEASED',
      'D15_CLIENT_REGISTRATION_REQUESTED',
      'D15_CLIENT_DOCUMENTS_SENT',
      'D15_CLIENT_INTEGRATION_SCHEDULED'
    ]
  });
  const requiredDocumentBlockers = (workflow?.documentRequirements?.MOBILIZATION?.blockers || []).map(item => ({
    key: `DOCUMENT_${item.documentId}`,
    label: item.title,
    reason: item.reason
  }));
  const fronts = [
    commercialFront,
    readinessFromDefinitions(workflow, 'TEAM', 'Equipe', teamDefinitions),
    (() => {
      const front = readinessFromDefinitions(workflow, 'DOCUMENTATION', 'Documentação', documentDefinitions,
        [...documentation.blockers, ...requiredDocumentBlockers]);
      return { ...front, completed: front.completed + documentation.completed, total: front.total + documentation.total };
    })(),
    readinessFromDefinitions(workflow, 'EQUIPMENT', 'Equipamentos', checklistDefinitions({ sections: ['D15_EQUIPMENT'] })),
    readinessFromDefinitions(workflow, 'MATERIALS', 'Materiais', checklistDefinitions({ sections: ['D15_MATERIALS'] })),
    readinessFromDefinitions(workflow, 'QSMS', 'QSMS', checklistDefinitions({ sections: ['D15_QSMS'] })),
    readinessFromDefinitions(workflow, 'LODGING', 'Hospedagem', checklistDefinitions({ keys: ['D15_TRAVEL_LODGING_REQUESTED', 'D15_TRAVEL_LODGING_CONFIRMED'] })),
    readinessFromDefinitions(workflow, 'LOGISTICS', 'Logística', checklistDefinitions({ keys: ['D15_TRAVEL_TEAM_TRANSPORT_DEFINED', 'D15_TRAVEL_FREIGHT_REQUESTED', 'D15_TRAVEL_COMPANY_TRUCK_RESERVED', 'D15_TRAVEL_DEPARTURE_CONFIRMED'] })),
    readinessFromDefinitions(workflow, 'CLIENT', 'Cliente', checklistDefinitions({ sections: ['D15_CLIENT'] }))
  ];
  const preJob = readinessFromDefinitions(workflow, 'PRE_JOB', 'Pré-job', checklistDefinitions({ sections: ['D15_PRE_JOB'] }));
  const criticalIssues = (workflow?.issues || []).filter(issue => issue.status !== 'RESOLVED' && issue.criticality === 'HIGH' && issue.sourceQuestion !== 'CLIENT_REQUIREMENTS');
  const rawBlockers = [
    ...fronts.flatMap(front => front.blockers.map(blocker => ({ ...blocker, front: front.key }))),
    ...preJob.blockers.map(blocker => ({ ...blocker, front: preJob.key })),
    ...criticalIssues.map(issue => ({ key: issue.id, label: issue.description, reason: 'Pendência crítica aberta', front: 'CRITICAL_ISSUES' }))
  ];
  const blockers = [...new Map(rawBlockers.map(blocker => [blocker.key, blocker])).values()];
  const ready = fronts.every(front => front.status === 'READY') && preJob.status === 'READY' && criticalIssues.length === 0;
  const deadlineStatus = ready
    ? 'READY'
    : milestones?.dueMilestones?.includes('D1') ? 'RISK'
      : milestones?.dueMilestones?.includes('D7') ? 'ATTENTION' : 'PENDING';
  return { ready, fronts, preJob, blockers, deadlineStatus };
}

export function projectWorkflowMobilizationAuthorization(workflow, gate) {
  const authorizedAt = workflow?.mobilizationAuthorizedAt || null;
  const authorizedVersion = workflow?.mobilizationAuthorizationVersion ?? null;
  const currentVersion = workflow?.version ?? null;
  const authorized = Boolean(
    authorizedAt
    && ['READY_TO_MOBILIZE', 'MOBILIZATION', 'EXECUTION'].includes(workflow?.stage)
    && gate?.ready
    && authorizedVersion === currentVersion
  );
  return {
    status: authorized ? 'AUTHORIZED' : authorizedAt ? 'SUSPENDED' : 'NOT_AUTHORIZED',
    authorized,
    authorizedAt,
    authorizedVersion,
    currentVersion
  };
}

export function incompleteChecklistLabels(workflow, stage) {
  const answered = answeredChecklistKeys(workflow, stage);
  return PROJECT_WORKFLOW_CHECKLISTS
    .filter(item => item.stage === stage && !answered.has(item.key))
    .map(item => item.label);
}

export function handoverGateIssues(workflow) {
  const issues = [];
  if (!workflow.leaderUserId) issues.push('Definir o Líder de Projetos');
  for (const blocker of workflow?.documentRequirements?.HANDOVER?.blockers || []) {
    issues.push(`${blocker.title}: ${blocker.reason}`);
  }
  return issues;
}

export function demobilizationGateIssues(workflow) {
  const issues = incompleteChecklistLabels(workflow, 'DEMOBILIZATION');
  if (!workflow.fieldCompletionDate) issues.push('Informar a data de conclusão de campo');
  if (!workflow.demobilizationDate) issues.push('Informar a data efetiva de desmobilização');
  return issues;
}

export function postJobGateIssues(workflow) {
  const issues = incompleteChecklistLabels(workflow, 'POST_JOB');
  if (!workflow.postJob?.meetingDate) issues.push('Informar a data da reunião de pós-job');
  return issues;
}

export function analysisGateIssues(workflow) {
  const issues = incompleteChecklistLabels(workflow, 'INITIAL_ANALYSIS');
  const answerByKey = new Map((workflow.criticalAnswers || []).map(item => [item.key, item.answer]));
  const issueByQuestion = new Map((workflow.issues || []).map(item => [item.sourceQuestion, item]));
  for (const question of PROJECT_WORKFLOW_CRITICAL_QUESTIONS) {
    if (!answerByKey.has(question.key)) {
      issues.push(`Responder: ${question.label}`);
      continue;
    }
    if (!answerByKey.get(question.key) || question.createsIssue === false) continue;
    const issue = issueByQuestion.get(question.key);
    if (!issue?.area || !issue?.ownerName || !issue?.requiredLeadTimeDays || !issue?.dueDate) {
      issues.push(`Encaminhar a pendência: ${question.issueDescription}`);
    }
  }
  return issues;
}

export function planningGateIssues(workflow) {
  const definitions = PROJECT_WORKFLOW_CHECKLISTS.filter(item => item.section.startsWith('D30_'));
  const byKey = new Map((workflow?.checklists || []).map(item => [item.key, item]));
  return definitions.filter(item => !resolvedChecklist(byKey.get(item.key))).map(item => item.label);
}

export function allowedProjectWorkflowTransition(current, target) {
  if (current === target) return false;
  const transitions = {
    HANDOVER: [],
    INITIAL_ANALYSIS: ['WAITING_PLANNING', 'MOBILIZATION_PLANNING'],
    WAITING_PLANNING: ['INITIAL_ANALYSIS', 'MOBILIZATION_PLANNING'],
    MOBILIZATION_PLANNING: ['INITIAL_ANALYSIS', 'WAITING_PLANNING', 'PREPARATION'],
    PREPARATION: ['MOBILIZATION_PLANNING', 'READY_TO_MOBILIZE'],
    READY_TO_MOBILIZE: ['PREPARATION', 'MOBILIZATION'],
    MOBILIZATION: ['READY_TO_MOBILIZE', 'EXECUTION'],
    EXECUTION: ['MOBILIZATION', 'DEMOBILIZATION'],
    DEMOBILIZATION: ['EXECUTION', 'POST_JOB'],
    POST_JOB: ['DEMOBILIZATION', 'FINAL_MEASUREMENT'],
    FINAL_MEASUREMENT: ['POST_JOB', 'FINISHED'],
    FINISHED: ['FINAL_MEASUREMENT']
  };
  return transitions[current]?.includes(target) || false;
}

export function projectWorkflowTransitionIssues(workflow, target) {
  if (!allowedProjectWorkflowTransition(workflow.stage, target)) return ['Transição de etapa não permitida'];
  if (target === 'WAITING_PLANNING' || target === 'MOBILIZATION_PLANNING') {
    if (!workflow.acceptedAt) return ['O Líder de Projetos ainda não aceitou o handover'];
    return analysisGateIssues(workflow);
  }
  if (target === 'PREPARATION' && workflow.stage === 'MOBILIZATION_PLANNING') return planningGateIssues(workflow);
  if (target === 'POST_JOB' && workflow.stage === 'DEMOBILIZATION') return demobilizationGateIssues(workflow);
  if (target === 'FINAL_MEASUREMENT' && workflow.stage === 'POST_JOB') return postJobGateIssues(workflow);
  if (target === 'FINISHED') {
    return projectWorkflowClosureGate(workflow).blockers.map(item => `${item.label}: ${item.reason}`);
  }
  if (target === 'READY_TO_MOBILIZE') {
    return projectWorkflowMobilizationGate(workflow).blockers.map(item => `${item.label}: ${item.reason}`);
  }
  if (target === 'MOBILIZATION' || target === 'EXECUTION') {
    const gate = projectWorkflowMobilizationGate(workflow);
    const authorization = projectWorkflowMobilizationAuthorization(workflow, gate);
    const returningToExecution = workflow.stage === 'DEMOBILIZATION' && target === 'EXECUTION';
    const returnIsRevalidated = Boolean(
      workflow.mobilizationAuthorizedAt
      && workflow.mobilizationAuthorizationVersion === workflow.version
      && gate.ready
    );
    if (!authorization.authorized && !(returningToExecution && returnIsRevalidated)) {
      return ['O projeto precisa de uma autorização de mobilização vigente'];
    }
  }
  return [];
}
