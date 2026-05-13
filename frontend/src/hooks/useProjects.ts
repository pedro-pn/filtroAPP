import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createProject, createProjectSegment, listProjectSegments, listProjects, removeProject, type ProjectPayload, updateProject } from '../api/projects';
import { useAuth } from '../auth/AuthContext';
import { queryKeys } from './queryKeys';

export function useProjects(active?: boolean) {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.projects(active, user?.id),
    queryFn: () => listProjects(active)
  });
}

export function useProjectSegments() {
  return useQuery({
    queryKey: queryKeys.projectSegments,
    queryFn: listProjectSegments
  });
}

export function useProjectMutations() {
  const queryClient = useQueryClient();

  function invalidateProjects() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ['projects'] }),
      queryClient.invalidateQueries({ queryKey: ['reports'] })
    ]);
  }

  const createMutation = useMutation({
    mutationFn: (payload: ProjectPayload) => createProject(payload),
    onSuccess: invalidateProjects
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<ProjectPayload> }) => updateProject(id, payload),
    onSuccess: invalidateProjects
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeProject(id),
    onSuccess: invalidateProjects
  });

  const createSegmentMutation = useMutation({
    mutationFn: (payload: { label: string; slug?: string; order?: number }) => createProjectSegment(payload),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.projectSegments }),
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    ])
  });

  return {
    createProject: createMutation,
    updateProject: updateMutation,
    removeProject: removeMutation,
    createProjectSegment: createSegmentMutation
  };
}
