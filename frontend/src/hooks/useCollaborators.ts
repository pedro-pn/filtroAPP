import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createCollaborator,
  listCollaborators,
  removeCollaborator,
  removeCollaboratorJobRoleHistory,
  type CollaboratorPayload,
  type CollaboratorJobRoleHistoryPayload,
  updateCollaboratorJobRoleHistory,
  updateCollaborator
} from '../api/collaborators';
import { queryKeys } from './queryKeys';

export function useCollaborators() {
  return useQuery({
    queryKey: queryKeys.collaborators,
    queryFn: listCollaborators
  });
}

export function useCollaboratorMutations() {
  const queryClient = useQueryClient();

  function invalidateCollaborators() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.collaborators }),
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    ]);
  }

  const createMutation = useMutation({
    mutationFn: (payload: CollaboratorPayload) => createCollaborator(payload),
    onSuccess: invalidateCollaborators
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<CollaboratorPayload> }) =>
      updateCollaborator(id, payload),
    onSuccess: invalidateCollaborators
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeCollaborator(id),
    onSuccess: invalidateCollaborators
  });

  const updateJobRoleHistoryMutation = useMutation({
    mutationFn: ({ id, historyId, payload }: { id: string; historyId: string; payload: CollaboratorJobRoleHistoryPayload }) =>
      updateCollaboratorJobRoleHistory(id, historyId, payload),
    onSuccess: invalidateCollaborators
  });

  const removeJobRoleHistoryMutation = useMutation({
    mutationFn: ({ id, historyId }: { id: string; historyId: string }) =>
      removeCollaboratorJobRoleHistory(id, historyId),
    onSuccess: invalidateCollaborators
  });

  return {
    createCollaborator: createMutation,
    updateCollaborator: updateMutation,
    removeCollaborator: removeMutation,
    updateJobRoleHistory: updateJobRoleHistoryMutation,
    removeJobRoleHistory: removeJobRoleHistoryMutation
  };
}
