import { apiClient, rdoApiPath } from './client';
import type { Equipment } from '../types/domain';

export interface EquipmentPayload {
  code: string;
  name: string;
  serviceTags?: string[];
}

export async function listEquipment() {
  const response = await apiClient.get<Equipment[]>(rdoApiPath('/equipment'));
  return response.data;
}

export async function createEquipment(payload: EquipmentPayload) {
  const response = await apiClient.post<Equipment>(rdoApiPath('/equipment'), payload);
  return response.data;
}

export async function updateEquipment(id: string, payload: Partial<EquipmentPayload>) {
  const response = await apiClient.put<Equipment>(rdoApiPath(`/equipment/${id}`), payload);
  return response.data;
}

export async function removeEquipment(id: string) {
  await apiClient.delete(rdoApiPath(`/equipment/${id}`));
}
