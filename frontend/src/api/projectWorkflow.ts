import { apiClient, type ApiClientError } from './client';
import type { ProjectDocumentRequirementSummary } from './projectDocuments';

export type ProjectWorkflowStage = 'HANDOVER' | 'INITIAL_ANALYSIS' | 'WAITING_PLANNING' | 'MOBILIZATION_PLANNING' | 'PREPARATION' | 'READY_TO_MOBILIZE' | 'MOBILIZATION' | 'EXECUTION' | 'DEMOBILIZATION' | 'POST_JOB' | 'FINAL_MEASUREMENT' | 'FINISHED';
export type ProjectWorkflowChecklistStatus = 'PENDING' | 'DONE' | 'NOT_APPLICABLE';
export type ProjectWorkflowTeamMemberCheckKey = 'NOTIFIED' | 'DOCUMENTS_CHECKED' | 'EXAMS_RELEASED' | 'TRAININGS_RELEASED';
export type ProjectWorkflowPreparationItemType = 'EQUIPMENT' | 'MATERIAL';
export type ProjectWorkflowPreparationItemCheckKey = 'TESTED' | 'ACCESSORIES_SEPARATED' | 'SEPARATED';
export type ProjectWorkflowClientReleaseKey = 'CUSTOMER_REGISTRATION' | 'DOCUMENTS_SENT' | 'INTEGRATION_REQUEST';
export type ProjectWorkflowIssueStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
export type ProjectWorkflowCriticality = 'HIGH' | 'MEDIUM' | 'LOW';
export type ProjectWorkflowCommercialFactStatus = 'PENDING' | 'CONFIRMED' | 'NOT_APPLICABLE';
export type ProjectWorkflowCommercialFactSource = 'MANUAL' | 'CRM';
export type ProjectWorkflowDocumentationType = 'DOCUMENT' | 'EXAM' | 'TRAINING' | 'CERTIFICATION';
export type ProjectWorkflowDocumentationStatus = 'PENDING' | 'REQUESTED' | 'CONFIRMED';
export type ProjectExecutionReportType = 'RTP' | 'RLQ' | 'RLR' | 'RCPU' | 'RLM' | 'RLF' | 'RLI';
export type ProjectExecutionDeviationCategory = 'PRAZO' | 'ESCOPO' | 'CLIENTE' | 'EQUIPAMENTO' | 'PESSOAL' | 'MATERIAL' | 'SEGURANCA' | 'QUALIDADE' | 'COMERCIAL';
export type ProjectExecutionImpact = 'ALTO' | 'MEDIO' | 'BAIXO';
export type ProjectExecutionDeviationStatus = 'ABERTO' | 'EM_TRIAGEM' | 'EM_OBSERVACAO' | 'EM_ACAO' | 'FECHADO' | 'DIVULGADO';
export type ProjectWorkflowChecklistSection = 'INITIAL_ANALYSIS' | 'D30_TEAM' | 'D30_EQUIPMENT' | 'D30_MATERIALS' | 'D30_LOGISTICS' | 'D15_TEAM' | 'D15_CLIENT' | 'D15_EQUIPMENT' | 'D15_MATERIALS' | 'D15_PRE_JOB' | 'D15_TRAVEL' | 'D15_QSMS' | 'DEMOBILIZATION_FIELD' | 'DEMOBILIZATION_LOGISTICS' | 'DEMOBILIZATION_ASSETS' | 'POST_JOB_FEEDBACK' | 'POST_JOB_LEARNING' | 'CLOSEOUT_DOCUMENTATION' | 'CLOSEOUT_MEASUREMENT' | 'FINAL_CLOSEOUT';

export interface ProjectWorkflowPermissions {
  canInitialize: boolean;
  canEdit: boolean;
  canReopen: boolean;
  canAccept: boolean;
  canChangeLeader: boolean;
  canEditCommercial: boolean;
  canEditTeamPlanning: boolean;
  canEditEquipmentPlanning: boolean;
  canEditSupplyPlanning: boolean;
  canEditLogisticsPlanning: boolean;
  canAuthorizeMobilization: boolean;
}

export interface ProjectOperationalMissionSummary {
  id: string;
  stage: 'STANDBY' | 'MOBILIZATION' | 'EXECUTION' | 'FINAL_MEASUREMENT' | 'FINISHED';
  scheduleStatus: 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
  version: number;
  kanbanOrder: number;
  mobilizationDate: string;
  executionStartDate: string;
  executionEndDate: string;
  returnDate: string | null;
  headquartersResponsibleName: string;
  headquartersResponsibleRole: string;
  headquartersResponsibleCollaboratorId: string | null;
  participantCount: number;
  allocations: Array<{
    id: string;
    collaboratorId: string;
    jobRoleId: string;
    collaborator: { id: string; name: string; isActive: boolean; role: string } | null;
    jobRole: { id: string; name: string } | null;
  }>;
}

export interface ProjectWorkflowProject {
  id: string;
  code: string;
  name: string;
  clientName: string;
  clientEmailPrimary?: string;
  location: string;
  mobilizationDate?: string | null;
  demobilizationDate?: string | null;
  operationalMission?: ProjectOperationalMissionSummary | null;
}

export interface ProjectWorkflowMilestones {
  daysUntilMobilization: number | null;
  items: Array<{ key: string; label: string; days: number; date: string; due: boolean }>;
  dueMilestones: string[];
  nextMilestone: { key: string; label: string; days: number; date: string; due: boolean } | null;
  d30Date: string | null;
  d30Due: boolean;
}

export interface ProjectWorkflowChecklist {
  id?: string;
  key: string;
  stage: ProjectWorkflowStage | null;
  section: ProjectWorkflowChecklistSection;
  areaRoles: string[];
  label: string;
  status: ProjectWorkflowChecklistStatus;
  note: string | null;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
  canEdit: boolean;
}

export interface ProjectWorkflowTeamPreparation {
  defined: boolean;
  members: Array<{
    allocationId: string;
    collaboratorId: string;
    name: string;
    role: string;
    checks: Array<{
      key: ProjectWorkflowTeamMemberCheckKey;
      label: string;
      status: 'PENDING' | 'DONE';
      source: 'MANUAL' | 'EXTERNAL';
      sourceRecordId: string | null;
      sourceUpdatedAt: string | null;
      updatedAt: string | null;
      updatedBy: { id: string; name: string } | null;
      canEdit: boolean;
    }>;
  }>;
}

export interface ProjectWorkflowClientReleases {
  attendance: {
    date: string | null;
    confirmed: boolean;
    confirmedAt: string | null;
    source: 'MANUAL' | 'EXTERNAL';
    updatedAt: string | null;
    updatedBy: { id: string; name: string } | null;
    canEdit: boolean;
  };
  items: Array<{
    key: ProjectWorkflowClientReleaseKey;
    label: string;
    requested: boolean;
    requestedAt: string | null;
    requestedTo: string | null;
    completed: boolean;
    completedAt: string | null;
    source: 'MANUAL' | 'EXTERNAL';
    sourceRecordId: string | null;
    sourceUpdatedAt: string | null;
    updatedAt: string | null;
    updatedBy: { id: string; name: string } | null;
    canEdit: boolean;
  }>;
}

export interface ProjectWorkflowDocumentationReadiness {
  status: 'OK' | 'IN_PROGRESS' | 'CRITICAL';
  completed: number;
  total: number;
  blockers: Array<{ key: string; label: string; reason: string }>;
}

export interface ProjectWorkflowDocumentationHistory {
  id: string;
  changes: {
    before: null | { name: string; status: ProjectWorkflowDocumentationStatus; requestedAt: string | null; confirmedAt: string | null; archivedAt: string | null };
    after: { name: string; status: ProjectWorkflowDocumentationStatus; requestedAt: string | null; confirmedAt: string | null; archivedAt: string | null };
  };
  createdAt: string;
  actor: { id: string; name: string } | null;
}

export interface ProjectWorkflowDocumentationRequirement {
  id: string;
  name: string;
  status: ProjectWorkflowDocumentationStatus;
  requestedAt: string | null;
  confirmedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; name: string } | null;
  updatedBy: { id: string; name: string } | null;
  history: ProjectWorkflowDocumentationHistory[];
}

export interface ProjectWorkflowDocumentationCategory {
  id: string | null;
  type: ProjectWorkflowDocumentationType;
  label: string;
  singularLabel: string;
  nameLabel: string;
  required: boolean | null;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
  requirements: ProjectWorkflowDocumentationRequirement[];
}

export interface ProjectWorkflowPlanningReadiness {
  completed: number;
  total: number;
  percentage: number;
  sections: Array<{ key: ProjectWorkflowChecklistSection; completed: number; total: number; percentage: number }>;
}

export interface ProjectWorkflowRolePlanningOption {
  id: string;
  name: string;
  calendarColor: string;
  order: number;
  activeCount: number;
  availableCount: number;
}

export interface ProjectWorkflowTeamDemand {
  id: string;
  jobRoleId: string;
  jobRoleName: string;
  calendarColor: string;
  requiredCount: number;
  availableCount: number;
  hiringNeed: number;
}

export interface ProjectWorkflowEquipmentAssignment {
  expectedReturnDate: string | null;
}

export interface ProjectWorkflowEquipmentPlanningItem {
  id: string;
  code: string;
  name: string;
  availabilityStatus: 'AVAILABLE' | 'EXPECTED_RETURN' | 'ALLOCATED';
  availableAtMobilization: boolean;
  assignments: ProjectWorkflowEquipmentAssignment[];
  calibration: {
    required: boolean;
    status: 'NOT_REQUIRED' | 'MISSING' | 'VALID' | 'EXPIRED';
    expiresAt: string | null;
    valid: boolean;
  };
  maintenance: {
    status: 'UPCOMING' | 'DUE_TODAY' | 'OVERDUE' | 'NO_HISTORY' | 'UNCONFIGURED';
    lastMaintenanceDate: string | null;
    nextMaintenanceDate: string | null;
    valid: boolean;
  };
}

export interface ProjectWorkflowEquipmentPlanningCategory {
  id: string;
  name: string;
  order: number;
  equipment: ProjectWorkflowEquipmentPlanningItem[];
  totalCount: number;
  availableCount: number;
}

export interface ProjectWorkflowPreparationItemCheck {
  key: ProjectWorkflowPreparationItemCheckKey;
  label: string;
  status: 'PENDING' | 'DONE';
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
  canEdit: boolean;
}

export interface ProjectWorkflowPreparationEquipmentItem extends Omit<ProjectWorkflowEquipmentPlanningItem, 'code' | 'availabilityStatus' | 'availableAtMobilization' | 'calibration' | 'maintenance'> {
  code: string | null;
  categoryId: string;
  categoryName: string;
  availabilityStatus: ProjectWorkflowEquipmentPlanningItem['availabilityStatus'] | null;
  availableAtMobilization: boolean | null;
  calibration: ProjectWorkflowEquipmentPlanningItem['calibration'] | null;
  maintenance: ProjectWorkflowEquipmentPlanningItem['maintenance'] | null;
  checks: ProjectWorkflowPreparationItemCheck[];
}

export type ProjectWorkflowSupplyType = 'FILTRO' | 'PRODUTO_QUIMICO';

export interface ProjectWorkflowSupplyCatalogItem {
  id: string;
  type: ProjectWorkflowSupplyType;
  code: string;
  name: string;
  unitLabel: string;
  categoryName: string | null;
  balance: number;
}

export interface ProjectWorkflowSupplyPlanItem {
  id: string;
  stockItemId: string | null;
  type: ProjectWorkflowSupplyType;
  code: string | null;
  name: string;
  unitLabel: string;
  requiredQuantity: number;
  availableQuantity: number;
  shortageQuantity: number;
  purchaseRequired: boolean;
  requestedAt: string | null;
  purchasedAt: string | null;
}

export interface ProjectWorkflowPreparationResources {
  equipment: {
    defined: boolean;
    items: ProjectWorkflowPreparationEquipmentItem[];
  };
  materials: {
    defined: boolean;
    items: Array<ProjectWorkflowSupplyPlanItem & {
      availableInStock: boolean;
      checks: ProjectWorkflowPreparationItemCheck[];
    }>;
  };
}

export interface ProjectWorkflowLogisticsPlanning {
  vehicleRequired: boolean | null;
  vehicleQuantity: number | null;
  vehicleType: 'CARRO' | 'CAMINHAO' | null;
  freightRequired: boolean | null;
  lodgingRequired: boolean | null;
  lodgingPeopleCount: number | null;
  lodgingExpectedDate: string | null;
  lodgingRequested: boolean | null;
  lodgingRequestedAt: string | null;
  lodgingCompletedAt: string | null;
  complete: boolean;
  issues: string[];
  warnings: string[];
}

export interface ProjectWorkflowResourcePlanning {
  targetDate?: string | null;
  team: {
    defined: boolean | null;
    demands: ProjectWorkflowTeamDemand[];
    catalog: ProjectWorkflowRolePlanningOption[];
    hiringRequired: boolean;
    complianceSource: 'SOLIDES';
    complianceStatus: 'AWAITING_INTEGRATION';
  };
  equipment: {
    defined: boolean | null;
    categoryIds: string[];
    equipmentIds: string[];
    selections: Array<{ categoryId: string; equipmentIds: string[] }>;
    categories: ProjectWorkflowEquipmentPlanningCategory[];
    catalog: ProjectWorkflowEquipmentPlanningCategory[];
  };
  supplies: {
    defined: boolean | null;
    items: ProjectWorkflowSupplyPlanItem[];
    catalog: ProjectWorkflowSupplyCatalogItem[];
    purchasePendingCount: number;
  };
  logistics: ProjectWorkflowLogisticsPlanning;
}

export type ProjectWorkflowPreparationReadiness = ProjectWorkflowPlanningReadiness;
export type ProjectWorkflowDemobilizationReadiness = ProjectWorkflowPlanningReadiness;
export type ProjectWorkflowPostJobReadiness = ProjectWorkflowPlanningReadiness;
export type ProjectWorkflowCloseoutReadiness = ProjectWorkflowPlanningReadiness;
export interface ProjectWorkflowClosureReadiness {
  completed: number;
  total: number;
  percentage: number;
}

export interface ProjectWorkflowClosureGate {
  ready: boolean;
  completed: number;
  total: number;
  percentage: number;
  blockers: Array<{ key: string; label: string; reason: string }>;
  documents?: ProjectDocumentRequirementSummary;
}

export interface ProjectWorkflowPostJob {
  meetingDate: string | null;
  fieldLeaderFeedback: string | null;
  teamFeedback: string | null;
  problemsFound: string | null;
  solutionsAdopted: string | null;
  improvementOpportunities: string | null;
  lessonsLearned: string | null;
  equipmentFeedback: string | null;
  planningFeedback: string | null;
  serviceTypes: string[];
  qualityRecord: { id: string; number: string } | null;
  createdAt: string | null;
  updatedAt: string | null;
  createdBy: { id: string; name: string } | null;
  updatedBy: { id: string; name: string } | null;
}

export interface RelatedProjectPostJob {
  projectId: string;
  project: { code: string; name: string; clientName: string };
  meetingDate: string | null;
  serviceTypes: string[];
  matches: { sameClient: boolean; services: string[] };
  problemsFound: string | null;
  solutionsAdopted: string | null;
  improvementOpportunities: string | null;
  lessonsLearned: string | null;
  equipmentFeedback: string | null;
  planningFeedback: string | null;
  qualityRecord: { id: string; number: string } | null;
}

export interface ProjectWorkflowMeasurement {
  quantitiesSummary: string | null;
  additionalServicesNote: string | null;
  evidenceNote: string | null;
  executedAmount: number | null;
  measuredAmount: number | null;
  approvedAmount: number | null;
  preparedAt: string | null;
  sentAt: string | null;
  approvedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  createdBy: { id: string; name: string } | null;
  updatedBy: { id: string; name: string } | null;
}

export interface ProjectWorkflowMobilizationGateBlocker {
  key: string;
  label: string;
  reason: string;
  front: string;
}

export interface ProjectWorkflowMobilizationGateFront {
  key: string;
  label: string;
  status: 'READY' | 'BLOCKED';
  completed: number;
  total: number;
  blockers: Array<Omit<ProjectWorkflowMobilizationGateBlocker, 'front'>>;
}

export interface ProjectWorkflowMobilizationGate {
  ready: boolean;
  fronts: ProjectWorkflowMobilizationGateFront[];
  preJob: ProjectWorkflowMobilizationGateFront;
  blockers: ProjectWorkflowMobilizationGateBlocker[];
  deadlineStatus: 'READY' | 'RISK' | 'ATTENTION' | 'PENDING';
}

export interface ProjectWorkflowMobilizationAuthorization {
  status: 'NOT_AUTHORIZED' | 'AUTHORIZED' | 'SUSPENDED';
  authorized: boolean;
  authorizedAt: string | null;
  authorizedVersion: number | null;
  currentVersion: number;
}

export interface ProjectWorkflowCriticalAnswer {
  id?: string;
  key: string;
  label: string;
  area: string;
  issueDescription: string;
  answer: boolean | null;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
}

export interface ProjectWorkflowIssue {
  id: string;
  sourceQuestion: string | null;
  description: string;
  area: string;
  ownerName: string | null;
  requiredLeadTimeDays: number | null;
  dueDate: string | null;
  criticality: ProjectWorkflowCriticality;
  status: ProjectWorkflowIssueStatus;
  overdue: boolean;
  updatedAt: string;
}

export interface ProjectWorkflowEvent {
  id: string;
  action: string;
  data: Record<string, unknown> | null;
  createdAt: string;
  actor: { id: string; name: string } | null;
}

export interface ProjectWorkflowCommercialFact {
  id: string | null;
  key: string;
  label: string;
  allowNotApplicable: boolean;
  evidence: 'reference' | 'note';
  status: ProjectWorkflowCommercialFactStatus;
  source: ProjectWorkflowCommercialFactSource;
  evidenceDocumentId: string | null;
  reference: string | null;
  note: string | null;
  occurredOn: string | null;
  externalId: string | null;
  externalUrl: string | null;
  sourceVersion: string | null;
  sourceUpdatedAt: string | null;
  lastSyncedAt: string | null;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
  readOnly: boolean;
}

export interface ProjectWorkflowCommercialReadiness {
  status: 'RELEASED' | 'NOT_RELEASED';
  resolvedCount: number;
  totalCount: number;
  blockers?: Array<{ key: string; label: string; reasons: string[] }>;
  pendingSignals?: Array<{ key: string; label: string; reasons: string[] }>;
  blockedOperations: Array<'PURCHASE' | 'HIRING' | 'MOBILIZATION'>;
}

export interface ProjectWorkflowTransitionOption {
  stage: ProjectWorkflowStage;
  allowed: boolean;
  issues: string[];
}

export interface ProjectWorkflow {
  projectId: string;
  stage: ProjectWorkflowStage;
  leaderUserId: string;
  leader: { id: string; name: string; isActive: boolean };
  acceptedAt: string | null;
  commercialExpectedMobilizationDate: string | null;
  commercialExpectedStartDate: string | null;
  commercialExpectedDurationDays: number | null;
  commercialWhatsappGroupCreated: boolean | null;
  commercialWhatsappGroupUrl: string | null;
  commercialParticipantsIncluded: boolean | null;
  commercialClientContactName: string | null;
  commercialClientContactPhone: string | null;
  commercialClientContactEmail: string | null;
  commercialAssumptions: string | null;
  commercialSourceUpdatedAt: string | null;
  analysisClientContactMade: boolean | null;
  analysisClientContactName: string | null;
  analysisClientContactDate: string | null;
  teamPlanDefined: boolean | null;
  equipmentPlanDefined: boolean | null;
  supplyPlanDefined: boolean | null;
  closedAt: string | null;
  closedBy: { id: string; name: string } | null;
  plannedMobilizationDate: string;
  fieldCompletionDate: string | null;
  demobilizationDate: string | null;
  version: number;
  checklists: ProjectWorkflowChecklist[];
  criticalAnswers: ProjectWorkflowCriticalAnswer[];
  commercialFacts: ProjectWorkflowCommercialFact[];
  commercialReadiness: ProjectWorkflowCommercialReadiness;
  documentationCategories: ProjectWorkflowDocumentationCategory[];
  teamPreparation: ProjectWorkflowTeamPreparation;
  preparationResources: ProjectWorkflowPreparationResources;
  clientReleases: ProjectWorkflowClientReleases;
  documentRequirements: Record<'HANDOVER' | 'MOBILIZATION' | 'CLOSEOUT', ProjectDocumentRequirementSummary>;
  documentationReadiness: ProjectWorkflowDocumentationReadiness;
  resourcePlanning: ProjectWorkflowResourcePlanning;
  planningReadiness: ProjectWorkflowPlanningReadiness;
  preparationReadiness: ProjectWorkflowPreparationReadiness;
  demobilizationReadiness: ProjectWorkflowDemobilizationReadiness;
  postJobReadiness: ProjectWorkflowPostJobReadiness;
  postJob: ProjectWorkflowPostJob;
  closeoutReadiness: ProjectWorkflowCloseoutReadiness;
  closureReadiness: ProjectWorkflowClosureReadiness;
  closureGate: ProjectWorkflowClosureGate;
  measurement: ProjectWorkflowMeasurement;
  relatedPostJobs: RelatedProjectPostJob[];
  mobilizationGate: ProjectWorkflowMobilizationGate;
  mobilizationAuthorization: ProjectWorkflowMobilizationAuthorization;
  issues: ProjectWorkflowIssue[];
  events: ProjectWorkflowEvent[];
  milestones: ProjectWorkflowMilestones;
  permissions: ProjectWorkflowPermissions;
  handoverGate: { ready: boolean; issues: string[] };
  transitionOptions: ProjectWorkflowTransitionOption[];
}

export interface ProjectWorkflowSummary extends ProjectWorkflowProject {
  workflow: null | {
    projectId: string;
    stage: ProjectWorkflowStage;
    leader: { id: string; name: string; isActive: boolean };
    acceptedAt: string | null;
    closedAt: string | null;
    closedBy: { id: string; name: string } | null;
    plannedMobilizationDate: string;
    fieldCompletionDate: string | null;
    demobilizationDate: string | null;
    version: number;
    milestones: ProjectWorkflowMilestones;
    issueCount: number;
    overdueIssueCount: number;
    commercialReadiness: ProjectWorkflowCommercialReadiness;
    documentRequirements: Record<'HANDOVER' | 'MOBILIZATION' | 'CLOSEOUT', ProjectDocumentRequirementSummary>;
    documentationReadiness: ProjectWorkflowDocumentationReadiness;
    planningReadiness: ProjectWorkflowPlanningReadiness;
    preparationReadiness: ProjectWorkflowPreparationReadiness;
    demobilizationReadiness: ProjectWorkflowDemobilizationReadiness;
    postJobReadiness: ProjectWorkflowPostJobReadiness;
    postJob: ProjectWorkflowPostJob;
    closeoutReadiness: ProjectWorkflowCloseoutReadiness;
    closureReadiness: ProjectWorkflowClosureReadiness;
    closureGate: ProjectWorkflowClosureGate;
    measurement: ProjectWorkflowMeasurement;
    mobilizationGate: ProjectWorkflowMobilizationGate;
    mobilizationAuthorization: ProjectWorkflowMobilizationAuthorization;
  };
  permissions: ProjectWorkflowPermissions;
}

export interface ProjectWorkflowDetail {
  project: ProjectWorkflowProject;
  workflow: ProjectWorkflow | null;
  permissions: ProjectWorkflowPermissions;
}

export interface ProjectExecutionDeviation {
  id: string;
  number: string;
  registeredAt: string;
  eventDate: string;
  origin: string | null;
  nature: { id?: string; name: string; isActive?: boolean } | null;
  description: string | null;
  impact: ProjectExecutionImpact | null;
  definedAction: string | null;
  actionOwner: string | null;
  actionDeadline: string | null;
  status: ProjectExecutionDeviationStatus | null;
  recurrent?: boolean;
  occurrences12m?: number;
}

export interface ProjectExecutionDashboard {
  schedule: {
    plannedProgressPct: number | null;
    actualProgressPct: number | null;
    progressMethod: string | null;
    elapsedDays: number | null;
    plannedDays: number | null;
    startDate: string | null;
    expectedEndDate: string | null;
    projectedEndDate: string | null;
  };
  rdo: {
    receivedCount: number;
    pendingOrReturnedCount: number;
    releasedToClientCount: number;
    signedCount: number;
    withQuantitiesCount: number;
    withEvidenceCount: number;
    evidenceCount: number;
    lastReportDate: string | null;
  };
  technicalReports: Array<{
    reportType: ProjectExecutionReportType;
    label: string;
    source: 'SYSTEM' | 'MANUAL';
    issuedCount: number;
    expectedCount: number;
    approvedCount: number;
    signedCount: number;
    returnedCount: number;
    missingCount: number;
  }>;
  deviations: ProjectExecutionDeviation[];
  permissions: { canEdit: boolean };
}

export interface ProjectCloseoutDashboard {
  documentation: {
    rdo: ProjectExecutionDashboard['rdo'] & { clientAcceptedCount: number };
    technicalReports: Array<ProjectExecutionDashboard['technicalReports'][number] & { clientAcceptedCount: number }>;
    totalTechnicalIssued: number;
    totalTechnicalExpected: number;
    totalClientAccepted: number;
  };
  financial: {
    originalContractAmount: number | null;
    additionalContractAmount: number | null;
    contractAmount: number | null;
    invoicedAmount: number | null;
    invoiceCount: number;
  };
  measurement: Pick<ProjectWorkflowMeasurement, 'quantitiesSummary' | 'additionalServicesNote' | 'evidenceNote' | 'executedAmount' | 'measuredAmount' | 'approvedAmount' | 'preparedAt' | 'sentAt' | 'approvedAt' | 'updatedAt' | 'updatedBy'> & {
    unmeasuredAmount: number | null;
    pendingApprovalAmount: number | null;
  };
  permissions: { canEdit: boolean };
}

export interface ProjectExecutionReportTargetInput {
  reportType: ProjectExecutionReportType;
  expectedCount: number;
  completedCount?: number;
}

export interface ProjectExecutionDeviationInput {
  category: ProjectExecutionDeviationCategory;
  description: string;
  ownerName: string;
  dueDate: string;
  impact: ProjectExecutionImpact;
  action: string;
  status: ProjectExecutionDeviationStatus;
}

export type ProjectWorkflowPatch =
  | { action: 'settings'; version: number; leaderUserId?: string; plannedMobilizationDate?: string }
  | { action: 'checklist'; version: number; key: string; status: ProjectWorkflowChecklistStatus; note?: string | null }
  | { action: 'team_member_check'; version: number; collaboratorId: string; key: ProjectWorkflowTeamMemberCheckKey; status: 'PENDING' | 'DONE' }
  | { action: 'preparation_item_check'; version: number; itemType: ProjectWorkflowPreparationItemType; itemId: string; key: ProjectWorkflowPreparationItemCheckKey; status: 'PENDING' | 'DONE' }
  | { action: 'client_attendance'; version: number; attendanceDate: string }
  | { action: 'client_release'; version: number; key: ProjectWorkflowClientReleaseKey; requested: boolean; requestedAt: string | null; requestedTo: string | null; completed: boolean; completedAt: string | null }
  | { action: 'critical'; version: number; key: string; answer: boolean }
  | { action: 'analysis_contact'; version: number; made: boolean; contactName?: string | null; contactDate?: string | null }
  | { action: 'team_plan'; version: number; defined: boolean; demands: Array<{ jobRoleId: string; requiredCount: number }> }
  | { action: 'equipment_plan'; version: number; defined: boolean; selections: Array<{ categoryId: string; equipmentIds: string[] }> }
  | { action: 'supply_plan'; version: number; defined: boolean; items: Array<{ id: string; stockItemId: string | null; type: ProjectWorkflowSupplyType; name: string; unitLabel: string; requiredQuantity: number; requestedAt: string | null; purchasedAt: string | null }> }
  | { action: 'logistics_plan'; version: number; vehicleRequired: boolean | null; vehicleQuantity: number | null; vehicleType: 'CARRO' | 'CAMINHAO' | null; freightRequired: boolean | null; lodgingRequired: boolean | null; lodgingPeopleCount: number | null; lodgingExpectedDate: string | null; lodgingRequested: boolean | null; lodgingRequestedAt: string | null; lodgingCompletedAt: string | null }
  | { action: 'documentation_category'; version: number; type: ProjectWorkflowDocumentationType; required: boolean }
  | { action: 'documentation_requirement_create'; version: number; type: ProjectWorkflowDocumentationType; name: string }
  | { action: 'documentation_requirement_update'; version: number; requirementId: string; name?: string; status?: ProjectWorkflowDocumentationStatus; requestedAt?: string | null; confirmedAt?: string | null }
  | { action: 'documentation_requirement_archive'; version: number; requirementId: string; archived: boolean }
  | { action: 'issue'; version: number; issueId: string; description: string; ownerName: string | null; requiredLeadTimeDays: number | null; dueDate: string | null; criticality: ProjectWorkflowCriticality; status: ProjectWorkflowIssueStatus }
  | { action: 'accept'; version: number }
  | { action: 'stage'; version: number; stage: ProjectWorkflowStage; reason?: string }
  | { action: 'demobilization'; version: number; mobilizationDate?: string | null; fieldCompletionDate?: string | null; returnDate?: string | null }
  | { action: 'post_job'; version: number; meetingDate?: string | null; fieldLeaderFeedback?: string | null; teamFeedback?: string | null; problemsFound?: string | null; solutionsAdopted?: string | null; improvementOpportunities?: string | null; lessonsLearned?: string | null; equipmentFeedback?: string | null; planningFeedback?: string | null }
  | { action: 'measurement'; version: number; quantitiesSummary?: string | null; additionalServicesNote?: string | null; evidenceNote?: string | null; executedAmount?: number | null; measuredAmount?: number | null; approvedAmount?: number | null; preparedAt?: string | null; sentAt?: string | null; approvedAt?: string | null }
  | { action: 'authorize_mobilization'; version: number };

const base = '/efetivo/project-workflow';

export async function listProjectWorkflows(search = '', page = 1) {
  return (await apiClient.get<{ items: ProjectWorkflowSummary[]; total: number; page: number; pageSize: number }>(base, {
    params: { ...(search ? { search } : {}), page }
  })).data;
}

export async function listProjectWorkflowLeaders() {
  return (await apiClient.get<Array<{ id: string; name: string }>>(`${base}/leaders`)).data;
}

export async function getProjectWorkflow(projectId: string) {
  return (await apiClient.get<ProjectWorkflowDetail>(`${base}/${encodeURIComponent(projectId)}`)).data;
}

export async function startProjectWorkflow(projectId: string, input: { leaderUserId: string; plannedMobilizationDate: string }) {
  return (await apiClient.post<ProjectWorkflowDetail>(`${base}/${encodeURIComponent(projectId)}`, input)).data;
}

export async function updateProjectWorkflow(projectId: string, input: ProjectWorkflowPatch) {
  return (await apiClient.patch<ProjectWorkflowDetail>(`${base}/${encodeURIComponent(projectId)}`, input)).data;
}

export async function getProjectExecutionDashboard(projectId: string) {
  return (await apiClient.get<ProjectExecutionDashboard>(`${base}/${encodeURIComponent(projectId)}/execution`)).data;
}

export async function getProjectCloseoutDashboard(projectId: string) {
  return (await apiClient.get<ProjectCloseoutDashboard>(`${base}/${encodeURIComponent(projectId)}/closeout`)).data;
}

export async function updateProjectExecutionReportTargets(projectId: string, targets: ProjectExecutionReportTargetInput[]) {
  return (await apiClient.put<ProjectExecutionDashboard>(`${base}/${encodeURIComponent(projectId)}/execution/report-targets`, { targets })).data;
}

export async function createProjectExecutionDeviation(projectId: string, input: ProjectExecutionDeviationInput) {
  return (await apiClient.post<ProjectExecutionDeviation>(`${base}/${encodeURIComponent(projectId)}/execution/deviations`, input)).data;
}

export async function updateProjectExecutionDeviationStatus(projectId: string, deviationId: string, status: ProjectExecutionDeviationStatus) {
  return (await apiClient.patch<ProjectExecutionDeviation>(`${base}/${encodeURIComponent(projectId)}/execution/deviations/${encodeURIComponent(deviationId)}`, { status })).data;
}

export function projectWorkflowErrorIssues(error: unknown) {
  const issues = (error as ApiClientError)?.issues as unknown[] | undefined;
  return (issues || []).map(issue => typeof issue === 'string' ? issue : String((issue as { message?: unknown })?.message || '')).filter(Boolean);
}
