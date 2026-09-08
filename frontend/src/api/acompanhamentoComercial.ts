import { apiClient } from './client';
import type { OfficialMissionContext } from './reports';

export interface CommercialRevision {
  codBd: number;
  codProp: number;
  parentCodProp?: number | null;
  nRev: number;
  proposalDate?: string | null;
  modifiedInAccessAt?: string | null;
  serviceModality?: 'INLOCO' | 'POP_SEDE' | null;
  salePrice?: string | number | null;
  plannedCost?: string | number | null;
  expectedProfit?: string | number | null;
  expectedMargin?: string | number | null;
  taxes?: string | number | null;
  plannedDays?: number | null;
  workedDays?: number | null;
  numOperators?: number | null;
  numSupervisors?: number | null;
  numPerDay?: number | null;
  numPerNight?: number | null;
  mobilizationLeadDays?: number | null;
  isComplete?: boolean;
}

export interface CommercialRevisionGroup {
  proposalCode: string;
  parentProposalCode?: string | null;
  currentCodBd: number | null;
  revisions: CommercialRevision[];
}

export interface BudgetBreakdownSlice {
  codBd?: number | null;
  codProp?: number | null;
  parentCodProp?: number | null;
  nRev?: number | null;
  salePrice?: string | number | null;
  plannedTotalCost?: string | number | null;
  expectedProfit?: string | number | null;
  expectedMargin?: string | number | null;
  taxes?: string | number | null;
}

export interface BudgetBreakdown {
  original?: BudgetBreakdownSlice | null;
  additionals: BudgetBreakdownSlice[];
  additionalCount: number;
  additionalTotals?: BudgetBreakdownSlice | null;
  totals?: BudgetBreakdownSlice | null;
}

export interface ProjectRevisions {
  proposalCode: string | null;
  currentCodBd: number | null;
  resolved?: boolean;
  approvedAt?: string | null;
  mobilizationLeadDays?: number | null;
  startDate?: string | null;
  mobilizationDate?: string | null;
  demobilizationDate?: string | null;
  manualProgressPct?: string | number | null;
  offshore?: boolean;
  laborSleepModeByCollaborator?: Record<string, 'HOME' | 'AWAY'>;
  laborCollaboratorIds?: string[];
  laborCollaborators?: LaborCollaborator[];
  additionalProposals?: CommercialRevisionGroup[];
  currentAdditionalCodBds?: number[];
  revisions: CommercialRevision[];
}

export type LaborCollaboratorSource = 'LEADER' | 'RDO' | 'MANUAL';

export interface LaborCollaborator {
  id: string;
  name: string;
  role: string | null;
  sources: LaborCollaboratorSource[];
}

export interface ProjectSchedulePayload {
  approvedAt?: string | null;
  startDate?: string | null;
  mobilizationDate?: string | null;
  demobilizationDate?: string | null;
  manualProgressPct?: number | null;
  offshore?: boolean;
  laborSleepModeByCollaborator?: Record<string, 'HOME' | 'AWAY'>;
  laborCollaboratorIds?: string[];
}

export type ProgressMethod = 'RDO' | 'MANUAL';
export type GroupProgressMethod = 'GROUP_SCOPE' | 'GROUP_WEIGHTED' | 'GROUP_AVERAGE';
export interface ProjectAlert {
  code: string;
  level: 'danger' | 'warn';
  label: string;
}

export interface PresumedProfitTaxEstimate {
  method: 'COMMERCIAL_TAX_SPREADSHEET_2026';
  defaultServiceTaxCode: string;
  supportedServiceTaxCodes: string[];
  projectCostBasis: 'IRPJ_CSLL_OUTSIDE_INVOICE';
  serviceTaxCode: '14.01' | '7.05' | '7.02' | 'MIXED';
  serviceTaxCodes?: Array<'14.01' | '7.05' | '7.02'>;
  omieServiceTaxCodes?: string[];
  equivalentServiceTaxCode: string | null;
  spreadsheetBlock: string;
  basisSource: 'EXPECTED_SALE' | 'OMIE_INVOICED';
  basisAmount: number;
  expectedSalePrice: number | null;
  invoicedAmount: number | null;
  salePrice: number;
  iss: number;
  omieIss: number | null;
  issDelta: number | null;
  pis: number;
  cofins: number;
  inss: number;
  invoiceTaxTotal: number;
  irpjPresumedBasis: number;
  csllPresumedBasis: number;
  presumedBasis: number;
  irpjPresumptionPct: number;
  csllPresumptionPct: number;
  presumptionPct: number;
  issRatePct: number;
  pisRatePct: number;
  cofinsRatePct: number;
  inssRatePct: number;
  serviceInssRatePct: number;
  serviceInssTaxCodes: Array<'14.01' | '7.02'>;
  irpjRatePct: number;
  csllRatePct: number;
  additionalIrpjRatePct: number;
  additionalIrpjThreshold: number;
  minimumEffectivePct: number;
  probableEffectivePct: number;
  effectiveTaxPct: number;
  invoiceTaxEffectivePct: number;
  irpjCsllEffectivePct: number;
  irpjBasic: number;
  csll: number;
  additionalIrpjEstimated: number;
  irpjTotal: number;
  irpjCsllTotal: number;
  outOfInvoiceTaxTotal: number;
  estimatedProjectTaxCost: number;
  totalTax: number;
  netAfterTaxes: number;
  netAfterOutOfInvoiceTaxes: number;
  minimumOutOfInvoiceTaxTotal: number;
  minimumTotal: number;
  probableTotal: number;
  source: string;
}

export async function getProjectRevisions(projectId: string): Promise<ProjectRevisions> {
  const { data } = await apiClient.get<ProjectRevisions>(`/acompanhamento/comercial/projetos/${projectId}/revisoes`);
  return data;
}

export async function getProjectPlanningContext(projectId: string, date: string): Promise<OfficialMissionContext | null> {
  const { data } = await apiClient.get<OfficialMissionContext | null>(`/acompanhamento/comercial/projetos/${projectId}/planning-context`, { params: { date } });
  return data;
}

export interface CommercialPendencia {
  projectId: string;
  proposalCode: string;
  revisionCount: number;
  originalRevisionCount?: number;
  additionalProposalCount?: number;
  additionalRevisionCount?: number;
  pendingCount?: number;
  pendingAdditionalProposalCount?: number;
  originalPending?: boolean;
  resolved: boolean;
}

export async function getCommercialPendencias(): Promise<CommercialPendencia[]> {
  const { data } = await apiClient.get<CommercialPendencia[]>('/acompanhamento/comercial/pendencias');
  return data;
}

export interface MissionGroupMemberSummary {
  projectId: string;
  code: string;
  name: string;
  clientName: string;
  clientCnpj?: string | null;
  order?: number;
  category?: ProjectCardCategory;
  progressPct?: number | null;
  visible?: boolean;
}

export interface MissionGroupResponse {
  id: string;
  name: string;
  status: 'ACTIVE' | 'DISSOLVED';
  laborAllocationMode: MissionGroupLaborAllocationMode;
  primaryLaborProjectId: string | null;
  createdAt: string;
  updatedAt: string;
  dissolvedAt: string | null;
  warning?: string;
  members: MissionGroupMemberSummary[];
}

export type MissionGroupLaborAllocationMode = 'VISUAL_ONLY' | 'SHARED_EXECUTION' | 'CONSOLIDATE_PRIMARY';

export interface CreateMissionGroupRequest {
  name?: string;
  projectIds: string[];
}

export interface DashboardRow {
  kind?: 'PROJECT';
  projectId: string;
  code: string;
  name: string;
  clientName: string;
  clientCnpj?: string | null;
  proposalCode: string;
  resolved: boolean;
  archived: boolean;
  startDate?: string | null;
  approvedAt?: string | null;
  mobilizationLeadDays?: number | null;
  salePrice?: string | number | null;
  originalSalePrice?: string | number | null;
  additionalSalePrice?: string | number | null;
  invoicedRevenue?: string | number | null;
  invoicedIss?: string | number | null;
  invoiceCount?: number | null;
  plannedTotalCost?: string | number | null;
  originalPlannedTotalCost?: string | number | null;
  additionalPlannedTotalCost?: string | number | null;
  expectedProfit?: string | number | null;
  originalExpectedProfit?: string | number | null;
  additionalExpectedProfit?: string | number | null;
  expectedMargin?: string | number | null;
  taxes?: string | number | null;
  originalTaxes?: string | number | null;
  additionalTaxes?: string | number | null;
  budgetBreakdown?: BudgetBreakdown | null;
  plannedDays?: number | null;
  workedDays?: number | null;
  numOperators?: number | null;
  numSupervisors?: number | null;
  numPerDay?: number | null;
  numPerNight?: number | null;
  serviceModality?: 'INLOCO' | 'POP_SEDE' | null;
  components?: Record<string, number | null>;
  rdoCount: number;
  realizedOmieCost?: string | number | null;
  realizedCost?: string | number | null;
  realizedPaid?: string | number | null;
  stockCost?: string | number | null;
  manualCost?: string | number | null;
  presumedProfitTaxes?: PresumedProfitTaxEstimate | null;
  progressPct?: number | null;
  progressMethod?: ProgressMethod | null;
  progressWeight?: number | null;
}

export interface DashboardGroupRow extends Omit<DashboardRow, 'kind' | 'projectId' | 'progressMethod'> {
  kind: 'GROUP';
  groupId: string;
  members: MissionGroupMemberSummary[];
  progressMethod?: GroupProgressMethod | null;
}

export type DashboardItem = DashboardRow | DashboardGroupRow;

export async function getCommercialDashboard(categoryCode?: string): Promise<DashboardItem[]> {
  const { data } = await apiClient.get<DashboardItem[]>('/acompanhamento/comercial/dashboard', {
    params: categoryCode ? { category: categoryCode } : undefined
  });
  return data;
}

export async function listMissionGroups(status?: 'ACTIVE' | 'DISSOLVED' | 'ALL'): Promise<MissionGroupResponse[]> {
  const { data } = await apiClient.get<MissionGroupResponse[]>('/acompanhamento/comercial/grupos-missoes', {
    params: status ? { status } : undefined
  });
  return data;
}

export async function createMissionGroup(payload: CreateMissionGroupRequest): Promise<MissionGroupResponse> {
  const { data } = await apiClient.post<MissionGroupResponse>('/acompanhamento/comercial/grupos-missoes', payload);
  return data;
}

export async function renameMissionGroup(groupId: string, name: string): Promise<MissionGroupResponse> {
  const { data } = await apiClient.patch<MissionGroupResponse>(`/acompanhamento/comercial/grupos-missoes/${groupId}`, { name });
  return data;
}

export async function updateMissionGroupLaborPolicy(
  groupId: string,
  payload: {
    laborAllocationMode: MissionGroupLaborAllocationMode;
    primaryLaborProjectId?: string | null;
  }
): Promise<MissionGroupResponse> {
  const { data } = await apiClient.patch<MissionGroupResponse>(`/acompanhamento/comercial/grupos-missoes/${groupId}`, payload);
  return data;
}

export async function dissolveMissionGroup(groupId: string): Promise<{ ok: true; groupId: string; dissolvedAt: string }> {
  const { data } = await apiClient.post<{
    ok: true;
    groupId: string;
    dissolvedAt: string;
  }>(`/acompanhamento/comercial/grupos-missoes/${groupId}/desmesclar`);
  return data;
}

export interface RealizedCategory {
  categoriaCodigo: string | null;
  categoria: string;
  total: string | number | null;
  count: number;
}

export async function getRealizedByCategory(projectId?: string): Promise<RealizedCategory[]> {
  const { data } = await apiClient.get<RealizedCategory[]>('/acompanhamento/comercial/realizado-categorias', {
    params: projectId ? { projectId } : undefined
  });
  return data;
}

export interface SedeMonthlyCost {
  month: string;
  label: string;
  total: number;
  paidTotal: number;
  openTotal: number;
  count: number;
}

export interface SedeCostCategory {
  categoria: string;
  total: number;
  count: number;
}

export interface SedeCostCard {
  code: string;
  label: string;
  shortLabel: string;
  total: number;
  paidTotal: number;
  openTotal: number;
  currentMonthTotal: number;
  count: number;
  lastPurchaseDate?: string | null;
  monthly: SedeMonthlyCost[];
  topCategories: SedeCostCategory[];
}

export interface SedeCostsResponse {
  codes: string[];
  currentMonth: string;
  currentMonthLabel: string;
  availableMonths: string[];
  summary: {
    total: number;
    paidTotal: number;
    openTotal: number;
    currentMonthTotal: number;
    count: number;
  };
  cards: SedeCostCard[];
  operational: SedeOperationalMetrics;
}

export interface SedeOperationalMetrics {
  range: { fromMonth: string; toMonth: string } | null;
  maintenance: {
    summary: {
      reportCount: number;
      maintenanceCount: number;
      workedMinutes: number;
      overtimeMinutes: number;
      collaboratorCount: number;
    };
    byProfile: Array<{ profileName: string; maintenanceCount: number }>;
    byEquipment: Array<{
      equipmentId: string;
      equipmentCode: string;
      equipmentName: string;
      maintenanceCount: number;
    }>;
  };
  production: {
    summary: {
      reportCount: number;
      totalKg: number;
      workedMinutes: number;
      overtimeMinutes: number;
      collaboratorCount: number;
    };
    byMaterial: Array<{
      material: 'CARBON_STEEL' | 'STAINLESS_STEEL' | 'CUNIFE' | 'OTHER';
      totalKg: number;
      cleaningCount: number;
    }>;
  };
}

export async function getSedeCosts(params?: { from: string; to: string }): Promise<SedeCostsResponse> {
  const { data } = await apiClient.get<SedeCostsResponse>('/acompanhamento/comercial/sede', {
    params: params ? { from: params.from, to: params.to } : undefined
  });
  return data;
}

export async function setProjectRevision(projectId: string, codBd: number) {
  const { data } = await apiClient.post(`/acompanhamento/comercial/projetos/${projectId}/revisao`, { codBd });
  return data;
}

export async function setProjectAdditionalRevision(projectId: string, codBd: number) {
  const { data } = await apiClient.post(`/acompanhamento/comercial/projetos/${projectId}/propostas-adicionais/revisao`, { codBd });
  return data;
}

export async function removeProjectAdditionalRevision(projectId: string, codProp: number) {
  const { data } = await apiClient.delete(`/acompanhamento/comercial/projetos/${projectId}/propostas-adicionais/${codProp}`);
  return data;
}

export async function setProjectSchedule(projectId: string, payload: ProjectSchedulePayload) {
  const { data } = await apiClient.patch(`/acompanhamento/comercial/projetos/${projectId}/cronograma`, payload);
  return data;
}

// --- Escopo previsto: quantitativo de serviços vendidos + previsão de hora extra ---

export type PlannedMeasureUnit = 'M' | 'KG' | 'T' | 'UN' | 'L';
export type PlannedSystemType = 'TUBULACAO' | 'OLEO';
export type PlannedDiameterUnit = 'pol' | 'mm';

export interface PlannedServiceSystem {
  systemType: PlannedSystemType;
  description?: string | null;
  diameter?: string | null;
  diameterUnit?: PlannedDiameterUnit | null;
  quantity?: string | number | null;
  unit?: PlannedMeasureUnit | null;
}

export interface PlannedService {
  id?: string;
  serviceType: string;
  weight?: string | number | null;
  note?: string | null;
  systems: PlannedServiceSystem[];
}

export interface PlannedOvertime {
  id?: string;
  jobRoleId?: string | null;
  roleName?: string | null;
  collaboratorCount?: number;
  hours: string | number;
}

export interface PlannedScope {
  services: PlannedService[];
  normalHours: PlannedOvertime[];
  overtime: PlannedOvertime[];
}

export async function getPlannedScope(projectId: string): Promise<PlannedScope> {
  const { data } = await apiClient.get<PlannedScope>(`/acompanhamento/comercial/projetos/${projectId}/escopo-previsto`);
  return data;
}

export async function setPlannedScope(projectId: string, payload: PlannedScope): Promise<PlannedScope> {
  const { data } = await apiClient.put<PlannedScope>(`/acompanhamento/comercial/projetos/${projectId}/escopo-previsto`, payload);
  return data;
}

// --- Avanço físico (RDO ponderado por serviço) ---

export interface ProgressSystem {
  systemType: PlannedSystemType;
  unit: PlannedMeasureUnit | null;
  plannedQty: number | null;
  realizedQty: number | null;
  pct: number | null;
}

export interface ProgressService {
  serviceType: string;
  weight: number;
  executionPct: number | null;
  systems: ProgressSystem[];
}

export interface ProjectProgress {
  hasScope: boolean;
  progressPct: number | null;
  services: ProgressService[];
}

export type RequiredWeeklyProgressStatus = 'REQUIRED' | 'COMPLETED' | 'DUE_TODAY' | 'OVERDUE' | 'UNAVAILABLE';

export interface RequiredWeeklyProgressSystem {
  systemType: PlannedSystemType;
  unit: PlannedMeasureUnit | null;
  plannedQty: number | null;
  realizedQty: number | null;
  remainingQty: number | null;
  status: RequiredWeeklyProgressStatus;
  requiredQtyPerWeek: number | null;
}

export interface RequiredWeeklyProgress {
  status: RequiredWeeklyProgressStatus;
  remainingDays: number | null;
  remainingPctPoints: number | null;
  requiredPctPointsPerWeek: number | null;
  services: Array<{
    serviceType: string;
    executionPct: number | null;
    systems: RequiredWeeklyProgressSystem[];
  }>;
}

export async function getProjectProgress(projectId: string): Promise<ProjectProgress> {
  const { data } = await apiClient.get<ProjectProgress>(`/acompanhamento/comercial/projetos/${projectId}/avanco`);
  return data;
}

// --- Cards da aba Projetos ---

export type LastDayStatus = 'TRABALHADO' | 'PARADO' | 'SEM_RDO';
export type ProjectCardCategory = 'ANDAMENTO' | 'FUTURO' | 'ARQUIVADO';

export interface WorkedHoursProgress {
  normalWorkedHours: number;
  overtimeWorkedHours: number;
  totalWorkedHours: number;
  plannedNormalHours: number;
  plannedOvertimeHours: number;
  plannedTotalHours: number | null;
  normalPct: number | null;
  overtimePct: number | null;
  totalPct: number | null;
  roleCounts?: Array<{
    roleName: string;
    collaboratorCount: number;
    usedHours: number;
    pctOfPlannedTotal: number | null;
  }>;
}

export interface ProgressHistoryPoint {
  date: string;
  progressPct: number;
}

export interface ProjectCard {
  kind?: 'PROJECT';
  projectId: string;
  code: string;
  name: string;
  clientName: string;
  clientCnpj?: string | null;
  archived: boolean;
  archivedInReports: boolean;
  archivedInAcompanhamento: boolean;
  reviewed: boolean;
  reviewedAt: string | null;
  reportArchivedAt: string | null;
  category: ProjectCardCategory;
  workedDays: number;
  totalDays: number | null;
  daysConsumedPct: number | null;
  workedHours: WorkedHoursProgress;
  progressPct: number | null;
  progressMethod?: ProgressMethod | null;
  progressWeight?: number | null;
  plannedCost: number | null;
  originalPlannedCost?: number | null;
  additionalPlannedCost?: number | null;
  originalSalePrice?: number | null;
  additionalSalePrice?: number | null;
  budgetBreakdown?: BudgetBreakdown | null;
  invoicedRevenue: number | null;
  invoiceCount: number;
  presumedProfitTaxes: PresumedProfitTaxEstimate | null;
  realizedCost: number;
  costConsumedPct: number | null;
  lastDay: { date: string | null; status: LastDayStatus };
  collaboratorsCount: number;
  collaboratorIds?: string[];
  startDate: string | null;
  expectedEndDate: string | null;
  laborCost: number | null; // custo de mão de obra COM adicional offshore (do ponto), somado ao realizado
  laborCostBase: number | null; // custo de mão de obra SEM offshore (comparação)
  laborHours: number | null; // jornada analítica do Ponto Mais apropriada ao projeto
  stockCost: number; // consumo líquido de produtos químicos/filtros via romaneio
  manualCost: number; // custos lançados manualmente no acompanhamento
  equipment: Array<{ name: string; days: number; since: string }>; // equipamentos (módulo Equipamentos) em obra
  alerts: ProjectAlert[];
}

export interface MissionGroupCard extends Omit<ProjectCard, 'kind' | 'projectId' | 'progressMethod'> {
  kind: 'GROUP';
  groupId: string;
  laborAllocationMode: MissionGroupLaborAllocationMode;
  primaryLaborProjectId: string | null;
  members: MissionGroupMemberSummary[];
  progressMethod?: GroupProgressMethod | null;
}

export type ProjectCardItem = ProjectCard | MissionGroupCard;

export interface ProjectStandbyHistoryEntry {
  date: string;
  standbyMinutes: number;
  collaboratorCount: number | null;
  reason: string | null;
}

export interface ProjectStandbyHistory {
  project: {
    id: string;
    code: string;
    name: string;
  };
  entries: ProjectStandbyHistoryEntry[];
}

export interface ProjectManagementNote {
  id: string;
  projectId: string;
  content: string;
  author: { id: string | null; name: string };
  createdAt: string;
}

export async function getProjectCards(): Promise<ProjectCardItem[]> {
  const { data } = await apiClient.get<ProjectCardItem[]>('/acompanhamento/comercial/projetos-cards');
  return data;
}

export async function getProjectStandbyHistory(projectId: string): Promise<ProjectStandbyHistory> {
  const { data } = await apiClient.get<ProjectStandbyHistory>(`/acompanhamento/comercial/projetos/${encodeURIComponent(projectId)}/standby-historico`);
  return data;
}

export async function listProjectManagementNotes(projectId: string): Promise<ProjectManagementNote[]> {
  const { data } = await apiClient.get<ProjectManagementNote[]>(`/acompanhamento/comercial/projetos/${encodeURIComponent(projectId)}/notas-gestao`);
  return data;
}

export async function createProjectManagementNote(projectId: string, content: string): Promise<ProjectManagementNote> {
  const { data } = await apiClient.post<ProjectManagementNote>(`/acompanhamento/comercial/projetos/${encodeURIComponent(projectId)}/notas-gestao`, { content });
  return data;
}

export async function setProjectTrackingState(projectId: string, payload: { archived: boolean } | { reviewed: boolean }) {
  const { data } = await apiClient.patch(`/acompanhamento/comercial/projetos/${projectId}/acompanhamento-status`, payload);
  return data;
}

// --- Dashboard detalhado de um projeto ---

export type DayStatus = 'TRABALHADO' | 'STANDBY' | 'PARADO';

export interface ManualProjectCost {
  id: string;
  projectId: string;
  projectCode?: string | null;
  description: string;
  amount: number;
  costDate?: string | null;
  note?: string | null;
  createdAt?: string | null;
  createdBy?: { id: string; name: string } | null;
}

export interface ManualProjectCostPayload {
  description: string;
  amount: number;
  costDate?: string | null;
  note?: string | null;
}

export interface ProjectDetailCollaborator {
  name: string;
  role: string;
  /** Jornada dos RDOs; em grupos, usa o maior lançamento por data para evitar duplicidade entre missões. */
  horas: number;
  /** Soma bruta das jornadas de todas as missões, inclusive quando elas se sobrepõem. */
  horasLancadas: number;
  /** Horas analíticas do Ponto Mais apropriadas ao projeto; podem repetir em execução compartilhada. */
  horasApropriadas: number | null;
  /** Parte das horas apropriadas registrada em dias marcados como viagem/deslocamento. */
  horasDeslocamento: number;
  /** Trilha diária das horas do ponto que formam a apropriação deste projeto. */
  diasApropriados: Array<{
    data: string;
    horas: number;
    horasNormais: number;
    horasExtras: number;
    emViagem: boolean;
    rdos: Array<{
      numero: number | null;
      projetoId: string | null;
      projetoCodigo: string | null;
    }>;
  }>;
  sobreposicaoHoras: number;
  horasRelatoriosPorData: Array<{
    data: string;
    horas: number;
    /** Relatórios-fonte, preservados mesmo quando o grupo deduplica a jornada por data. */
    relatorios?: Array<{
      id: string;
      tipo: string;
      numero: number | null;
      projetoId: string;
      projetoCodigo: string | null;
      horas: number;
    }>;
  }>;
  custo: number | null;
  custoHora: number | null;
  /** Parcela proporcional do custo apropriado correspondente às horas de deslocamento. */
  custoDeslocamento: number | null;
}

export interface ProjectDetail {
  group?: {
    id: string;
    name: string;
    laborAllocationMode: MissionGroupLaborAllocationMode;
    primaryLaborProjectId: string | null;
    members: MissionGroupMemberSummary[];
  };
  header: {
    code: string;
    clientName: string;
    clientCnpj?: string | null;
    proposalCode: string | null;
    lastRdoDate: string | null;
    segment: string | null;
  };
  alerts: ProjectAlert[];
  avancoMethod?: ProgressMethod | GroupProgressMethod | null;
  diasCorridos: {
    elapsed: number | null;
    planned: number | null;
    pct: number | null;
  };
  diasTrabalhados: {
    worked: number;
    planned: number | null;
    pct: number | null;
  };
  consumo: {
    gasto: number;
    omie: number;
    pago: number;
    previstoPagar: number;
    estoque: number;
    manual: number;
    previsto: number | null;
    previstoOriginal?: number | null;
    previstoAdicional?: number | null;
    pct: number | null;
  };
  faturamento: {
    previsto: string | number | null;
    previstoOriginal?: string | number | null;
    previstoAdicional?: string | number | null;
    realizado: string | number | null;
    notas: number;
  };
  budgetBreakdown?: BudgetBreakdown | null;
  maoDeObra: {
    custo: number | null;
    custoBase: number | null;
    horas: number | null;
    periodStart: string | null;
    periodEnd: string | null;
  };
  presumedProfitTaxes: PresumedProfitTaxEstimate | null;
  workedHours: WorkedHoursProgress;
  maioresGastos: Array<{ categoria: string; total: number }>;
  manualCosts?: ManualProjectCost[];
  avancoPct: number | null;
  progressHistory?: ProgressHistoryPoint[];
  requiredWeeklyProgress?: RequiredWeeklyProgress;
  standby: { count: number; minutes: number };
  ultimosDias: Array<{
    date: string;
    status: DayStatus;
    workedMinutes: number;
    standbyMinutes: number;
  }>;
  overtimeMinutes: number;
  colaboradores: ProjectDetailCollaborator[];
  equipamentos: Array<{ name: string; days: number; since: string }>;
  plannedScope?: PlannedScope;
  footer: {
    mobilizationDate: string | null;
    startDate: string | null;
    expectedEndDate: string | null;
    projectedEndByPace: string | null;
  };
}

export async function getProjectDetail(projectId: string): Promise<ProjectDetail> {
  const { data } = await apiClient.get<ProjectDetail>(`/acompanhamento/comercial/projetos/${projectId}/detalhe`);
  return data;
}

export async function getMissionGroupDetail(groupId: string): Promise<ProjectDetail> {
  const { data } = await apiClient.get<ProjectDetail>(`/acompanhamento/comercial/grupos-missoes/${groupId}/detalhe`);
  return data;
}

export interface ProjectRomaneio {
  id: string;
  type: 'OUTBOUND' | 'INBOUND';
  romaneioDate: string;
  vehiclePlate: string;
  project: { id: string; code: string; name: string | null };
  items: Array<{
    id: string;
    itemCode: string | null;
    itemName: string;
    categoryName: string;
    quantity: string | number;
    unitLabel: string;
    isCustom: boolean;
    isExtra: boolean;
  }>;
}

export interface ProjectRomaneiosResponse {
  romaneios: ProjectRomaneio[];
}

export async function getProjectRomaneios(projectId: string): Promise<ProjectRomaneiosResponse> {
  const { data } = await apiClient.get<ProjectRomaneiosResponse>(`/acompanhamento/comercial/projetos/${projectId}/romaneios`);
  return data;
}

export async function getMissionGroupRomaneios(groupId: string): Promise<ProjectRomaneiosResponse> {
  const { data } = await apiClient.get<ProjectRomaneiosResponse>(`/acompanhamento/comercial/grupos-missoes/${groupId}/romaneios`);
  return data;
}

export async function createManualProjectCost(projectId: string, payload: ManualProjectCostPayload): Promise<ManualProjectCost> {
  const { data } = await apiClient.post<ManualProjectCost>(`/acompanhamento/comercial/projetos/${projectId}/custos-manuais`, payload);
  return data;
}

export async function deleteManualProjectCost(projectId: string, costId: string): Promise<{ ok: true; id: string }> {
  const { data } = await apiClient.delete<{ ok: true; id: string }>(`/acompanhamento/comercial/projetos/${projectId}/custos-manuais/${costId}`);
  return data;
}
