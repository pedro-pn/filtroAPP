import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createParticleCounter,
  listParticleCounters,
  removeParticleCounter,
  type ParticleCounterPayload,
  updateParticleCounter
} from '../api/counters';
import { queryKeys } from './queryKeys';

export function useCounters() {
  return useQuery({
    queryKey: queryKeys.counters,
    queryFn: listParticleCounters
  });
}

export function useCounterMutations() {
  const queryClient = useQueryClient();

  function invalidateCounters() {
    return queryClient.invalidateQueries({ queryKey: queryKeys.counters });
  }

  const createMutation = useMutation({
    mutationFn: (payload: ParticleCounterPayload) => createParticleCounter(payload),
    onSuccess: invalidateCounters
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<ParticleCounterPayload> }) =>
      updateParticleCounter(id, payload),
    onSuccess: invalidateCounters
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeParticleCounter(id),
    onSuccess: invalidateCounters
  });

  return {
    createCounter: createMutation,
    updateCounter: updateMutation,
    removeCounter: removeMutation
  };
}
