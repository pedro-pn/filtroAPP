import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createEquipamento,
  createEquipmentCategory,
  listEquipamentos,
  listEquipmentCategories,
  listRdoSlots,
  removeEquipamento,
  removeEquipmentCategory,
  updateEquipamento,
  updateEquipmentCategory,
  updateRdoSlot,
  type EquipmentCategoryPayload,
  type EquipmentPayload
} from '../api/equipamentos';
import { queryKeys } from './queryKeys';

export function useRdoSlots(enabled = true) {
  return useQuery({
    queryKey: ['equipamentos', 'rdo-slots'],
    queryFn: listRdoSlots,
    enabled
  });
}

export function useEquipmentCategories() {
  return useQuery({
    queryKey: queryKeys.equipamentoCategories,
    queryFn: listEquipmentCategories
  });
}

export function useEquipamentos(categoryId?: string) {
  return useQuery({
    queryKey: queryKeys.equipamentos(categoryId),
    queryFn: () => listEquipamentos(categoryId)
  });
}

export function useEquipamentoMutations() {
  const queryClient = useQueryClient();

  function invalidateAll() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ['equipamentos'] }),
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.units }),
      queryClient.invalidateQueries({ queryKey: queryKeys.manometers }),
      queryClient.invalidateQueries({ queryKey: queryKeys.counters })
    ]);
  }

  const createCategory = useMutation({
    mutationFn: (payload: EquipmentCategoryPayload) => createEquipmentCategory(payload),
    onSuccess: invalidateAll
  });
  const updateCategory = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<EquipmentCategoryPayload> }) => updateEquipmentCategory(id, payload),
    onSuccess: invalidateAll
  });
  const removeCategory = useMutation({
    mutationFn: (id: string) => removeEquipmentCategory(id),
    onSuccess: invalidateAll
  });

  const createEquipment = useMutation({
    mutationFn: (payload: EquipmentPayload) => createEquipamento(payload),
    onSuccess: invalidateAll
  });
  const updateEquipment = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<EquipmentPayload> }) => updateEquipamento(id, payload),
    onSuccess: invalidateAll
  });
  const removeEquipment = useMutation({
    mutationFn: (id: string) => removeEquipamento(id),
    onSuccess: invalidateAll
  });

  const updateSlot = useMutation({
    mutationFn: ({ slotKey, categoryId }: { slotKey: string; categoryId: string | null }) => updateRdoSlot(slotKey, categoryId),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ['equipamentos', 'rdo-slots'] }),
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    ])
  });

  return { createCategory, updateCategory, removeCategory, createEquipment, updateEquipment, removeEquipment, updateSlot };
}
