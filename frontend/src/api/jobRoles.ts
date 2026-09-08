import { apiClient, rdoApiPath } from './client';

export interface JobRole {
  id: string;
  name: string;
  order: number;
  isActive: boolean;
  isOperational: boolean;
}

export async function listJobRoles(all = false): Promise<JobRole[]> {
  const { data } = await apiClient.get<JobRole[]>(rdoApiPath(`/job-roles${all ? '?all=true' : ''}`));
  return data;
}

export async function createJobRole(payload: { name: string; isOperational?: boolean }): Promise<JobRole> {
  const { data } = await apiClient.post<JobRole>(rdoApiPath('/job-roles'), payload);
  return data;
}

export async function updateJobRole(id: string, payload: { name?: string; isActive?: boolean; isOperational?: boolean; order?: number }): Promise<JobRole> {
  const { data } = await apiClient.patch<JobRole>(rdoApiPath(`/job-roles/${id}`), payload);
  return data;
}

export async function deactivateJobRole(id: string): Promise<void> {
  await apiClient.delete(rdoApiPath(`/job-roles/${id}`));
}
