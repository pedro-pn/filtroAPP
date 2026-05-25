export const queryKeys = {
  authMe: ['auth', 'me'] as const,
  collaborators: ['collaborators'] as const,
  projects: (active?: boolean, userId?: string | null) => ['projects', { active, userId: userId || 'anonymous' }] as const,
  equipment: ['equipment'] as const,
  units: ['units'] as const,
  unitCategories: ['units', 'categories'] as const,
  manometers: ['manometers'] as const,
  counters: ['particle-counters'] as const,
  drafts: (userId?: string | null) => ['drafts', { userId: userId || 'anonymous' }] as const,
  users: (group?: 'internal' | 'client') => ['users', { group }] as const,
  surveys: ['surveys'] as const,
  surveyQuestions: ['surveys', 'questions'] as const,
  reports: (filters?: unknown, userId?: string | null) => ['reports', filters ?? {}, { userId: userId || 'anonymous' }] as const,
  reportAudit: (reportId: string) => ['reports', reportId, 'audit'] as const
};
