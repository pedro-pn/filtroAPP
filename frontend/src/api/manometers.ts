import { apiClient } from './client';
import type { Manometer } from '../types/domain';

export interface ManometerPayload {
  code: string;
  scale: string;
  calibrationCertCode: string;
  calibratedAt: string;
  expiresAt: string;
}

export async function listManometers() {
  const response = await apiClient.get<Manometer[]>('/manometers');
  return response.data;
}

export async function createManometer(payload: ManometerPayload) {
  const response = await apiClient.post<Manometer>('/manometers', payload);
  return response.data;
}

export async function updateManometer(id: string, payload: Partial<ManometerPayload>) {
  const response = await apiClient.put<Manometer>(`/manometers/${id}`, payload);
  return response.data;
}

export async function removeManometer(id: string) {
  await apiClient.delete(`/manometers/${id}`);
}
