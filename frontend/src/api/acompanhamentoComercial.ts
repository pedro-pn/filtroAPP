import { apiClient } from './client';

export interface CommercialRevision {
  codBd: number;
  codProp: number;
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

export interface ProjectRevisions {
  proposalCode: string | null;
  currentCodBd: number | null;
  resolved?: boolean;
  approvedAt?: string | null;
  mobilizationLeadDays?: number | null;
  startDate?: string | null;
  mobilizationDate?: string | null;
  revisions: CommercialRevision[];
}

export interface ProjectSchedulePayload {
  approvedAt?: string | null;
  startDate?: string | null;
  mobilizationDate?: string | null;
}

export async function getProjectRevisions(projectId: string): Promise<ProjectRevisions> {
  const { data } = await apiClient.get<ProjectRevisions>(
    `/acompanhamento/comercial/projetos/${projectId}/revisoes`
  );
  return data;
}

export interface CommercialPendencia {
  projectId: string;
  proposalCode: string;
  revisionCount: number;
  resolved: boolean;
}

export async function getCommercialPendencias(): Promise<CommercialPendencia[]> {
  const { data } = await apiClient.get<CommercialPendencia[]>('/acompanhamento/comercial/pendencias');
  return data;
}

export interface DashboardRow {
  projectId: string;
  code: string;
  name: string;
  clientName: string;
  proposalCode: string;
  resolved: boolean;
  startDate?: string | null;
  approvedAt?: string | null;
  mobilizationLeadDays?: number | null;
  salePrice?: string | number | null;
  plannedTotalCost?: string | number | null;
  expectedProfit?: string | number | null;
  expectedMargin?: string | number | null;
  plannedDays?: number | null;
  workedDays?: number | null;
  numOperators?: number | null;
  numSupervisors?: number | null;
  numPerDay?: number | null;
  numPerNight?: number | null;
  serviceModality?: 'INLOCO' | 'POP_SEDE' | null;
  components?: Record<string, number | null>;
  rdoCount: number;
  realizedCost?: string | number | null;
  realizedPaid?: string | number | null;
  progressPct?: number | null;
}

export async function getCommercialDashboard(categoryCode?: string): Promise<DashboardRow[]> {
  const { data } = await apiClient.get<DashboardRow[]>('/acompanhamento/comercial/dashboard', {
    params: categoryCode ? { category: categoryCode } : undefined
  });
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

export async function setProjectRevision(projectId: string, codBd: number) {
  const { data } = await apiClient.post(
    `/acompanhamento/comercial/projetos/${projectId}/revisao`,
    { codBd }
  );
  return data;
}

export async function setProjectSchedule(projectId: string, payload: ProjectSchedulePayload) {
  const { data } = await apiClient.patch(
    `/acompanhamento/comercial/projetos/${projectId}/cronograma`,
    payload
  );
  return data;
}

// --- Escopo previsto: quantitativo de serviços vendidos + previsão de hora extra ---

export type PlannedMeasureUnit = 'M' | 'KG' | 'T' | 'UN' | 'L';
export type PlannedSystemType = 'TUBULACAO' | 'OLEO';

export interface PlannedServiceSystem {
  systemType: PlannedSystemType;
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
  collaboratorCount: number;
  hours: string | number;
}

export interface PlannedScope {
  services: PlannedService[];
  overtime: PlannedOvertime[];
}

export async function getPlannedScope(projectId: string): Promise<PlannedScope> {
  const { data } = await apiClient.get<PlannedScope>(
    `/acompanhamento/comercial/projetos/${projectId}/escopo-previsto`
  );
  return data;
}

export async function setPlannedScope(projectId: string, payload: PlannedScope): Promise<PlannedScope> {
  const { data } = await apiClient.put<PlannedScope>(
    `/acompanhamento/comercial/projetos/${projectId}/escopo-previsto`,
    payload
  );
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

export async function getProjectProgress(projectId: string): Promise<ProjectProgress> {
  const { data } = await apiClient.get<ProjectProgress>(
    `/acompanhamento/comercial/projetos/${projectId}/avanco`
  );
  return data;
}

// --- Cards da aba Projetos ---

export type LastDayStatus = 'TRABALHADO' | 'PARADO' | 'SEM_RDO';

export interface ProjectCard {
  projectId: string;
  code: string;
  name: string;
  clientName: string;
  workedDays: number;
  totalDays: number | null;
  daysConsumedPct: number | null;
  progressPct: number | null;
  lastDay: { date: string | null; status: LastDayStatus };
  collaboratorsCount: number;
  startDate: string | null;
  expectedEndDate: string | null;
}

export async function getProjectCards(): Promise<ProjectCard[]> {
  const { data } = await apiClient.get<ProjectCard[]>('/acompanhamento/comercial/projetos-cards');
  return data;
}

// --- Dashboard detalhado de um projeto ---

export type DayStatus = 'TRABALHADO' | 'STANDBY' | 'PARADO';

export interface ProjectDetail {
  header: {
    code: string;
    clientName: string;
    proposalCode: string | null;
    lastRdoDate: string | null;
    segment: string | null;
  };
  diasCorridos: { elapsed: number | null; planned: number | null; pct: number | null };
  diasTrabalhados: { worked: number; planned: number | null; pct: number | null };
  consumo: { gasto: number; previsto: number | null; pct: number | null };
  maioresGastos: Array<{ categoria: string; total: number }>;
  avancoPct: number | null;
  standby: { count: number; minutes: number };
  ultimosDias: Array<{ date: string; status: DayStatus; workedMinutes: number; standbyMinutes: number }>;
  overtimeMinutes: number;
  colaboradores: Array<{ name: string; role: string }>;
  footer: {
    mobilizationDate: string | null;
    startDate: string | null;
    expectedEndDate: string | null;
    projectedEndByPace: string | null;
  };
}

export async function getProjectDetail(projectId: string): Promise<ProjectDetail> {
  const { data } = await apiClient.get<ProjectDetail>(
    `/acompanhamento/comercial/projetos/${projectId}/detalhe`
  );
  return data;
}
