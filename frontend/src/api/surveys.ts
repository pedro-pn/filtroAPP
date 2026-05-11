import { apiClient } from './client';
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

export async function listSurveyQuestions() {
  const response = await apiClient.get<SurveyQuestion[]>('/surveys/questions');
  return response.data;
}

export async function updateSurveyQuestions(questions: Array<Omit<SurveyQuestion, 'order'>>) {
  const response = await apiClient.put<SurveyQuestion[]>('/surveys/questions', { questions });
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
