import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createEquipment, listEquipment, removeEquipment, type EquipmentPayload, updateEquipment } from '../api/equipment';
import { queryKeys } from './queryKeys';

export function useEquipment() {
  return useQuery({
    queryKey: queryKeys.equipment,
    queryFn: listEquipment
  });
}

export function useEquipmentMutations() {
  const queryClient = useQueryClient();

  function invalidateEquipment() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.equipment }),
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    ]);
  }

  const createMutation = useMutation({
    mutationFn: (payload: EquipmentPayload) => createEquipment(payload),
    onSuccess: invalidateEquipment
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<EquipmentPayload> }) => updateEquipment(id, payload),
    onSuccess: invalidateEquipment
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeEquipment(id),
    onSuccess: invalidateEquipment
  });

  return {
    createEquipment: createMutation,
    updateEquipment: updateMutation,
    removeEquipment: removeMutation
  };
}
