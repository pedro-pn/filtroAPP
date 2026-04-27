import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createUnit, listUnits, removeUnit, type UnitPayload, updateUnit } from '../api/units';
import { queryKeys } from './queryKeys';

export function useUnits() {
  return useQuery({
    queryKey: queryKeys.units,
    queryFn: listUnits
  });
}

export function useUnitMutations() {
  const queryClient = useQueryClient();

  function invalidateUnits() {
    return queryClient.invalidateQueries({ queryKey: queryKeys.units });
  }

  const createMutation = useMutation({
    mutationFn: (payload: UnitPayload) => createUnit(payload),
    onSuccess: invalidateUnits
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<UnitPayload> }) => updateUnit(id, payload),
    onSuccess: invalidateUnits
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeUnit(id),
    onSuccess: invalidateUnits
  });

  return {
    createUnit: createMutation,
    updateUnit: updateMutation,
    removeUnit: removeMutation
  };
}
