import { apiClient, rdoApiPath } from './client';
import type { Unit, UnitCategory } from '../types/domain';

export interface UnitPayload {
  code: string;
  category: UnitCategory;
}

export async function listUnits() {
  const response = await apiClient.get<Unit[]>(rdoApiPath('/units'));
  return response.data;
}

export async function createUnit(payload: UnitPayload) {
  const response = await apiClient.post<Unit>(rdoApiPath('/units'), payload);
  return response.data;
}

export async function updateUnit(id: string, payload: Partial<UnitPayload>) {
  const response = await apiClient.put<Unit>(rdoApiPath(`/units/${id}`), payload);
  return response.data;
}

export async function removeUnit(id: string) {
  await apiClient.delete(rdoApiPath(`/units/${id}`));
}
