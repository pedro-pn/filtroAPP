import { apiClient, rdoApiPath } from './client';

export interface JobRole {
  id: string;
  name: string;
  order: number;
  isActive: boolean;
}

export async function listJobRoles(): Promise<JobRole[]> {
  const { data } = await apiClient.get<JobRole[]>(rdoApiPath('/job-roles'));
  return data;
}
