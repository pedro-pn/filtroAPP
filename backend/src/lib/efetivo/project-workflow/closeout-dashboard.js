import { getProjectDetail } from '../../acompanhamento/project-detail.js';
import { efetivoProjectWhere } from '../project-visibility.js';
import { notFound } from '../planning/errors.js';
import { resolvePlanningDatabase } from '../planning/plan-context.js';
import { buildProjectExecutionDashboard } from './execution-dashboard.js';
import { canEditWorkflow } from './service.js';

const RDO_REPORT_TYPES = ['RDO', 'RDO_MAINTENANCE', 'RDO_PRODUCTION'];
const REPORT_TYPES = [...RDO_REPORT_TYPES, 'RTP', 'RLQ', 'RCPU', 'RLM', 'RLF', 'RLI'];

function dateKey(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function currentClientAcceptance(report) {
  return report?.clientReviews?.[0]?.action === 'APPROVED';
}

function publicMeasurement(measurement) {
  const executedAmount = finiteNumber(measurement?.executedAmount);
  const measuredAmount = finiteNumber(measurement?.measuredAmount);
  const approvedAmount = finiteNumber(measurement?.approvedAmount);
  return {
    quantitiesSummary: measurement?.quantitiesSummary || null,
    additionalServicesNote: measurement?.additionalServicesNote || null,
    evidenceNote: measurement?.evidenceNote || null,
    executedAmount,
    measuredAmount,
    approvedAmount,
    preparedAt: dateKey(measurement?.preparedAt),
    sentAt: dateKey(measurement?.sentAt),
    approvedAt: dateKey(measurement?.approvedAt),
    unmeasuredAmount: executedAmount != null && measuredAmount != null ? Math.max(0, executedAmount - measuredAmount) : null,
    pendingApprovalAmount: measuredAmount != null && approvedAmount != null ? Math.max(0, measuredAmount - approvedAmount) : null,
    updatedAt: measurement?.updatedAt || null,
    updatedBy: measurement?.updatedBy || null
  };
}

export function buildProjectCloseoutDashboard({ reports = [], targetData = {}, financial = null, measurement = null, canEdit = false } = {}) {
  const validReports = Array.isArray(reports) ? reports : [];
  const execution = buildProjectExecutionDashboard({ reports: validReports, targetData });
  const rdos = validReports.filter(report => RDO_REPORT_TYPES.includes(report.reportType));
  const technicalRows = validReports.filter(report => !RDO_REPORT_TYPES.includes(report.reportType));
  const technicalReports = execution.technicalReports.map(item => ({
    ...item,
    clientAcceptedCount: technicalRows.filter(report => report.reportType === item.reportType && currentClientAcceptance(report)).length
  }));
  return {
    documentation: {
      rdo: {
        ...execution.rdo,
        clientAcceptedCount: rdos.filter(currentClientAcceptance).length
      },
      technicalReports,
      totalTechnicalIssued: technicalReports.reduce((sum, item) => sum + item.issuedCount, 0),
      totalTechnicalExpected: technicalReports.reduce((sum, item) => sum + item.expectedCount, 0),
      totalClientAccepted: validReports.filter(currentClientAcceptance).length
    },
    financial: {
      originalContractAmount: finiteNumber(financial?.previstoOriginal),
      additionalContractAmount: finiteNumber(financial?.previstoAdicional),
      contractAmount: finiteNumber(financial?.previsto),
      invoicedAmount: finiteNumber(financial?.realizado),
      invoiceCount: finiteNumber(financial?.notas) || 0
    },
    measurement: publicMeasurement(measurement),
    permissions: { canEdit: Boolean(canEdit) }
  };
}

async function loadProjectDetail(projectId, dependency) {
  try {
    return await dependency(projectId, { includeCollaboratorCosts: false, includeAdminOnlyCategories: false });
  } catch {
    return null;
  }
}

export async function getProjectCloseoutDashboard(projectId, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  const project = await database.project.findFirst({
    where: { id: projectId, isActive: true, deletedAt: null, ...efetivoProjectWhere() },
    select: {
      id: true,
      workflow: {
        select: {
          projectId: true,
          stage: true,
          leaderUserId: true,
          executionReportTargets: true,
          measurement: {
            include: { updatedBy: { select: { id: true, name: true } } }
          }
        }
      }
    }
  });
  if (!project) throw notFound('Projeto não encontrado ou indisponível no Efetivo.');
  if (!project.workflow) throw notFound('A gestão deste projeto ainda não foi iniciada.');
  const [detail, reports] = await Promise.all([
    loadProjectDetail(projectId, dependencies.getProjectDetail || getProjectDetail),
    database.report.findMany({
      where: { projectId, deletedAt: null, reportType: { in: REPORT_TYPES } },
      select: {
        id: true,
        reportType: true,
        status: true,
        reportDate: true,
        services: { select: { id: true } },
        attachments: { select: { id: true } },
        clientReviews: { orderBy: { createdAt: 'desc' }, take: 1, select: { action: true } }
      }
    })
  ]);
  return buildProjectCloseoutDashboard({
    reports,
    targetData: project.workflow.executionReportTargets,
    financial: detail?.faturamento,
    measurement: project.workflow.measurement,
    canEdit: canEditWorkflow(project.workflow, context)
  });
}
