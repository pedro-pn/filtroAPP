import { apiClient, rdoApiPath } from './client';
import type { ClientSigner, Project, ProjectReportSequence } from '../types/domain';

export interface ProjectPayload {
  code: string;
  name: string;
  isActive?: boolean;
  visibleToCollaborators?: boolean;
  managerOnly?: boolean;
  inhibitionServiceEnabled?: boolean;
  clientName: string;
  clientCnpj: string;
  clientEmailPrimary?: string;
  clientEmailCc?: string[];
  clientSigners?: ClientSigner[];
  contractCode: string;
  location: string;
  workdayHours?: string;
  weekendWorkdayHours?: string;
  includesSaturday?: boolean;
  includesSunday?: boolean;
  operatorId?: string | null;
  clientSegment?: string | null;
  authorizedUserIds?: string[];
  reportSequences?: Array<Pick<ProjectReportSequence, 'reportType' | 'nextNumber'>>;
}

export async function listProjects(active?: boolean) {
  const response = await apiClient.get<Project[]>(rdoApiPath('/projects'), {
    params: active === undefined ? undefined : { active }
  });
  return response.data;
}

export async function createProject(payload: ProjectPayload) {
  const response = await apiClient.post<Project>(rdoApiPath('/projects'), payload);
  return response.data;
}

export async function updateProject(id: string, payload: Partial<ProjectPayload>) {
  const response = await apiClient.put<Project>(rdoApiPath(`/projects/${id}`), payload);
  return response.data;
}

export async function removeProject(id: string) {
  await apiClient.delete(rdoApiPath(`/projects/${id}`));
}
