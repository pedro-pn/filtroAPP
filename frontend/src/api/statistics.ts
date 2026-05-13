import { apiClient } from './client';

export type ProjectStatsGranularity = 'day' | 'week' | 'month' | 'year';
export type ProjectStatusFilter = 'all' | 'active' | 'archived';

export interface ProjectStatsParams {
  projectId?: string[] | 'all';
  segment?: string;
  projectStatus?: ProjectStatusFilter;
  from: string;
  to: string;
  granularity: ProjectStatsGranularity;
}

export interface ProjectStatsSummary {
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

export interface ProjectStatsService {
  label: string;
  serviceCount: number;
  volumeOleoLiters?: number;
  tubesByDiameter?: Record<string, { meters: number }>;
  hasTubulacao?: number;
  bySystemEquipment?: ProjectStatsServiceContribution[];
  items?: ProjectStatsServiceItem[];
}

export interface ProjectStatsServiceContribution {
  system?: string | null;
  equipmentName?: string | null;
  serviceCount: number;
  volumeOleoLiters?: number;
  tubesByDiameter?: Record<string, { meters: number }>;
  hasTubulacao?: number;
}

export interface ProjectStatsServiceItem {
  serviceId: string;
  system?: string | null;
  equipmentName?: string | null;
  volumeOleoLiters?: number;
  tubesByDiameter?: Record<string, { meters: number }>;
  hasTubulacao?: boolean;
}

export interface ProjectStatsTimelineItem {
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

export interface ProjectStatsProject {
  id: string;
  code: string;
  name: string;
  clientName?: string | null;
  clientSegment?: string | null;
  isActive: boolean;
}

export interface ProjectStatsDailyReport {
  reportId: string;
  reportDate: string;
  sequenceNumber?: number | null;
  status: string;
  daytimeWorkedMinutes: number;
  nighttimeWorkedMinutes: number;
  daytimeOvertimeMinutes: number;
  nighttimeOvertimeMinutes: number;
  standby: boolean;
  standbyMinutes: number;
  daytimeCollaborators: number;
  nighttimeCollaborators: number;
  services: Record<string, ProjectStatsService>;
}

export interface ProjectStatsByProject {
  projectId: string;
  code: string;
  name: string;
  clientName?: string | null;
  clientSegment?: string | null;
  isActive: boolean;
  summary: ProjectStatsSummary;
  services: Record<string, ProjectStatsService>;
  dailyReports: ProjectStatsDailyReport[];
}

export interface ProjectStatsData {
  projects: ProjectStatsProject[];
  meta: {
    from: string;
    to: string;
    granularity: ProjectStatsGranularity;
    includedStatuses: string[];
    projectStatus: ProjectStatusFilter;
    generatedAt: string;
    ignoredLegacyRows: {
      volumeOleo: number;
      tubulacao: number;
    };
  };
  summary: ProjectStatsSummary;
  services: Record<string, ProjectStatsService>;
  timeline: ProjectStatsTimelineItem[];
  byProject: ProjectStatsByProject[];
}

function requestParams(params: ProjectStatsParams, section?: 'summary' | 'byProject' | 'services') {
  return {
    ...params,
    projectId: Array.isArray(params.projectId) ? params.projectId.join(',') : params.projectId,
    section
  };
}

export async function getProjectStats(params: ProjectStatsParams) {
  const response = await apiClient.get<ProjectStatsData>('/statistics/projects', { params: requestParams(params) });
  return response.data;
}

export async function exportProjectStats(params: ProjectStatsParams, section: 'summary' | 'byProject' | 'services') {
  const response = await apiClient.get<Blob>('/statistics/projects/export', {
    params: requestParams(params, section),
    responseType: 'blob'
  });
  return response.data;
}
