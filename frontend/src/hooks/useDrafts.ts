import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createDraft, listDrafts, removeDraft, updateDraft, type DraftPayload } from '../api/drafts';
import { queryKeys } from './queryKeys';

export function useDrafts() {
  return useQuery({
    queryKey: queryKeys.drafts,
    queryFn: listDrafts
  });
}

export function useDraftMutations() {
  const queryClient = useQueryClient();

  function invalidateDrafts() {
    return queryClient.invalidateQueries({ queryKey: queryKeys.drafts });
  }

  const createMutation = useMutation({
    mutationFn: (payload: DraftPayload) => createDraft(payload),
    onSuccess: invalidateDrafts
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Omit<DraftPayload, 'id'> }) => updateDraft(id, payload),
    onSuccess: invalidateDrafts
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeDraft(id),
    onSuccess: invalidateDrafts
  });

  return {
    createDraft: createMutation,
    updateDraft: updateMutation,
    removeDraft: removeMutation
  };
}
