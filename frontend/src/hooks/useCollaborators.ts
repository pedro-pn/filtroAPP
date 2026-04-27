import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createCollaborator,
  listCollaborators,
  removeCollaborator,
  type CollaboratorPayload,
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
    return queryClient.invalidateQueries({ queryKey: queryKeys.collaborators });
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

  return {
    createCollaborator: createMutation,
    updateCollaborator: updateMutation,
    removeCollaborator: removeMutation
  };
}
