import { apiClient, rdoApiPath } from './client';
import type { SatisfactionSurveySummary } from '../types/domain';

export interface SurveyResponses {
  [questionId: string]: string | number | undefined;
}

export type SurveyQuestionType = 'NPS' | 'SCALE' | 'SELECT' | 'TEXT';

export interface SurveyQuestion {
  id: string;
  label: string;
  type: SurveyQuestionType;
  options: string[];
  required: boolean;
  order: number;
}

export interface SurveyListItem extends SatisfactionSurveySummary {
  responses?: SurveyResponses | null;
  questions?: SurveyQuestion[];
  project?: {
    id: string;
    code: string;
    name: string;
    clientName: string;
    isActive: boolean;
  } | null;
}

export interface PublicSurveyPayload {
  status: 'ACTIVE' | 'RESPONDED' | 'EXPIRED' | 'INVALID';
  survey?: {
    id: string;
    expiresAt: string;
    respondedAt?: string | null;
    questions: SurveyQuestion[];
    project: {
      code: string;
      name: string;
      clientName: string;
    };
  };
}

export interface SurveyResponsePayload {
  answers: SurveyResponses;
  privacyNoticeAccepted: true;
  privacyNoticeVersion: string;
}

export async function sendProjectSurvey(projectId: string) {
  const response = await apiClient.post<{ survey: SatisfactionSurveySummary; reused: boolean }>(rdoApiPath(`/surveys/${projectId}/send`));
  return response.data;
}

export async function resendSurvey(surveyId: string) {
  const response = await apiClient.post<{ survey: SatisfactionSurveySummary; reused: boolean }>(rdoApiPath(`/surveys/${surveyId}/resend`));
  return response.data;
}

export async function listSurveys() {
  const response = await apiClient.get<SurveyListItem[]>(rdoApiPath('/surveys'));
  return response.data;
}

export async function listProjectSurveys(projectId: string) {
  const response = await apiClient.get<SatisfactionSurveySummary[]>(rdoApiPath(`/surveys/projects/${projectId}`));
  return response.data;
}

export async function listSurveyQuestions() {
  const response = await apiClient.get<SurveyQuestion[]>(rdoApiPath('/surveys/questions'));
  return response.data;
}

export async function updateSurveyQuestions(questions: Array<Omit<SurveyQuestion, 'order'>>) {
  const response = await apiClient.put<SurveyQuestion[]>(rdoApiPath('/surveys/questions'), { questions });
  return response.data;
}

export async function getClientSurveyLink(projectId: string) {
  const response = await apiClient.get<{ url: string; expiresAt: string }>(rdoApiPath(`/surveys/client/projects/${projectId}/active-link`));
  return response.data;
}

export async function getPublicSurvey(token: string) {
  const response = await apiClient.get<PublicSurveyPayload>(`/surveys/respond/${encodeURIComponent(token)}`);
  return response.data;
}

export async function submitPublicSurvey(token: string, payload: SurveyResponsePayload) {
  const response = await apiClient.post<{ success: true }>(`/surveys/respond/${encodeURIComponent(token)}`, payload);
  return response.data;
}

export interface SurveyDashboardSurveyItem {
  id: string;
  sentAt: string;
  projectCode: string;
  projectName: string;
  clientName: string;
  operatorName: string;
  respondedAt: string | null;
  expiresAt: string;
  npsScore: number | null;
  questionAnswers: Array<{
    id: string;
    label: string;
    type: string;
    order: number;
    value: string | number | null;
  }>;
  followUpStatus?: 'OPEN' | 'CONTACTED' | 'RESOLVED' | 'NOT_APPLICABLE' | null;
  followUpNotes?: string | null;
  followUpUpdatedAt?: string | null;
}

export interface SurveyDashboardQuestionAvg {
  id: string;
  label: string;
  order: number;
  type: string;
  avg: number;
  count: number;
}

export interface SurveyDashboardNpsDistribution {
  promoters: number;
  neutrals: number;
  detractors: number;
  total: number;
  score: number | null;
  counts: Record<string, number>;
}

export interface SurveyDashboardMonth {
  month: number;
  sent: number;
  responded: number;
  questionAverages: SurveyDashboardQuestionAvg[];
  npsDistribution: SurveyDashboardNpsDistribution;
  surveys: SurveyDashboardSurveyItem[];
}

export interface SurveyDashboardData {
  year: number;
  years: number[];
  months: SurveyDashboardMonth[];
}

export async function getSurveyDashboard(year: number) {
  const response = await apiClient.get<SurveyDashboardData>(rdoApiPath(`/surveys/dashboard?year=${year}`));
  return response.data;
}

export async function updateSurveyFollowUp(
  surveyId: string,
  payload: { status?: SurveyDashboardSurveyItem['followUpStatus']; notes?: string | null }
) {
  const response = await apiClient.patch<SatisfactionSurveySummary>(rdoApiPath(`/surveys/${surveyId}/follow-up`), payload);
  return response.data;
}
