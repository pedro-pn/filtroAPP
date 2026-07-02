import { apiClient, rdoApiPath } from './client';
import type { ClientSegment } from '../types/domain';

export interface StatsParams {
  projectId?: string | string[];
  segment?: string;
  projectStatus?: 'active' | 'archived' | 'all';
  from?: string;
  to?: string;
  granularity?: 'day' | 'week' | 'month' | 'year';
  includeDailyReports?: boolean;
}

export type StatsExportSection = 'summary' | 'byProject' | 'services';

export interface ClientSegmentPayload {
  label: string;
  slug: string;
  isActive?: boolean;
  order?: number;
}

export interface StatsSummary {
  reportCount: number;
  totalDays: number;
  daytimeWorkedMinutes: number;
  nighttimeWorkedMinutes: number;
  daytimeOvertimeMinutes: number;
  nighttimeOvertimeMinutes: number;
  standbyCount: number;
  standbyMinutes: number;
  avgDaytimeCollaborators: number;
  avgNighttimeCollaborators: number;
}

export interface StatsServiceStats {
  serviceCount: number;
  volumeOleoLiters: number;
  tubesByDiameter: Record<string, number>;
  hasTubulacao: number;
  items?: Array<{
    serviceId: string;
    system: string | null;
    equipmentName: string | null;
    volumeOleoLiters: number | null;
    tubesByDiameter: Record<string, number>;
  }>;
}

export interface StatsTimelineSlot {
  period: string;
  label: string;
  reportCount: number;
  daytimeWorkedMinutes: number;
  nighttimeWorkedMinutes: number;
  daytimeOvertimeMinutes: number;
  nighttimeOvertimeMinutes: number;
  standbyCount: number;
  serviceBreakdown: Record<string, number>;
}

export interface StatsDailyReport {
  reportId: string;
  reportDate: string;
  sequenceNumber: number | null;
  status: string;
  daytimeWorkedMinutes: number;
  nighttimeWorkedMinutes: number;
  daytimeOvertimeMinutes: number;
  nighttimeOvertimeMinutes: number;
  standby: boolean;
  standbyMinutes: number;
  daytimeCollaborators: number;
  nighttimeCollaborators: number;
  services: Record<string, StatsServiceStats>;
}

export interface StatsProjectData {
  projectId: string;
  code: string;
  name: string;
  summary: StatsSummary;
  services: Record<string, StatsServiceStats>;
  dailyReports: StatsDailyReport[];
}

export interface ProjectStatsResponse {
  projects: Array<{ id: string; code: string; name: string; clientName: string; clientSegment: string | null }>;
  meta: {
    from: string;
    to: string;
    granularity: string;
    projectStatus: string;
    includedStatuses: string[];
    generatedAt: string;
    ignoredLegacyRows: { volumeOleo: number; tubulacao: number };
    reportCountLimit?: number;
    dailyReportLimit?: number;
    dailyReportsIncluded?: boolean;
  };
  summary: StatsSummary;
  services: Record<string, StatsServiceStats>;
  timeline: StatsTimelineSlot[];
  byProject: StatsProjectData[];
}

export interface AllocationReportRecipient {
  id: string;
  name: string | null;
  email: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AllocationReportRecipientPayload {
  name?: string;
  email: string;
  isActive?: boolean;
}

export interface AllocationReportDay {
  date: string;
  shift: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  clientName: string;
  clientCnpj: string;
  reportId: string;
  sequenceNumber: number | null;
}

export interface AllocationReportCollaborator {
  collaboratorId: string;
  collaboratorName: string;
  collaboratorRole: string;
  days: AllocationReportDay[];
}

export interface AllocationReportEntry extends AllocationReportDay {
  collaboratorId: string;
  collaboratorName: string;
  collaboratorRole: string;
}

export interface AllocationReportResponse {
  yearMonth: string;
  label: string;
  generatedAt: string;
  summary: {
    reportCount: number;
    collaboratorCount: number;
    allocationCount: number;
    dayCount: number;
    projectCount: number;
  };
  entries: AllocationReportEntry[];
  collaborators: AllocationReportCollaborator[];
}

export interface SendAllocationReportResponse {
  yearMonth: string;
  skipped: boolean;
  reason?: string;
  sent: number;
  skippedExisting?: number;
  failed?: number;
  allocationCount?: number;
}

export async function fetchProjectStats(params: StatsParams): Promise<ProjectStatsResponse> {
  const response = await apiClient.get<ProjectStatsResponse>(rdoApiPath('/statistics/projects'), { params });
  return response.data;
}

export async function fetchAllocationReport(yearMonth: string): Promise<AllocationReportResponse> {
  const response = await apiClient.get<AllocationReportResponse>(rdoApiPath('/statistics/allocation-report'), {
    params: { yearMonth }
  });
  return response.data;
}

export async function downloadAllocationReportPdf(yearMonth: string): Promise<Blob> {
  const response = await apiClient.get<Blob>(rdoApiPath('/statistics/allocation-report/pdf'), {
    params: { yearMonth },
    responseType: 'blob'
  });
  return response.data;
}

export function allocationReportPdfFileName(yearMonth: string): string {
  return `alocacao-colaboradores-${yearMonth}.pdf`;
}

export async function sendAllocationReportNow(yearMonth: string): Promise<SendAllocationReportResponse> {
  const response = await apiClient.post<SendAllocationReportResponse>(rdoApiPath('/statistics/allocation-report/send'), { yearMonth });
  return response.data;
}

export async function listAllocationReportRecipients(): Promise<AllocationReportRecipient[]> {
  const response = await apiClient.get<AllocationReportRecipient[]>(rdoApiPath('/statistics/allocation-report/recipients'));
  return response.data;
}

export async function saveAllocationReportRecipient(payload: AllocationReportRecipientPayload): Promise<AllocationReportRecipient> {
  const response = await apiClient.post<AllocationReportRecipient>(rdoApiPath('/statistics/allocation-report/recipients'), payload);
  return response.data;
}

export async function updateAllocationReportRecipient(id: string, payload: Partial<AllocationReportRecipientPayload>): Promise<AllocationReportRecipient> {
  const response = await apiClient.patch<AllocationReportRecipient>(rdoApiPath(`/statistics/allocation-report/recipients/${id}`), payload);
  return response.data;
}

export async function removeAllocationReportRecipient(id: string): Promise<void> {
  await apiClient.delete(rdoApiPath(`/statistics/allocation-report/recipients/${id}`));
}

export async function listProjectSegments(): Promise<ClientSegment[]> {
  const response = await apiClient.get<ClientSegment[]>(rdoApiPath('/project-segments'));
  return response.data;
}

export async function createProjectSegment(payload: ClientSegmentPayload): Promise<ClientSegment> {
  const response = await apiClient.post<ClientSegment>(rdoApiPath('/project-segments'), payload);
  return response.data;
}

export async function downloadProjectStatsCsv(params: StatsParams & { section: StatsExportSection }): Promise<Blob> {
  const response = await apiClient.get<Blob>(rdoApiPath('/statistics/projects/export'), {
    params,
    responseType: 'blob'
  });
  return response.data;
}

export function statsExportFileName(params: StatsParams & { section: StatsExportSection }): string {
  const from = params.from || 'inicio';
  const to = params.to || 'fim';
  return `estatisticas-${params.section}-${from}-${to}.csv`;
}

export interface StatsOverviewProject {
  projectId: string;
  code: string;
  name: string;
  isActive: boolean;
  reportCounts: Partial<Record<string, number>>;
  rdoCount: number;
}

export interface StatsOverviewResponse {
  projectCounts: { active: number; archived: number; total: number };
  byProject: StatsOverviewProject[];
}

export async function fetchStatsOverview(): Promise<StatsOverviewResponse> {
  const response = await apiClient.get<StatsOverviewResponse>(rdoApiPath('/statistics/overview'));
  return response.data;
}
