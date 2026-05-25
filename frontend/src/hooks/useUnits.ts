import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createUnit, listUnitCategories, listUnits, removeUnit, renameUnitCategory, type UnitPayload, updateUnit } from '../api/units';
import { queryKeys } from './queryKeys';

export function useUnits() {
  return useQuery({
    queryKey: queryKeys.units,
    queryFn: listUnits
  });
}

export function useUnitCategories() {
  return useQuery({
    queryKey: queryKeys.unitCategories,
    queryFn: listUnitCategories
  });
}

export function useUnitMutations() {
  const queryClient = useQueryClient();

  function invalidateUnits() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.units }),
      queryClient.invalidateQueries({ queryKey: queryKeys.unitCategories })
    ]);
  }

  const createMutation = useMutation({
    mutationFn: (payload: UnitPayload) => createUnit(payload),
    onSuccess: invalidateUnits
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<UnitPayload> }) => updateUnit(id, payload),
    onSuccess: invalidateUnits
  });

  const renameCategoryMutation = useMutation({
    mutationFn: renameUnitCategory,
    onSuccess: invalidateUnits
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeUnit(id),
    onSuccess: invalidateUnits
  });

  return {
    createUnit: createMutation,
    updateUnit: updateMutation,
    renameUnitCategory: renameCategoryMutation,
    removeUnit: removeMutation
  };
}
