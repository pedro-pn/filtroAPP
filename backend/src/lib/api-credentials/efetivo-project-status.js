import { z } from 'zod';

import { computeProgressForProjects } from '../acompanhamento/avanco.js';
import { getProjectWorkflow } from '../efetivo/project-workflow/service.js';
import { IntegrationApiError } from '../../middleware/api-request-context.js';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(100) }).strict();

export function validateEfetivoProjectStatusRequest(params, query, context) {
  const { id } = paramsSchema.parse(params);
  if (Object.keys(query || {}).length) {
    throw new IntegrationApiError(400, 'UNKNOWN_PARAMETER', 'Esta operação não aceita filtros de consulta.');
  }
  if (!['ALL', 'SELECTED'].includes(context.projectAccessMode)
    || (context.projectAccessMode === 'SELECTED' && !context.projectIds?.has(id))) {
    throw new IntegrationApiError(403, 'PROJECT_NOT_ALLOWED', 'O projeto solicitado não está autorizado.');
  }
  return id;
}

// Contrato do CRM: somente campos operacionais selecionados. O serviço de workflow
// calcula os gates, mas seus dados internos, pessoas e textos livres não saem na API.
export function projectEfetivoStatus({ project, workflow }, progress = {}) {
  const openIssues = (workflow?.issues || []).filter(item => item.status !== 'RESOLVED');
  return {
    projectId: project.id,
    projectCode: project.code,
    workflowStarted: Boolean(workflow),
    stage: workflow?.stage || null,
    workflowVersion: workflow?.version || null,
    plannedMobilizationDate: workflow?.plannedMobilizationDate || null,
    plannedExecutionStartDate: workflow?.plannedExecutionStartDate || null,
    plannedExecutionEndDate: workflow?.plannedExecutionEndDate || null,
    fieldCompletionDate: workflow?.fieldCompletionDate || null,
    demobilizationDate: project.demobilizationDate || null,
    commercialReadiness: workflow?.commercialReadiness?.status || null,
    mobilizationReady: workflow?.mobilizationGate?.ready ?? null,
    closureReady: workflow?.closureGate?.ready ?? null,
    openIssueCount: openIssues.length,
    criticalIssueCount: openIssues.filter(item => item.criticality === 'HIGH').length,
    progressPercent: progress.progressPct ?? null,
    progressMethod: progress.progressMethod ?? null,
    closedAt: workflow?.closedAt ? new Date(workflow.closedAt).toISOString() : null
  };
}

export async function getEfetivoProjectStatus(client, id, context) {
  validateEfetivoProjectStatusRequest({ id }, {}, context);
  const record = await client.project.findFirst({
    where: { id, deletedAt: null, isActive: true },
    select: { id: true }
  });
  if (!record) throw new IntegrationApiError(404, 'NOT_FOUND', 'Projeto não encontrado.');
  const [detail, progressById] = await Promise.all([
    getProjectWorkflow(id, {}, { database: client }),
    computeProgressForProjects([id])
  ]);
  return projectEfetivoStatus(detail, progressById.get(id));
}
