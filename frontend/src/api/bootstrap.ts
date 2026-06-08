import { apiClient, rdoApiPath } from './client';
import type { InhibitionOptions } from './inhibitionOptions';
import type { SurveyListItem, SurveyQuestion } from './surveys';
import type { ClientSegment, Collaborator, Equipment, Manometer, ParticleCounter, Project, ReportDraft, ReportType, Unit, UnitCategory } from '../types/domain';

export interface NewReportBootstrap {
  projects: Project[];
  collaborators: Collaborator[];
  units: Unit[];
  manometers: Manometer[];
  counters: ParticleCounter[];
  inhibitionOptions: InhibitionOptions;
  drafts: ReportDraft[];
}

export interface ReportDetailSequenceReport {
  id: string;
  projectId: string;
  reportType: ReportType;
  sequenceNumber?: number | null;
}

export interface ReportDetailBootstrap extends NewReportBootstrap {
  equipment: Equipment[];
  sequenceReports: ReportDetailSequenceReport[];
}

export interface GestorBootstrap {
  activeProjects: Project[];
  archivedProjects: Project[];
  collaborators: Collaborator[];
  units: Unit[];
  unitCategories: UnitCategory[];
  manometers: Manometer[];
  counters: ParticleCounter[];
  surveys: SurveyListItem[];
  projectSegments: ClientSegment[];
  surveyQuestions: SurveyQuestion[];
}

export async function getNewReportBootstrap() {
  const response = await apiClient.get<NewReportBootstrap>(rdoApiPath('/bootstrap/new-report'));
  return response.data;
}

export async function getReportDetailBootstrap(reportId: string) {
  const response = await apiClient.get<ReportDetailBootstrap>(rdoApiPath(`/bootstrap/report-detail/${reportId}`));
  return response.data;
}

export async function getGestorBootstrap() {
  const response = await apiClient.get<GestorBootstrap>(rdoApiPath('/bootstrap/gestor'));
  return response.data;
}
