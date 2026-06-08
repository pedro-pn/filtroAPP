import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createDraft, listDrafts, removeDraft, updateDraft, type DraftPayload } from '../api/drafts';
import { useAuth } from '../auth/AuthContext';
import type { ReportDraft } from '../types/domain';
import { queryKeys } from './queryKeys';

export function useDrafts(initialData?: ReportDraft[], enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.drafts(user?.id),
    queryFn: listDrafts,
    placeholderData: initialData,
    enabled
  });
}

export function useDraftMutations() {
  const queryClient = useQueryClient();

  function invalidateDrafts() {
    return queryClient.invalidateQueries({ queryKey: ['drafts'] });
  }

  function upsertDraftInCache(draft: ReportDraft) {
    queryClient.setQueriesData<ReportDraft[]>({ queryKey: ['drafts'] }, current => {
      if (!current?.length) return [draft];
      const found = current.some(item => item.id === draft.id);
      const next = found
        ? current.map(item => item.id === draft.id ? draft : item)
        : [draft, ...current];
      return next.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
    });
  }

  function removeDraftFromCache(id: string) {
    queryClient.setQueriesData<ReportDraft[]>({ queryKey: ['drafts'] }, current => (
      current?.filter(item => item.id !== id) || current
    ));
  }

  const createMutation = useMutation({
    mutationFn: (payload: DraftPayload) => createDraft(payload),
    onSuccess: draft => {
      upsertDraftInCache(draft);
      void invalidateDrafts();
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Omit<DraftPayload, 'id'> }) => updateDraft(id, payload),
    onSuccess: draft => {
      upsertDraftInCache(draft);
      void invalidateDrafts();
    }
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeDraft(id),
    onSuccess: (_data, id) => {
      removeDraftFromCache(id);
      void invalidateDrafts();
    }
  });

  return {
    createDraft: createMutation,
    updateDraft: updateMutation,
    removeDraft: removeMutation
  };
}
