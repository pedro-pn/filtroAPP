import { corporateDateKey } from '../../calendar/corporate-calendar.js';
import { notFound } from './errors.js';
import { resolvePlanningDatabase } from './plan-context.js';
import { missionEndDate } from './mission-period.js';

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

export function buildMissionExecutionComparison(mission, reports = [], progress = null) {
  const plannedIds = new Set((mission.allocations || []).filter(item => !item.deletedAt).map(item => item.collaboratorId));
  const observedLinks = reports.flatMap(report => report.collaborators || []);
  const observedIds = new Set(observedLinks.map(item => item.collaboratorId).filter(Boolean));
  const reportDates = reports.map(item => corporateDateKey(item.reportDate)).sort();
  const workforceConflicts = reports.flatMap(report => report.specialConditions?.workforceContext?.conflicts || []);
  const plannedCollaborators = (mission.allocations || []).filter(item => !item.deletedAt).map(item => ({
    id: item.collaboratorId,
    name: item.collaborator?.name || '',
    role: item.jobRoleNameSnapshot
  }));
  const observedCollaborators = [...new Map(observedLinks.map(item => [item.collaboratorId, {
    id: item.collaboratorId,
    name: item.collaborator?.name || '',
    role: item.roleNameSnapshot || item.collaborator?.jobRole?.name || ''
  }])).values()];
  const totalWorkedMinutes = sum(reports.map(item => Number(item.daytimeWorkedMinutes || 0) + Number(item.nighttimeWorkedMinutes || 0)));
  const totalOvertimeMinutes = sum(reports.map(item => item.totalOvertimeMinutes));
  const latestUpdatedAt = reports.map(item => item.updatedAt).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null;
  const progressPct = progress?.progressPct ?? progress?.pct ?? progress?.percentage ?? null;
  const suggestedStage = reports.length
    ? (progressPct != null && Number(progressPct) >= 100 ? 'FINISHED' : 'EXECUTION')
    : mission.stage;
  return {
    missionId: mission.id,
    projectId: mission.projectId,
    freshness: { observedUpdatedAt: latestUpdatedAt, missionUpdatedAt: mission.updatedAt },
    planned: {
      dates: {
        mobilizationDate: corporateDateKey(mission.mobilizationDate),
        executionStartDate: corporateDateKey(mission.executionStartDate),
        executionEndDate: corporateDateKey(mission.executionEndDate),
        returnDate: mission.returnDate ? corporateDateKey(mission.returnDate) : null
      },
      collaborators: plannedCollaborators
    },
    observed: {
      firstReportDate: reportDates[0] || null,
      lastReportDate: reportDates.at(-1) || null,
      reportCount: reports.length,
      collaborators: observedCollaborators,
      totalWorkedMinutes,
      totalOvertimeMinutes,
      progressPct
    },
    divergences: {
      missingPlannedCollaboratorIds: [...plannedIds].filter(id => !observedIds.has(id)),
      unplannedObservedCollaboratorIds: [...observedIds].filter(id => !plannedIds.has(id)),
      executionStartedOnDifferentDate: Boolean(reportDates[0] && reportDates[0] !== corporateDateKey(mission.executionStartDate)),
      workforceConflicts
    },
    suggestion: suggestedStage === mission.stage ? null : {
      stage: suggestedStage,
      reason: suggestedStage === 'FINISHED' ? 'O avanço observado atingiu 100%.' : 'Há RDOs observados para a missão.'
    }
  };
}

export async function getMissionExecutionComparison(missionId, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  const mission = await database.efetivoMissionPlan.findFirst({
    where: { id: missionId, deletedAt: null, plan: { kind: 'OFFICIAL', status: 'ACTIVE' } },
    include: {
      allocations: {
        where: { deletedAt: null },
        include: { collaborator: { select: { id: true, name: true } } }
      }
    }
  });
  if (!mission) throw notFound('Missão oficial não encontrada.');
  const reports = await database.report.findMany({
    where: {
      projectId: mission.projectId,
      deletedAt: null,
      reportType: 'RDO',
      reportDate: { gte: mission.mobilizationDate, lte: new Date(`${missionEndDate(mission)}T00:00:00.000Z`) }
    },
    include: {
      collaborators: {
        include: { collaborator: { include: { jobRole: true } }, jobRoleSnapshot: true }
      }
    },
    orderBy: { reportDate: 'asc' }
  });
  const progress = dependencies.loadProgress ? await dependencies.loadProgress(mission.projectId) : null;
  return buildMissionExecutionComparison(mission, reports, progress);
}
