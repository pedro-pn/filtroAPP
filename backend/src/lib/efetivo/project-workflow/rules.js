import {
  PROJECT_WORKFLOW_CHECKLISTS,
  PROJECT_WORKFLOW_CRITICAL_QUESTIONS
} from '../../../../../shared/schemas/project-workflow.js';

function answeredChecklistKeys(workflow, stage) {
  return new Set((workflow.checklists || [])
    .filter(item => item.status === 'DONE' || item.status === 'NOT_APPLICABLE')
    .filter(item => PROJECT_WORKFLOW_CHECKLISTS.some(definition => definition.key === item.key && definition.stage === stage))
    .map(item => item.key));
}

export function incompleteChecklistLabels(workflow, stage) {
  const answered = answeredChecklistKeys(workflow, stage);
  return PROJECT_WORKFLOW_CHECKLISTS
    .filter(item => item.stage === stage && !answered.has(item.key))
    .map(item => item.label);
}

export function handoverGateIssues(workflow) {
  const issues = incompleteChecklistLabels(workflow, 'HANDOVER');
  if (!workflow.leaderUserId) issues.push('Definir o Líder de Projetos');
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
    if (!answerByKey.get(question.key)) continue;
    const issue = issueByQuestion.get(question.key);
    if (!issue?.area || !issue?.ownerName || !issue?.requiredLeadTimeDays || !issue?.dueDate) {
      issues.push(`Encaminhar a pendência: ${question.issueDescription}`);
    }
  }
  return issues;
}

export function allowedProjectWorkflowTransition(current, target) {
  if (current === target) return false;
  const transitions = {
    HANDOVER: [],
    INITIAL_ANALYSIS: ['WAITING_PLANNING', 'MOBILIZATION_PLANNING'],
    WAITING_PLANNING: ['INITIAL_ANALYSIS', 'MOBILIZATION_PLANNING'],
    MOBILIZATION_PLANNING: ['INITIAL_ANALYSIS', 'WAITING_PLANNING']
  };
  return transitions[current]?.includes(target) || false;
}

export function projectWorkflowTransitionIssues(workflow, target) {
  if (!allowedProjectWorkflowTransition(workflow.stage, target)) return ['Transição de etapa não permitida'];
  if (target === 'WAITING_PLANNING' || target === 'MOBILIZATION_PLANNING') {
    if (!workflow.acceptedAt) return ['O Líder de Projetos ainda não aceitou o handover'];
    return analysisGateIssues(workflow);
  }
  return [];
}
