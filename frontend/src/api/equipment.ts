import { apiClient } from './client';
import type { Equipment } from '../types/domain';

export interface EquipmentPayload {
  code: string;
  name: string;
  serviceTags?: string[];
}

export async function listEquipment() {
  const response = await apiClient.get<Equipment[]>('/equipment');
  return response.data;
}

export async function createEquipment(payload: EquipmentPayload) {
  const response = await apiClient.post<Equipment>('/equipment', payload);
  return response.data;
}

export async function updateEquipment(id: string, payload: Partial<EquipmentPayload>) {
  const response = await apiClient.put<Equipment>(`/equipment/${id}`, payload);
  return response.data;
}

export async function removeEquipment(id: string) {
  await apiClient.delete(`/equipment/${id}`);
}
