import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getSurveyDashboard,
  listSurveyQuestions,
  listSurveys,
  resendSurvey,
  sendProjectSurvey,
  updateSurveyFollowUp,
  updateSurveyQuestions,
  type SurveyDashboardSurveyItem,
  type SurveyQuestion
} from '../api/surveys';
import { queryKeys } from './queryKeys';

export function useSurveys() {
  return useQuery({
    queryKey: queryKeys.surveys,
    queryFn: listSurveys
  });
}

export function useSurveyDashboard(year: number) {
  return useQuery({
    queryKey: [...queryKeys.surveys, 'dashboard', year],
    queryFn: () => getSurveyDashboard(year)
  });
}

export function useSurveyQuestions() {
  return useQuery({
    queryKey: queryKeys.surveyQuestions,
    queryFn: listSurveyQuestions
  });
}

export function useSurveyMutations() {
  const queryClient = useQueryClient();

  function invalidateSurveys() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.surveys }),
      queryClient.invalidateQueries({ queryKey: queryKeys.surveyQuestions }),
      queryClient.invalidateQueries({ queryKey: ['projects'] }),
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    ]);
  }

  return {
    sendProjectSurvey: useMutation({
      mutationFn: (projectId: string) => sendProjectSurvey(projectId),
      onSuccess: invalidateSurveys
    }),
    resendSurvey: useMutation({
      mutationFn: (surveyId: string) => resendSurvey(surveyId),
      onSuccess: invalidateSurveys
    }),
    updateQuestions: useMutation({
      mutationFn: (questions: Array<Omit<SurveyQuestion, 'order'>>) => updateSurveyQuestions(questions),
      onSuccess: invalidateSurveys
    }),
    updateFollowUp: useMutation({
      mutationFn: ({ surveyId, payload }: {
        surveyId: string;
        payload: { status?: SurveyDashboardSurveyItem['followUpStatus']; notes?: string | null };
      }) => updateSurveyFollowUp(surveyId, payload),
      onSuccess: invalidateSurveys
    })
  };
}
