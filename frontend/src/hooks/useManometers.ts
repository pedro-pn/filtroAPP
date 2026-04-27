import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createManometer, listManometers, removeManometer, type ManometerPayload, updateManometer } from '../api/manometers';
import { queryKeys } from './queryKeys';

export function useManometers() {
  return useQuery({
    queryKey: queryKeys.manometers,
    queryFn: listManometers
  });
}

export function useManometerMutations() {
  const queryClient = useQueryClient();

  function invalidateManometers() {
    return queryClient.invalidateQueries({ queryKey: queryKeys.manometers });
  }

  const createMutation = useMutation({
    mutationFn: (payload: ManometerPayload) => createManometer(payload),
    onSuccess: invalidateManometers
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<ManometerPayload> }) => updateManometer(id, payload),
    onSuccess: invalidateManometers
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeManometer(id),
    onSuccess: invalidateManometers
  });

  return {
    createManometer: createMutation,
    updateManometer: updateMutation,
    removeManometer: removeMutation
  };
}
