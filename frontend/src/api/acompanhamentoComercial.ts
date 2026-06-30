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
  revisions: CommercialRevision[];
}

export interface ProjectSchedulePayload {
  approvedAt?: string | null;
  startDate?: string | null;
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
export type PlannedSystemType = 'TUBULACAO' | 'TANQUE' | 'OLEO';

export interface PlannedServiceSystem {
  systemType: PlannedSystemType;
  quantity?: string | number | null;
  unit?: PlannedMeasureUnit | null;
}

export interface PlannedService {
  id?: string;
  serviceType: string;
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
