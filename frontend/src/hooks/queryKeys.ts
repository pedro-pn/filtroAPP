export const queryKeys = {
  authMe: ['auth', 'me'] as const,
  collaborators: ['collaborators'] as const,
  projects: (active?: boolean) => ['projects', { active }] as const,
  equipment: ['equipment'] as const,
  units: ['units'] as const,
  manometers: ['manometers'] as const,
  counters: ['particle-counters'] as const,
  drafts: ['drafts'] as const,
  users: (group?: 'internal' | 'client') => ['users', { group }] as const,
  reports: (filters?: unknown) => ['reports', filters ?? {}] as const
};
