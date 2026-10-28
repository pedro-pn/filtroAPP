import { resource } from './operational-resource-definition.js';
import { efetivoProjectWhere } from '../efetivo/project-visibility.js';

const personSelect = { select: { id: true, name: true, email: true } };

export const OMNI_RESOURCES = Object.freeze([
  resource('Project', '/projetos/responsaveis', 'projetos.responsaveis.read', 'Responsáveis dos projetos — identidade e e-mail corporativo', 'projects-clients', {}, {
    operationId: 'operational.ProjectResponsible.list', openApiOperationId: 'listIntegrationProjectResponsible',
    sensitivity: 'PERSONAL', projectPolicy: 'SELF', timestampField: null, keyFields: ['projectId', 'role'],
    collectionKind: 'PROJECT_RESPONSIBLES', where: { deletedAt: null },
    projectNotice: 'Uma linha por projeto autorizado e papel. Somente e-mail corporativo @filtrovali.com.br; reconcilie periodicamente alterações de pessoas e remoções.',
    excludedFields: ['telefone', 'CPF', 'username', 'papéis do hub', 'dados de cliente', 'e-mail pessoal', 'passwordHash', 'tokens'],
    queryParams: ['limit', 'cursor', 'updatedSince', 'snapshotAt', 'projectCode', 'projectId'],
    derivedFields: { projectId: 'string', projectCode: 'string', role: 'string', userId: 'string?', collaboratorId: 'string?', name: 'string', email: 'string?', updatedAt: 'datetime' },
    select: { id: true, code: true, updatedAt: true, operatorId: true,
      operator: { select: { id: true, name: true, user: personSelect } },
      workflow: { select: { updatedAt: true, leader: personSelect, planner: personSelect } } }
  }),
  resource('Project', '/efetivo/projetos/status', 'efetivo.projetos.status.read', 'Situação operacional dos projetos — coleção completa', 'workforce-planning', {}, {
    operationId: 'efetivo.projects.status.list', openApiOperationId: 'listIntegrationEfetivoProjectStatus',
    projectPolicy: 'SELF', timestampField: null, snapshotField: 'createdAt', collectionKind: 'PROJECT_STATUS',
    where: efetivoProjectWhere(), filterFields: ['stage'],
    projectNotice: 'Resumo de projetos elegíveis no Efetivo. Leitura completa: o avanço de RDO não possui watermark confiável; updatedSince não é aceito.',
    queryParams: ['limit', 'cursor', 'snapshotAt', 'projectCode', 'projectId', 'active', 'stage'],
    derivedFields: {
      projectId: 'string', projectCode: 'string', workflowStarted: 'boolean', stage: 'string?', workflowVersion: 'integer?',
      plannedMobilizationDate: 'string?', plannedExecutionStartDate: 'string?', plannedExecutionEndDate: 'string?',
      fieldCompletionDate: 'string?', demobilizationDate: 'string?', commercialReadiness: 'string?',
      mobilizationReady: 'boolean?', closureReady: 'boolean?', openIssueCount: 'integer', criticalIssueCount: 'integer',
      progressPercent: 'number?', progressMethod: 'string?', closedAt: 'datetime?',
      commercialExpectedMobilizationDate: 'string?', commercialExpectedStartDate: 'string?',
      commercialExpectedDurationDays: 'integer?', actualMobilizationDate: 'string?'
    },
    select: { id: true }
  })
]);
