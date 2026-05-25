import { apiClient, rdoApiPath } from './client';
import type { Manometer } from '../types/domain';

export interface ManometerPayload {
  code: string;
  scale: string;
  calibrationCertCode: string;
  calibratedAt: string;
  expiresAt: string;
}

export async function listManometers() {
  const response = await apiClient.get<Manometer[]>(rdoApiPath('/manometers'));
  return response.data;
}

export async function createManometer(payload: ManometerPayload) {
  const response = await apiClient.post<Manometer>(rdoApiPath('/manometers'), payload);
  return response.data;
}

export async function updateManometer(id: string, payload: Partial<ManometerPayload>) {
  const response = await apiClient.put<Manometer>(rdoApiPath(`/manometers/${id}`), payload);
  return response.data;
}

export async function removeManometer(id: string) {
  await apiClient.delete(rdoApiPath(`/manometers/${id}`));
}
