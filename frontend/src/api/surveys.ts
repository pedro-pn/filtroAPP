import { apiClient } from './client';
import type { SatisfactionSurveySummary } from '../types/domain';

export interface SurveyListItem extends SatisfactionSurveySummary {
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
    project: {
      code: string;
      name: string;
      clientName: string;
    };
  };
}

export interface SurveyResponsePayload {
  nps: number;
  serviceQuality: number;
  communication: number;
  deadlines: number;
  documentation: number;
  improvement?: string;
  highlight?: string;
}

export async function sendProjectSurvey(projectId: string) {
  const response = await apiClient.post<{ survey: SatisfactionSurveySummary; reused: boolean }>(`/surveys/${projectId}/send`);
  return response.data;
}

export async function resendSurvey(surveyId: string) {
  const response = await apiClient.post<{ survey: SatisfactionSurveySummary; reused: boolean }>(`/surveys/${surveyId}/resend`);
  return response.data;
}

export async function listSurveys() {
  const response = await apiClient.get<SurveyListItem[]>('/surveys');
  return response.data;
}

export async function listProjectSurveys(projectId: string) {
  const response = await apiClient.get<SatisfactionSurveySummary[]>(`/surveys/projects/${projectId}`);
  return response.data;
}

export async function getClientSurveyLink(projectId: string) {
  const response = await apiClient.get<{ url: string; expiresAt: string }>(`/surveys/client/projects/${projectId}/active-link`);
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
