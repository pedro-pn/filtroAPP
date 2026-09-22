import {
  PROJECT_WORKFLOW_CHECKLISTS,
  PROJECT_WORKFLOW_CLIENT_RELEASES,
  PROJECT_WORKFLOW_COMMERCIAL_FACTS,
  PROJECT_WORKFLOW_CRITICAL_QUESTIONS,
  PROJECT_WORKFLOW_DOCUMENTATION_DEFINITIONS,
  PROJECT_WORKFLOW_HEADQUARTERS_HIDDEN_CRITICAL_QUESTIONS,
  PROJECT_WORKFLOW_HEADQUARTERS_HIDDEN_DOCUMENTATION_TYPES,
  PROJECT_WORKFLOW_HEADQUARTERS_HIDDEN_TEAM_CHECKS,
  PROJECT_WORKFLOW_HEADQUARTERS_OPTIONAL_SECTIONS,
  PROJECT_WORKFLOW_PREPARATION_ITEM_CHECKS,
  PROJECT_WORKFLOW_STAGES,
  isHeadquartersWorkflow,
  projectWorkflowStageTransitions
} from '../../../../../shared/schemas/project-workflow.js';
import { isResourceConflictIssue } from './resource-conflicts.js';

// Eventos que colocam o projeto numa etapa: o início da gestão abre o Handover, o aceite abre a
// Análise inicial e as demais mudanças registram a etapa de destino em `data.stage`.
export const PROJECT_WORKFLOW_STAGE_EVENT_ACTIONS = ['WORKFLOW_STARTED', 'WORKFLOW_ACCEPT', 'WORKFLOW_STAGE'];
const STAGE_ENTRY_BY_ACTION = { WORKFLOW_STARTED: 'HANDOVER', WORKFLOW_ACCEPT: 'INITIAL_ANALYSIS' };

// Datas reais de cada etapa, reconstruídas do histórico em ordem cronológica. Quando o fluxo volta
// e reabre uma etapa, vale a última entrada: a conclusão anterior deixa de valer.
export function projectWorkflowStageTimeline(events = []) {
  const timeline = {};
  let active = null;
  const ordered = [...events].sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt));
  for (const event of ordered) {
    const stage = STAGE_ENTRY_BY_ACTION[event.action] || (event.action === 'WORKFLOW_STAGE' ? event.data?.stage : null);
    if (!PROJECT_WORKFLOW_STAGES.includes(stage) || stage === active) continue;
    const at = new Date(event.createdAt).toISOString();
    if (active) timeline[active] = { ...timeline[active], completedAt: at };
    timeline[stage] = { enteredAt: at, completedAt: null };
    active = stage;
  }
  return timeline;
}

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

export function activeProjectWorkflowIssues(workflow) {
  const issueQuestionKeys = new Set(PROJECT_WORKFLOW_CRITICAL_QUESTIONS
    .filter(item => item.createsIssue !== false)
    .map(item => item.key));
  const positiveAnswers = new Set((workflow?.criticalAnswers || [])
    .filter(item => item.answer === true && issueQuestionKeys.has(item.key))
    .map(item => item.key));
  return (workflow?.issues || []).filter(issue => issue.sourceQuestion && (positiveAnswers.has(issue.sourceQuestion) || isResourceConflictIssue(issue)));
}

export function normalizeProjectWorkflowDocumentation(workflow) {
  const byType = new Map((workflow?.documentationCategories || []).map(item => [item.type, item]));
  const hiddenTypes = isHeadquartersWorkflow(workflow) ? PROJECT_WORKFLOW_HEADQUARTERS_HIDDEN_DOCUMENTATION_TYPES : [];
  return PROJECT_WORKFLOW_DOCUMENTATION_DEFINITIONS.filter(definition => !hiddenTypes.includes(definition.type)).map(definition => {
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

function countedSection(key, completed, total) {
  return { key, completed, total, percentage: total ? Math.round((completed / total) * 100) : 0 };
}

function teamMemberProgress(workflow, keys, { requireTeam = true } = {}) {
  const members = workflow?.teamPreparation?.members || [];
  if (!workflow?.teamPreparation?.defined || members.length === 0) {
    return requireTeam
      ? {
          completed: 0,
          total: 1,
          percentage: 0,
          blockers: [{ key: 'TEAM_DEFINITION', label: 'Equipe definitiva', reason: 'Aguardando definição da equipe' }]
        }
      : { completed: 0, total: 0, percentage: 0, blockers: [] };
  }
  const hiddenKeys = isHeadquartersWorkflow(workflow) ? PROJECT_WORKFLOW_HEADQUARTERS_HIDDEN_TEAM_CHECKS : [];
  const requestedKeys = new Set(keys.filter(key => !hiddenKeys.includes(key)));
  const entries = members.flatMap(member => (member.checks || [])
    .filter(check => requestedKeys.has(check.key))
    .map(check => ({ member, check })));
  const completed = entries.filter(({ check }) => resolvedChecklist(check)).length;
  const blockers = entries
    .filter(({ check }) => !resolvedChecklist(check))
    .map(({ member, check }) => ({
      key: `TEAM_${member.collaboratorId}_${check.key}`,
      label: member.name,
      reason: `${check.label} pendente`
    }));
  return {
    completed,
    total: entries.length,
    percentage: entries.length ? Math.round((completed / entries.length) * 100) : 0,
    blockers
  };
}

function preparationItems(workflow, itemType) {
  const publicItems = itemType === 'EQUIPMENT'
    ? workflow?.preparationResources?.equipment?.items
    : workflow?.preparationResources?.materials?.items;
  if (publicItems?.length) return publicItems;
  const records = new Map((workflow?.preparationItemChecks || []).map(item => [
    `${item.itemType}:${item.itemId}:${item.key}`,
    item
  ]));
  const definitions = PROJECT_WORKFLOW_PREPARATION_ITEM_CHECKS[itemType];
  const ids = itemType === 'EQUIPMENT'
    ? (workflow?.equipmentCategoryPlans || []).flatMap(plan => Array.isArray(plan.equipmentIds) ? plan.equipmentIds : [])
    : (Array.isArray(workflow?.supplyPlan) ? workflow.supplyPlan.map(item => item.id) : []);
  return [...new Set(ids)].map(id => ({
    id,
    name: itemType === 'EQUIPMENT' ? 'Equipamento reservado' : workflow.supplyPlan.find(item => item.id === id)?.name || 'Material programado',
    checks: definitions.map(definition => ({
      key: definition.key,
      label: definition.label,
      status: records.get(`${itemType}:${id}:${definition.key}`)?.status || 'PENDING'
    }))
  }));
}

// Na Sede a seção continua visível, mas deixa de bloquear o avanço e de compor o progresso geral.
function optionalInHeadquarters(workflow, progress) {
  return isHeadquartersWorkflow(workflow) ? { ...progress, blockers: [], optional: true } : progress;
}

function sumRequired(sections) {
  const required = sections.filter(section => !section.optional);
  const completed = required.reduce((sum, section) => sum + section.completed, 0);
  const total = required.reduce((sum, section) => sum + section.total, 0);
  return { completed, total };
}

function preparationItemProgress(workflow, itemType) {
  const items = preparationItems(workflow, itemType);
  const sectionLabel = itemType === 'EQUIPMENT' ? 'Equipamentos reservados' : 'Materiais programados';
  // O planejamento D-30 já pode ter respondido "não é necessário" — não vira bloqueio aqui também.
  const notNeeded = itemType === 'EQUIPMENT' ? workflow?.equipmentPlanDefined === false : workflow?.supplyPlanDefined === false;
  if (!items.length && (isHeadquartersWorkflow(workflow) || notNeeded)) {
    return { completed: 0, total: 0, percentage: 0, blockers: [], optional: true };
  }
  if (!items.length) {
    return {
      completed: 0,
      total: 1,
      percentage: 0,
      blockers: [{ key: `${itemType}_DEFINITION`, label: sectionLabel, reason: 'Nenhum item foi definido no planejamento D-30' }]
    };
  }
  const entries = items.flatMap(item => (item.checks || []).map(check => ({ item, check })));
  const completed = entries.filter(({ check }) => resolvedChecklist(check)).length;
  const blockers = entries.filter(({ check }) => !resolvedChecklist(check)).map(({ item, check }) => ({
    key: `${itemType}_${item.id}_${check.key}`,
    label: item.code ? `${item.code} · ${item.name}` : item.name,
    reason: `${check.label} pendente`
  }));
  return optionalInHeadquarters(workflow, {
    completed,
    total: entries.length,
    percentage: entries.length ? Math.round((completed / entries.length) * 100) : 0,
    blockers
  });
}

function clientReleaseProgress(workflow) {
  const attendance = workflow?.clientReleases?.attendance || {};
  const providedItems = new Map((workflow?.clientReleases?.items || []).map(item => [item.key, item]));
  // Na Sede não há cadastro, envio de documentação nem integração no cliente: fica só a confirmação do atendimento.
  const items = (isHeadquartersWorkflow(workflow) ? [] : PROJECT_WORKFLOW_CLIENT_RELEASES).map(definition => ({
    ...definition,
    requested: false,
    requestedAt: null,
    requestedTo: null,
    completed: false,
    completedAt: null,
    ...providedItems.get(definition.key)
  }));
  let completed = attendance.confirmed && attendance.date ? 1 : 0;
  const blockers = [];
  if (!attendance.date) {
    blockers.push({ key: 'CLIENT_ATTENDANCE', label: 'Confirmação do atendimento', reason: 'Informar a data do atendimento' });
  } else if (!attendance.confirmed) {
    blockers.push({ key: 'CLIENT_ATTENDANCE', label: 'Confirmação do atendimento', reason: 'Confirmar a data do atendimento' });
  }
  for (const item of items) {
    const requestComplete = item.requested && item.requestedAt;
    const completionComplete = item.completed && item.completedAt;
    if (requestComplete) completed += 1;
    else blockers.push({
      key: `CLIENT_${item.key}_REQUEST`,
      label: item.label,
      reason: !item.requested ? 'Solicitação pendente' : 'Informar a data da solicitação'
    });
    if (completionComplete) completed += 1;
    else blockers.push({
      key: `CLIENT_${item.key}_COMPLETION`,
      label: item.label,
      reason: 'Conclusão pendente'
    });
  }
  const total = 1 + (items.length * 2);
  return {
    completed,
    total,
    percentage: total ? Math.round((completed / total) * 100) : 0,
    blockers
  };
}

function preJobProgress(workflow) {
  const scheduled = Boolean(workflow?.preJobScheduledDate);
  const completed = Boolean(workflow?.preJobCompletedDate);
  const blockers = [];
  if (!scheduled) blockers.push({ key: 'PRE_JOB_SCHEDULED', label: 'Pré-job', reason: 'Informar a data do agendamento' });
  if (!completed) blockers.push({ key: 'PRE_JOB_COMPLETED', label: 'Pré-job', reason: 'Informar a data da realização' });
  const completedCount = Number(scheduled) + Number(completed);
  return {
    key: 'PRE_JOB',
    label: 'Pré-job',
    status: blockers.length ? 'BLOCKED' : 'READY',
    completed: completedCount,
    total: 2,
    percentage: completedCount * 50,
    blockers
  };
}

function qsmsProgress(workflow) {
  const qsms = workflow?.qsms && typeof workflow.qsms === 'object'
    ? workflow.qsms
    : {};
  const verified = typeof qsms.verified === 'boolean'
    ? qsms.verified
    : typeof workflow?.qsmsVerified === 'boolean' ? workflow.qsmsVerified : null;
  // O registro do que foi verificado é opcional: marcar como verificado já basta para liberar a frente.
  let blocker = null;
  if (verified === null) {
    blocker = { key: 'QSMS_VERIFIED', label: 'QSMS', reason: 'Informar se o QSMS foi verificado' };
  } else if (!verified) {
    blocker = { key: 'QSMS_VERIFIED', label: 'QSMS', reason: 'Realizar a verificação de QSMS' };
  }
  const progress = optionalInHeadquarters(workflow, {
    key: 'QSMS',
    label: 'QSMS',
    status: blocker ? 'BLOCKED' : 'READY',
    completed: blocker ? 0 : 1,
    total: 1,
    percentage: blocker ? 0 : 100,
    blockers: blocker ? [blocker] : []
  });
  return { ...progress, status: progress.blockers.length ? 'BLOCKED' : 'READY' };
}

function travelProgress(workflow) {
  const travel = workflow?.travel && typeof workflow.travel === 'object'
    ? workflow.travel
    : workflow?.travelPlan && typeof workflow.travelPlan === 'object' && !Array.isArray(workflow.travelPlan)
      ? workflow.travelPlan
      : {};
  // Na Sede não há hospedagem.
  const lodgingRequired = !isHeadquartersWorkflow(workflow) && workflow?.logisticsPlan?.lodgingRequired !== false;
  const freightRequired = workflow?.logisticsPlan?.freightRequired !== false;
  const lodgingBlockers = [];
  let lodgingCompleted = 0;
  if (lodgingRequired) {
    if (travel.lodgingRequestedDate) lodgingCompleted += 1;
    else lodgingBlockers.push({ key: 'TRAVEL_LODGING_REQUESTED', label: 'Hospedagem', reason: 'Informar a data da solicitação' });
    if (travel.lodgingConfirmedDate) lodgingCompleted += 1;
    else lodgingBlockers.push({ key: 'TRAVEL_LODGING_CONFIRMED', label: 'Hospedagem', reason: 'Informar a data da confirmação' });
  }
  const lodging = {
    key: 'LODGING',
    label: 'Hospedagem',
    status: lodgingBlockers.length ? 'BLOCKED' : 'READY',
    completed: lodgingCompleted,
    total: lodgingRequired ? 2 : 0,
    blockers: lodgingBlockers
  };

  const logisticsBlockers = [];
  let logisticsCompleted = 0;
  // Modo "Locação de carro" não tem tipo de veículo (só a quantidade); "Nosso"/"Frete" exigem o tipo escolhido.
  const transportModeComplete = (mode, vehicleType, quantity) => Boolean(
    mode && (mode === 'RENTAL' || vehicleType) && Number.isInteger(quantity) && quantity >= 1
  );
  const transportComplete = travel.teamTransportDefined === true
    && transportModeComplete(travel.teamTransportMode, travel.teamTransportVehicleType, travel.teamTransportQuantity);
  if (transportComplete) logisticsCompleted += 1;
  else logisticsBlockers.push({
    key: 'TRAVEL_TEAM_TRANSPORT',
    label: 'Transporte da equipe',
    reason: travel.teamTransportDefined == null
      ? 'Definir Sim ou Não'
      : travel.teamTransportDefined === false
        ? 'Definir o transporte da equipe'
        : 'Selecionar o veículo e a quantidade'
  });
  if (freightRequired) {
    const freightComplete = travel.freightDefined === true && Boolean(
      transportModeComplete(travel.freightMode, travel.freightVehicleType, travel.freightQuantity)
      && travel.freightDepartureDate && travel.freightDepartureTime
    );
    if (freightComplete) logisticsCompleted += 1;
    else logisticsBlockers.push({
      key: 'TRAVEL_FREIGHT',
      label: 'Frete',
      reason: travel.freightDefined !== true
        ? 'Definir o frete'
        : 'Selecionar o veículo, a quantidade, a data e o horário de saída'
    });
  }
  const logistics = {
    key: 'LOGISTICS',
    label: 'Logística',
    status: isHeadquartersWorkflow(workflow) || !logisticsBlockers.length ? 'READY' : 'BLOCKED',
    completed: logisticsCompleted,
    total: freightRequired ? 2 : 1,
    blockers: isHeadquartersWorkflow(workflow) ? [] : logisticsBlockers,
    ...(isHeadquartersWorkflow(workflow) ? { optional: true } : {})
  };
  const completed = lodging.completed + logistics.completed;
  const total = lodging.total + logistics.total;
  return {
    completed,
    total,
    percentage: total ? Math.round((completed / total) * 100) : 100,
    blockers: [...lodging.blockers, ...logistics.blockers],
    lodging,
    logistics,
    ...(isHeadquartersWorkflow(workflow) ? { optional: true } : {})
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
  const preparationLeadTimeDays = milestones?.preparationLeadTimeDays || 15;
  const urgentByDate = blockers.length > 0
    && milestones?.daysUntilMobilization != null
    && milestones.daysUntilMobilization <= preparationLeadTimeDays;
  const status = blockers.length === 0
    ? 'OK'
    : urgentByDate ? 'CRITICAL' : 'IN_PROGRESS';
  return {
    status,
    completed,
    total: categories.length,
    blockers: blockers.map(item => ({ ...item, reason: urgentByDate ? `${item.reason} a até ${preparationLeadTimeDays} dias da mobilização` : item.reason }))
  };
}

export function projectWorkflowPlanningReadiness(workflow) {
  const supplyPlan = Array.isArray(workflow?.supplyPlan) ? workflow.supplyPlan : [];
  const logistics = workflow?.logisticsPlan && typeof workflow.logisticsPlan === 'object' && !Array.isArray(workflow.logisticsPlan)
    ? workflow.logisticsPlan
    : {};
  const headquarters = isHeadquartersWorkflow(workflow);
  const logisticsComplete = typeof logistics.vehicleRequired === 'boolean'
    && typeof logistics.freightRequired === 'boolean'
    && (headquarters || typeof logistics.lodgingRequired === 'boolean')
    && (logistics.vehicleRequired === false || (Number(logistics.vehicleQuantity) > 0 && ['CARRO', 'CAMINHAO'].includes(logistics.vehicleType)))
    && (headquarters || logistics.lodgingRequired === false || (
      Number(logistics.lodgingPeopleCount) > 0
      && Boolean(logistics.lodgingExpectedDate)
      && typeof logistics.lodgingRequested === 'boolean'
      && (logistics.lodgingRequested === false || Boolean(logistics.lodgingRequestedAt))
    ));
  // "Não é necessário" (defined === false) é uma resposta completa, igual a "Sim" com itens definidos.
  const structuredSections = [
    { key: 'D30_TEAM', complete: workflow?.teamPlanDefined === false || (workflow?.teamPlanDefined === true && (workflow?.teamDemands || []).length > 0) },
    { key: 'D30_EQUIPMENT', complete: workflow?.equipmentPlanDefined === false || (workflow?.equipmentPlanDefined === true && (workflow?.equipmentCategoryPlans || []).length > 0) },
    { key: 'D30_MATERIALS', complete: workflow?.supplyPlanDefined === false || (workflow?.supplyPlanDefined === true && supplyPlan.length > 0) },
    { key: 'D30_LOGISTICS', complete: logisticsComplete }
  ].map(item => ({
    key: item.key,
    completed: item.complete ? 1 : 0,
    total: 1,
    percentage: item.complete ? 100 : 0,
    ...(headquarters && PROJECT_WORKFLOW_HEADQUARTERS_OPTIONAL_SECTIONS.includes(item.key) ? { optional: true } : {})
  }));
  const sections = structuredSections;
  const { completed, total } = sumRequired(sections);
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
    if (key === 'D15_TEAM') return { key, ...teamMemberProgress(workflow, ['NOTIFIED', 'DOCUMENTS_CHECKED', 'EXAMS_RELEASED', 'TRAININGS_RELEASED']) };
    if (key === 'D15_CLIENT') return { key, ...clientReleaseProgress(workflow) };
    if (key === 'D15_EQUIPMENT') return { key, ...preparationItemProgress(workflow, 'EQUIPMENT') };
    if (key === 'D15_MATERIALS') return { key, ...preparationItemProgress(workflow, 'MATERIAL') };
    if (key === 'D15_PRE_JOB') return { ...preJobProgress(workflow), key };
    if (key === 'D15_QSMS') return { ...qsmsProgress(workflow), key };
    if (key === 'D15_TRAVEL') {
      const travel = travelProgress(workflow);
      return { key, completed: travel.completed, total: travel.total, percentage: travel.percentage, ...(travel.optional ? { optional: true } : {}) };
    }
    const definitions = PROJECT_WORKFLOW_CHECKLISTS.filter(item => item.section === key);
    return { key, ...checklistProgress(workflow, definitions) };
  });
  // O gate de mobilização também exige a documentação (tipos e anexos obrigatórios) e as pendências críticas resolvidas.
  const documentation = projectWorkflowDocumentationReadiness(workflow, null, null);
  const requiredDocuments = workflow?.documentRequirements?.MOBILIZATION || { readyCount: 0, totalCount: 0 };
  sections.push(countedSection('D15_DOCUMENTATION', documentation.completed + requiredDocuments.readyCount, documentation.total + requiredDocuments.totalCount));
  const criticalIssues = activeProjectWorkflowIssues(workflow).filter(issue => issue.criticality === 'HIGH');
  sections.push(countedSection('D15_CRITICAL_ISSUES', criticalIssues.filter(issue => issue.status === 'RESOLVED').length, criticalIssues.length));
  const { completed, total } = sumRequired(sections);
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
  // O gate da etapa exige as datas de conclusão de campo e de desmobilização, além do checklist.
  sections.push(countedSection('DEMOBILIZATION_DATES', [workflow?.fieldCompletionDate, workflow?.demobilizationDate].filter(Boolean).length, 2));
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
  // O gate da etapa exige a data da reunião de pós-job, além do checklist.
  sections.push(countedSection('POST_JOB_MEETING', workflow?.postJob?.meetingDate ? 1 : 0, 1));
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
  // O encerramento também exige a data de aprovação e o valor aprovado da medição.
  sections.push(countedSection('CLOSEOUT_MEASUREMENT_APPROVAL', [Boolean(workflow?.measurement?.approvedAt), workflow?.measurement?.approvedAmount != null].filter(Boolean).length, 2));
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
  const openIssues = activeProjectWorkflowIssues(workflow).filter(issue => issue.status !== 'RESOLVED');
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
  const structuredTotal = 3;
  const structuredCompleted = structuredTotal - structuredBlockers.length;
  const activeIssues = activeProjectWorkflowIssues(workflow);
  const completed = closeout.completed + finalChecklist.completed + documentRequirements.readyCount + structuredCompleted + (activeIssues.length - openIssues.length);
  const total = closeout.total + finalChecklist.total + documentRequirements.totalCount + structuredTotal + activeIssues.length;
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
  const teamProgress = teamMemberProgress(workflow, ['NOTIFIED']);
  const memberDocumentProgress = teamMemberProgress(workflow, ['DOCUMENTS_CHECKED', 'EXAMS_RELEASED', 'TRAININGS_RELEASED'], { requireTeam: false });
  const clientProgress = clientReleaseProgress(workflow);
  const equipmentProgress = preparationItemProgress(workflow, 'EQUIPMENT');
  const materialProgress = preparationItemProgress(workflow, 'MATERIAL');
  const travel = travelProgress(workflow);
  const requiredDocumentBlockers = (workflow?.documentRequirements?.MOBILIZATION?.blockers || []).map(item => ({
    key: `DOCUMENT_${item.documentId}`,
    label: item.title,
    reason: item.reason
  }));
  const fronts = [
    commercialFront,
    { key: 'TEAM', label: 'Equipe', status: teamProgress.blockers.length ? 'BLOCKED' : 'READY', ...teamProgress },
    (() => {
      const blockers = [...memberDocumentProgress.blockers, ...documentation.blockers, ...requiredDocumentBlockers];
      return {
        key: 'DOCUMENTATION',
        label: 'Documentação',
        status: blockers.length ? 'BLOCKED' : 'READY',
        completed: memberDocumentProgress.completed + documentation.completed,
        total: memberDocumentProgress.total + documentation.total,
        blockers
      };
    })(),
    { key: 'EQUIPMENT', label: 'Equipamentos', status: equipmentProgress.blockers.length ? 'BLOCKED' : 'READY', ...equipmentProgress },
    { key: 'MATERIALS', label: 'Materiais', status: materialProgress.blockers.length ? 'BLOCKED' : 'READY', ...materialProgress },
    qsmsProgress(workflow),
    travel.lodging,
    travel.logistics,
    { key: 'CLIENT', label: 'Cliente', status: clientProgress.blockers.length ? 'BLOCKED' : 'READY', ...clientProgress }
  ];
  const preJob = preJobProgress(workflow);
  const criticalIssues = activeProjectWorkflowIssues(workflow).filter(issue => issue.status !== 'RESOLVED' && issue.criticality === 'HIGH');
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

// Sem "Pronto para mobilizar" não há mais autorização manual a emitir ou revalidar: a partir da Mobilização
// (ou da Execução, na Sede), com o gate limpo, o projeto está liberado — reavaliado a cada consulta, nunca um
// flag fixo que possa ficar "suspenso".
export function projectWorkflowMobilizationAuthorization(workflow, gate) {
  // A Desmobilização fica de fora: ela encerra a autorização para novas saídas operacionais (romaneios,
  // retiradas do Estoque). O retorno da Desmobilização para a Execução usa o gate diretamente, não este status.
  const relevantStages = isHeadquartersWorkflow(workflow)
    ? ['EXECUTION']
    : ['MOBILIZATION', 'EXECUTION'];
  const authorized = relevantStages.includes(workflow?.stage) && Boolean(gate?.ready);
  return {
    status: authorized ? 'AUTHORIZED' : 'NOT_AUTHORIZED',
    authorized,
    authorizedAt: null,
    authorizedVersion: null,
    currentVersion: workflow?.version ?? null
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
  // Sede ou campo muda o restante do fluxo (checklists, hospedagem, mobilização): precisa ser respondido
  // antes de assumir a análise, para a Análise inicial já nascer ciente da modalidade.
  if (workflow.executedAtHeadquarters == null) issues.push('Informar se o projeto será executado na Sede ou em campo');
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

// Cada checagem da análise inicial alimenta, ao mesmo tempo, o gate da etapa e o progresso exibido:
// o percentual só chega a 100% quando o gate não tem mais pendências.
function analysisChecks(workflow) {
  const answered = answeredChecklistKeys(workflow, 'INITIAL_ANALYSIS');
  const checks = PROJECT_WORKFLOW_CHECKLISTS
    .filter(item => item.stage === 'INITIAL_ANALYSIS')
    .map(item => ({ key: item.key, issues: answered.has(item.key) ? [] : [item.label] }));
  const contactIssues = [];
  if (workflow.analysisClientContactMade !== true) {
    contactIssues.push('Realizar e confirmar o contato inicial com o cliente');
  } else {
    if (!workflow.analysisClientContactName?.trim()) contactIssues.push('Informar o nome do contato inicial com o cliente');
    if (!workflow.analysisClientContactPhone?.trim()) contactIssues.push('Informar o telefone do contato inicial com o cliente');
    if (!workflow.analysisClientContactDate) contactIssues.push('Informar a data do contato inicial com o cliente');
  }
  checks.push({ key: 'ANALYSIS_CLIENT_CONTACT', issues: contactIssues });
  const criticalityIssues = [];
  if (workflow.isCritical == null) {
    criticalityIssues.push('Informar se a obra é crítica');
  } else if (workflow.isCritical && (!Number.isInteger(workflow.preparationLeadTimeDays) || workflow.preparationLeadTimeDays < 15)) {
    criticalityIssues.push('Informar a antecedência de preparação da obra crítica');
  }
  checks.push({ key: 'ANALYSIS_CRITICALITY', issues: criticalityIssues });
  // Sede ou campo já foi exigido no gate do Handover: aqui só se lê a resposta.
  const hiddenQuestions = isHeadquartersWorkflow(workflow) ? PROJECT_WORKFLOW_HEADQUARTERS_HIDDEN_CRITICAL_QUESTIONS : [];
  const answerByKey = new Map((workflow.criticalAnswers || []).map(item => [item.key, item.answer]));
  const issueByQuestion = new Map((workflow.issues || []).map(item => [item.sourceQuestion, item]));
  for (const question of PROJECT_WORKFLOW_CRITICAL_QUESTIONS.filter(item => !hiddenQuestions.includes(item.key))) {
    const questionIssues = [];
    if (!answerByKey.has(question.key)) {
      questionIssues.push(`Responder: ${question.label}`);
    } else if (answerByKey.get(question.key) && question.createsIssue !== false) {
      // O responsável nomeado ("para quem") saiu do fluxo: só a área (definida pela própria pergunta), o
      // prazo necessário e a data limite continuam exigidos para dar a pendência por encaminhada.
      const issue = issueByQuestion.get(question.key);
      if (!issue?.area || !issue?.requiredLeadTimeDays || !issue?.dueDate) {
        questionIssues.push(`Encaminhar a pendência: ${question.issueDescription}`);
      }
    }
    checks.push({ key: `ANALYSIS_QUESTION_${question.key}`, issues: questionIssues });
  }
  return checks;
}

export function analysisGateIssues(workflow) {
  return analysisChecks(workflow).flatMap(check => check.issues);
}

export function projectWorkflowAnalysisReadiness(workflow) {
  const checks = analysisChecks(workflow);
  const completed = checks.filter(check => check.issues.length === 0).length;
  return {
    completed,
    total: checks.length,
    percentage: checks.length ? Math.round((completed / checks.length) * 100) : 0
  };
}

export function planningGateIssues(workflow) {
  const issues = [];
  // "Não" é uma resposta válida e completa (a obra pode não precisar de equipe, equipamentos ou insumos
  // próprios): só falta responder (null) ou responder "Sim" sem detalhar nada continua pendente.
  if (workflow?.teamPlanDefined == null) {
    issues.push('Informar se será necessária equipe própria');
  } else if (workflow.teamPlanDefined === true && !(workflow?.teamDemands || []).length) {
    issues.push('Definir os cargos e as quantidades da equipe');
  }
  // Na Sede, equipamentos, insumos e logística são opcionais: não bloqueiam a preparação.
  if (isHeadquartersWorkflow(workflow)) return issues;
  if (workflow?.equipmentPlanDefined == null) {
    issues.push('Informar se serão necessários equipamentos');
  } else if (workflow.equipmentPlanDefined === true && !(workflow?.equipmentCategoryPlans || []).length) {
    issues.push('Definir os equipamentos necessários');
  }
  if (workflow?.supplyPlanDefined == null) {
    issues.push('Informar se serão necessários insumos');
  } else if (workflow.supplyPlanDefined === true && (!Array.isArray(workflow?.supplyPlan) || !workflow.supplyPlan.length)) {
    issues.push('Definir os insumos e as quantidades necessárias');
  }
  const logistics = workflow?.logisticsPlan && typeof workflow.logisticsPlan === 'object' && !Array.isArray(workflow.logisticsPlan)
    ? workflow.logisticsPlan
    : {};
  if (typeof logistics.vehicleRequired !== 'boolean') issues.push('Informar se será necessário veículo');
  if (logistics.vehicleRequired === true && !(Number(logistics.vehicleQuantity) > 0 && ['CARRO', 'CAMINHAO'].includes(logistics.vehicleType))) {
    issues.push('Detalhar quantidade e tipo dos veículos');
  }
  if (typeof logistics.freightRequired !== 'boolean') issues.push('Informar se será necessário frete');
  if (typeof logistics.lodgingRequired !== 'boolean') issues.push('Informar se será necessária hospedagem');
  if (logistics.lodgingRequired === true) {
    if (!(Number(logistics.lodgingPeopleCount) > 0 && logistics.lodgingExpectedDate)) issues.push('Detalhar pessoas e data prevista da hospedagem');
    if (typeof logistics.lodgingRequested !== 'boolean') issues.push('Informar se a hospedagem já foi solicitada');
    if (logistics.lodgingRequested === true && !logistics.lodgingRequestedAt) issues.push('Informar a data da solicitação da hospedagem');
  }
  return issues;
}

export function allowedProjectWorkflowTransition(current, target, workflow = null) {
  if (current === target) return false;
  return projectWorkflowStageTransitions(current, isHeadquartersWorkflow(workflow)).includes(target);
}

export function projectWorkflowTransitionIssues(workflow, target) {
  if (!allowedProjectWorkflowTransition(workflow.stage, target, workflow)) return ['Transição de etapa não permitida'];
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
  if (target === 'MOBILIZATION' || target === 'EXECUTION') {
    // Sem "Pronto para mobilizar" não há autorização manual: o gate de mobilização sem bloqueios já libera a
    // entrada em Mobilização (ou, na Sede, direto em Execução) e o retorno da Desmobilização para a Execução.
    return projectWorkflowMobilizationGate(workflow).blockers.map(item => `${item.label}: ${item.reason}`);
  }
  return [];
}
