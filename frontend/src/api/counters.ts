import { apiClient } from './client';
import type { ParticleCounter } from '../types/domain';

export interface ParticleCounterPayload {
  code: string;
  serialNumber: string;
  calibratedAt: string;
  expiresAt: string;
}

export async function listParticleCounters() {
  const response = await apiClient.get<ParticleCounter[]>('/particle-counters');
  return response.data;
}

export async function createParticleCounter(payload: ParticleCounterPayload) {
  const response = await apiClient.post<ParticleCounter>('/particle-counters', payload);
  return response.data;
}

export async function updateParticleCounter(id: string, payload: Partial<ParticleCounterPayload>) {
  const response = await apiClient.put<ParticleCounter>(`/particle-counters/${id}`, payload);
  return response.data;
}

export async function removeParticleCounter(id: string) {
  await apiClient.delete(`/particle-counters/${id}`);
}
