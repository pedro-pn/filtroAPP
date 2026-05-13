import { apiClient } from './client';
import type { ClientSegment } from '../types/domain';

export interface StatsParams {
  projectId?: string | string[];
  segment?: string;
  projectStatus?: 'active' | 'archived' | 'all';
  from?: string;
  to?: string;
  granularity?: 'day' | 'week' | 'month' | 'year';
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
  };
  summary: StatsSummary;
  services: Record<string, StatsServiceStats>;
  timeline: StatsTimelineSlot[];
  byProject: StatsProjectData[];
}

export async function fetchProjectStats(params: StatsParams): Promise<ProjectStatsResponse> {
  const response = await apiClient.get<ProjectStatsResponse>('/statistics/projects', { params });
  return response.data;
}

export async function listProjectSegments(): Promise<ClientSegment[]> {
  const response = await apiClient.get<ClientSegment[]>('/project-segments');
  return response.data;
}

export async function createProjectSegment(payload: ClientSegmentPayload): Promise<ClientSegment> {
  const response = await apiClient.post<ClientSegment>('/project-segments', payload);
  return response.data;
}

export async function downloadProjectStatsCsv(params: StatsParams & { section: StatsExportSection }): Promise<Blob> {
  const response = await apiClient.get<Blob>('/statistics/projects/export', {
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
