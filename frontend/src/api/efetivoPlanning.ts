import { apiClient, type ApiClientError } from './client';

export type DateOnly = string;
export type MissionScheduleStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
export type MissionStage = 'STANDBY' | 'MOBILIZATION' | 'EXECUTION' | 'FINAL_MEASUREMENT' | 'FINISHED';
export type AbsenceType = 'FERIAS' | 'FOLGA' | 'AFASTAMENTO';
export type CollaboratorPlanningStatus = 'ALLOCATED' | 'UNAVAILABLE' | 'FREE' | 'OUTSIDE_EMPLOYMENT';

export interface PlanningConflict {
  code: string;
  collaboratorId?: string | null;
  collaboratorName?: string;
  startDate: DateOnly;
  endDate: DateOnly;
  sourceType: string;
  sourceId: string;
  entityPath?: string | null;
}

export interface ProjectOption {
  id: string;
  code: string;
  name: string;
  clientName: string | null;
  location: string | null;
  mobilizationDate: string | null;
  demobilizationDate: string | null;
}

export interface PendingMissionProject extends ProjectOption {
  startDate: string | null;
  registrationPending: boolean;
}

export interface PlanningJobRole {
  id: string;
  name: string;
  isOperational: boolean;
  calendarColor: string;
  continuousWorkLimitDays: number | null;
  order?: number;
}

export interface PlanningCoordinator {
  id: string;
  name: string;
  collaborator: { id: string; name: string; role: string; isActive: boolean } | null;
}

export interface RoleCapacity {
  jobRoleId: string;
  jobRoleName: string;
  calendarColor?: string;
  active: number;
  allocated: number;
  unavailable: number;
  free: number;
  demand: number;
  deficit: number;
  plannedUtilization90d?: number | null;
  plannedHires?: number;
  projectedFree?: number;
  projectedDeficit?: number;
  projectedUtilization90d?: number | null;
}

export interface MissionDemand {
  id?: string;
  jobRoleId: string;
  requiredCount: number;
  jobRole?: Pick<PlanningJobRole, 'id' | 'name' | 'calendarColor'>;
}

export interface MobilizationCycle {
  id: string;
  mobilizationDate: DateOnly;
  demobilizationDate: DateOnly | null;
}

export interface MissionAllocation {
  id: string;
  collaboratorId: string;
  jobRoleId: string;
  mobilizationDate: DateOnly | null;
  demobilizationDate: DateOnly | null;
  allowMissionOverlap: boolean;
  cycles?: MobilizationCycle[];
  collaborator?: { id: string; name: string; isActive?: boolean; role: string; jobRoleId: string | null };
  jobRole?: { id: string; name: string };
}

export interface EligibleMissionCollaborator {
  id: string;
  name: string;
  jobRoleId: string;
  admissionDate: DateOnly | null;
  missionConflicts: PlanningConflict[];
  requiresMissionOverlapConfirmation: boolean;
  isActive: boolean;
  requiresInactiveConfirmation: boolean;
}

export interface PlanningMission {
  id: string;
  planId: string;
  projectId: string;
  project: ProjectOption;
  scheduleStatus: MissionScheduleStatus;
  stage: MissionStage;
  headquartersResponsibleUserId: string;
  headquartersResponsibleName: string;
  headquartersResponsibleRole: string;
  headquartersResponsibleCollaboratorId: string | null;
  mobilizationDate: DateOnly;
  executionStartDate: DateOnly;
  executionEndDate: DateOnly;
  returnDate: DateOnly | null;
  version: number;
  kanbanOrder: number;
  cycles?: MobilizationCycle[];
  demands: MissionDemand[];
  allocations: MissionAllocation[];
}

export interface MissionExecutionComparison {
  missionId: string;
  projectId: string;
  freshness: { observedUpdatedAt: string | null; missionUpdatedAt: string | null };
  planned: {
    dates: { mobilizationDate: DateOnly; executionStartDate: DateOnly; executionEndDate: DateOnly; returnDate: DateOnly | null };
    collaborators: Array<{ id: string; name: string; role: string }>;
  };
  observed: {
    firstReportDate: DateOnly | null;
    lastReportDate: DateOnly | null;
    reportCount: number;
    collaborators: Array<{ id: string; name: string; role: string }>;
    totalWorkedMinutes: number;
    totalOvertimeMinutes: number;
    progressPct: number | null;
  };
  divergences: {
    missingPlannedCollaboratorIds: string[];
    unplannedObservedCollaboratorIds: string[];
    executionStartedOnDifferentDate: boolean;
    workforceConflicts: Array<{ code?: string; collaboratorId?: string }>;
  };
  suggestion: { stage: MissionStage; reason: string } | null;
}

export interface MissionInput {
  planId?: string;
  projectId: string;
  scheduleStatus: Exclude<MissionScheduleStatus, 'DRAFT'>;
  headquartersResponsibleUserId: string;
  mobilizationDate: DateOnly;
  executionStartDate: DateOnly;
  executionEndDate: DateOnly;
  returnDate?: DateOnly | null;
  collaboratorIds: string[];
  allocationPeriods: Array<{
    collaboratorId: string;
    mobilizationDate: DateOnly;
    demobilizationDate: DateOnly;
  }>;
  confirmedMissionOverlapCollaboratorIds?: string[];
  confirmedInactiveCollaboratorIds?: string[];
}

export interface ContinuousStayAlert {
  collaboratorId: string;
  collaboratorName: string;
  jobRoleName: string;
  missionIds: string[];
  missions?: Array<{ id: string; code: string; name: string }>;
  projectedDays: number;
  limitDays: number;
  restDueDate: DateOnly;
}

export interface PlanningOverview {
  date: DateOnly;
  plan: { id: string; revision: number; calendarRevision: number };
  totals: RoleCapacity;
  byRole: RoleCapacity[];
  upcomingMobilizations: PlanningMission[];
  plannedUtilization90d: number | null;
  projectedUtilization90d: number | null;
  target: number;
  continuousStayAlerts: ContinuousStayAlert[];
  plannedHires: Array<{ id: string; quantity: number; availableFrom: DateOnly; jobRole: { id: string; name: string } }>;
}

export interface VacationAlert {
  type: 'OVERDUE' | 'SCHEDULE';
  label: string;
  acquisitionEnd: DateOnly;
  concessionStart: DateOnly;
  concessionDeadline: DateOnly;
}

export interface PlanningCollaborator {
  id: string;
  name: string;
  role: string;
  jobRoleId: string | null;
  admissionDate: DateOnly | null;
  terminationDate: DateOnly | null;
  isActive: boolean;
  status: CollaboratorPlanningStatus;
  plannedUtilization90d: number | null;
  vacationAlert: VacationAlert | null;
}

export interface CollaboratorInput {
  name: string;
  jobRoleId: string;
  jobRoleEffectiveDate?: DateOnly;
  admissionDate: DateOnly;
  terminationDate?: DateOnly | null;
  note?: string | null;
}

export interface PlanningAbsence {
  id: string;
  version: number;
  collaboratorId: string;
  type: AbsenceType;
  startDate: DateOnly;
  endDate: DateOnly;
  note: string | null;
  collaborator: { id: string; name: string; role: string; jobRoleId: string | null };
}

export interface CalendarEvent {
  id: string;
  type: 'MISSION' | AbsenceType;
  title: string;
  startDate: DateOnly;
  endDate: DateOnly;
  jobRoleIds: string[];
  entityPath: string;
  demand?: number;
  allocated?: number;
  people?: Array<{ id: string; name: string }>;
}

export interface PlanningScenario {
  id: string;
  kind: 'SCENARIO';
  status: 'DRAFT' | 'APPLIED' | 'DISCARDED' | 'SUPERSEDED';
  name: string;
  objective: string | null;
  revision: number;
  baseOfficialRevision: number;
  appliedPlanId: string | null;
  createdAt: string;
  _count?: { missions: number; plannedHires: number };
}

export interface Holiday {
  id: string;
  holidayDate: DateOnly;
  name: string;
}

export interface AuditEvent {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  actorName: string | null;
  createdAt: string;
}

const base = '/efetivo/planning';

export function planningErrorConflicts(error: unknown) {
  return (error as ApiClientError)?.conflicts as PlanningConflict[] | undefined;
}

export async function listPlanningProjects(search = '') {
  return (await apiClient.get<ProjectOption[]>(`${base}/projects`, { params: search ? { search } : {} })).data;
}
export async function listPlanningJobRoles() {
  return (await apiClient.get<PlanningJobRole[]>(`${base}/job-roles`)).data;
}
export async function listPlanningCoordinators() {
  return (await apiClient.get<PlanningCoordinator[]>(`${base}/coordinators`)).data;
}
export async function getPlanningOverview(date: DateOnly, jobRoleId?: string) {
  return (await apiClient.get<PlanningOverview>(`${base}/overview`, { params: { date, jobRoleId } })).data;
}
export async function getPlanningCalendar(startDate: DateOnly, endDate: DateOnly, jobRoleId?: string) {
  return (await apiClient.get<{ events: CalendarEvent[]; conflicts: PlanningConflict[] }>(`${base}/calendar`, { params: { startDate, endDate, jobRoleId } })).data;
}
export async function listPlanningCollaborators(params: { date: DateOnly; jobRoleId?: string; search?: string; includeInactive?: boolean }) {
  return (await apiClient.get<PlanningCollaborator[]>(`${base}/collaborators`, { params })).data;
}
export async function createPlanningCollaborator(payload: CollaboratorInput) {
  return (await apiClient.post<PlanningCollaborator>(`${base}/collaborators`, payload)).data;
}
export async function updatePlanningCollaborator(id: string, payload: CollaboratorInput) {
  return (await apiClient.patch<PlanningCollaborator>(`${base}/collaborators/${encodeURIComponent(id)}`, payload)).data;
}
export async function listPlanningAbsences(params: { collaboratorId?: string; startDate?: string; endDate?: string } = {}) {
  return (await apiClient.get<PlanningAbsence[]>('/workforce/absences', {
    params: { collaboratorId: params.collaboratorId, from: params.startDate, to: params.endDate }
  })).data;
}
export async function createPlanningAbsence(payload: Omit<PlanningAbsence, 'id' | 'version' | 'collaborator'>) {
  return (await apiClient.post<{ absence: PlanningAbsence; affectedMissionIds: string[]; calendarRevision: number }>('/workforce/absences', payload)).data;
}
export async function updatePlanningAbsence(id: string, version: number, payload: Partial<Omit<PlanningAbsence, 'id' | 'version' | 'collaborator' | 'collaboratorId'>>) {
  return (await apiClient.patch<{ absence: PlanningAbsence; affectedMissionIds: string[]; calendarRevision: number }>(`/workforce/absences/${encodeURIComponent(id)}`, payload, { headers: { 'If-Match-Version': version } })).data;
}
export async function deletePlanningAbsence(id: string, version: number) {
  await apiClient.delete(`/workforce/absences/${encodeURIComponent(id)}`, { headers: { 'If-Match-Version': version } });
}
export async function listPlanningMissions(params: { planId?: string; status?: MissionScheduleStatus; stage?: MissionStage } = {}) {
  return (await apiClient.get<PlanningMission[]>(`${base}/missions`, { params })).data;
}
export async function getMissionExecutionComparison(missionId: string) {
  return (await apiClient.get<MissionExecutionComparison>(`${base}/missions/${encodeURIComponent(missionId)}/execution`)).data;
}
export async function listPendingMissionProjects(params: { planId?: string } = {}) {
  return (await apiClient.get<PendingMissionProject[]>(`${base}/missions/pending`, { params })).data;
}
export async function createPlanningMission(payload: MissionInput) {
  return (await apiClient.post<PlanningMission>(`${base}/missions`, payload)).data;
}
export async function updatePlanningMission(id: string, version: number, payload: MissionInput) {
  return (await apiClient.patch<PlanningMission>(`${base}/missions/${encodeURIComponent(id)}`, payload, { headers: { 'If-Match-Version': version } })).data;
}
export async function deletePlanningMission(id: string) {
  await apiClient.delete(`${base}/missions/${encodeURIComponent(id)}`);
}
export async function listEligibleCollaborators(missionId: string, jobRoleId: string, period: { mobilizationDate?: DateOnly; demobilizationDate?: DateOnly; includeInactive?: boolean } = {}) {
  return (await apiClient.get<EligibleMissionCollaborator[]>(`${base}/missions/${encodeURIComponent(missionId)}/eligible-collaborators`, { params: { jobRoleId, ...period } })).data;
}
export async function addMissionAllocation(missionId: string, payload: { collaboratorId: string; jobRoleId: string; mobilizationDate?: DateOnly; demobilizationDate?: DateOnly; allowMissionOverlap?: boolean; allowInactiveCollaborator?: boolean }) {
  return (await apiClient.post<MissionAllocation>(`${base}/missions/${encodeURIComponent(missionId)}/allocations`, payload)).data;
}
export async function updateMissionAllocationPeriod(missionId: string, allocationId: string, payload: { mobilizationDate: DateOnly; demobilizationDate: DateOnly; allowMissionOverlap?: boolean; allowInactiveCollaborator?: boolean }) {
  return (await apiClient.patch<MissionAllocation>(`${base}/missions/${encodeURIComponent(missionId)}/allocations/${encodeURIComponent(allocationId)}`, payload)).data;
}
export async function removeMissionAllocation(missionId: string, allocationId: string) {
  await apiClient.delete(`${base}/missions/${encodeURIComponent(missionId)}/allocations/${encodeURIComponent(allocationId)}`);
}
export async function createMissionCycle(missionId: string, payload: { mobilizationDate: DateOnly; demobilizationDate?: DateOnly | null; allowInactiveCollaborator?: boolean }) {
  return (await apiClient.post<MobilizationCycle>(`${base}/missions/${encodeURIComponent(missionId)}/cycles`, payload)).data;
}
export async function updateMissionCycle(missionId: string, cycleId: string, payload: { mobilizationDate: DateOnly; demobilizationDate?: DateOnly | null; allowInactiveCollaborator?: boolean }) {
  return (await apiClient.patch<MobilizationCycle>(`${base}/missions/${encodeURIComponent(missionId)}/cycles/${encodeURIComponent(cycleId)}`, payload)).data;
}
export async function initializeMissionAllocationCycles(missionId: string, allocationId: string) {
  return (await apiClient.post<MobilizationCycle[]>(`${base}/missions/${encodeURIComponent(missionId)}/allocations/${encodeURIComponent(allocationId)}/cycles/inherit`)).data;
}
export async function createMissionAllocationCycle(missionId: string, allocationId: string, payload: { mobilizationDate: DateOnly; demobilizationDate?: DateOnly | null; allowInactiveCollaborator?: boolean }) {
  return (await apiClient.post<MobilizationCycle>(`${base}/missions/${encodeURIComponent(missionId)}/allocations/${encodeURIComponent(allocationId)}/cycles`, payload)).data;
}
export async function updateMissionAllocationCycle(missionId: string, allocationId: string, cycleId: string, payload: { mobilizationDate: DateOnly; demobilizationDate?: DateOnly | null; allowInactiveCollaborator?: boolean }) {
  return (await apiClient.patch<MobilizationCycle>(`${base}/missions/${encodeURIComponent(missionId)}/allocations/${encodeURIComponent(allocationId)}/cycles/${encodeURIComponent(cycleId)}`, payload)).data;
}
export async function deleteMissionAllocationCycle(missionId: string, allocationId: string, cycleId: string) {
  await apiClient.delete(`${base}/missions/${encodeURIComponent(missionId)}/allocations/${encodeURIComponent(allocationId)}/cycles/${encodeURIComponent(cycleId)}`);
}
export async function autoAllocateMission(missionId: string) {
  return (await apiClient.post<{ created: MissionAllocation[]; remainingDeficits: Array<{ jobRoleId: string; jobRoleName: string; deficit: number }> }>(`${base}/missions/${encodeURIComponent(missionId)}/auto-allocate`)).data;
}
export async function movePlanningMission(id: string, version: number, stage: MissionStage, order: number, returnDate?: DateOnly | null) {
  return (await apiClient.patch<PlanningMission>(`${base}/missions/${encodeURIComponent(id)}/stage`, {
    stage,
    order,
    ...(returnDate !== undefined ? { returnDate } : {})
  }, { headers: { 'If-Match-Version': version } })).data;
}
export async function listPlanningScenarios() {
  return (await apiClient.get<PlanningScenario[]>(`${base}/scenarios`)).data;
}
export interface ScenarioInput {
  name: string;
  objective?: string | null;
  initialHire?: { jobRoleId: string; quantity: number; availableFrom: string } | null;
}
export async function createPlanningScenario(payload: ScenarioInput) {
  return (await apiClient.post<PlanningScenario>(`${base}/scenarios`, payload)).data;
}
export async function comparePlanningScenario(id: string, date: string, jobRoleId?: string) {
  return (await apiClient.get<{ official: PlanningOverview; scenario: PlanningOverview & { projectedHireCapacity: number }; isStale: boolean }>(`${base}/scenarios/${encodeURIComponent(id)}/compare`, { params: { date, jobRoleId } })).data;
}
export async function savePlanningScenarioHire(id: string, payload: { jobRoleId: string; quantity: number; availableFrom: string }) {
  return (await apiClient.post(`${base}/scenarios/${encodeURIComponent(id)}/hires`, payload)).data;
}
export async function applyPlanningScenario(id: string) {
  return (await apiClient.post<{ scenarioId: string; officialPlanId: string; revision: number; idempotentRetry: boolean }>(`${base}/scenarios/${encodeURIComponent(id)}/apply`)).data;
}
export async function discardPlanningScenario(id: string) {
  return (await apiClient.post<PlanningScenario>(`${base}/scenarios/${encodeURIComponent(id)}/discard`)).data;
}
export async function listPlanningHolidays() {
  return (await apiClient.get<Holiday[]>(`${base}/admin/holidays`)).data;
}
export async function savePlanningHoliday(payload: { holidayDate: string; name: string }, id?: string) {
  return id
    ? (await apiClient.patch<Holiday>(`${base}/admin/holidays/${encodeURIComponent(id)}`, payload)).data
    : (await apiClient.post<Holiday>(`${base}/admin/holidays`, payload)).data;
}
export async function deletePlanningHoliday(id: string) {
  await apiClient.delete(`${base}/admin/holidays/${encodeURIComponent(id)}`);
}
export async function updatePlanningJobRole(id: string, payload: Partial<Pick<PlanningJobRole, 'isOperational' | 'calendarColor' | 'continuousWorkLimitDays'>>) {
  return (await apiClient.patch<PlanningJobRole>(`${base}/admin/job-roles/${encodeURIComponent(id)}`, payload)).data;
}
export async function getPlanningSettings() {
  return (await apiClient.get<{ plannedUtilizationTarget: number }>(`${base}/admin/settings`)).data;
}
export async function updatePlanningSettings(plannedUtilizationTarget: number) {
  return (await apiClient.patch(`${base}/admin/settings`, { plannedUtilizationTarget })).data;
}
export async function getPlanningActivity(cursor?: string) {
  return (await apiClient.get<{ items: AuditEvent[]; nextCursor: string | null }>(`${base}/admin/activity`, { params: { cursor } })).data;
}
export async function listEfetivoRoleUsers() {
  return (await apiClient.get<Array<{ id: string; name: string; accountType: string; moduleRoles: Array<{ role: string }> }>>(`${base}/admin/users`)).data;
}
