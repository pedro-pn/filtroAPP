import { apiClient, rdoApiPath } from './client';

export interface ProjectSystemAlias { equipment: string; system: string; serviceType: string }
export interface ProjectSystem {
  id: string; projectId: string; equipment: string; name: string;
  revision: number; aliases?: ProjectSystemAlias[];
  measurements?: Array<{ serviceType: string; systemType: 'TUBULACAO' | 'OLEO' | 'SISTEMA' }>;
}
export async function listProjectSystems(projectId: string, source: 'reports' | 'scope' = 'reports') {
  const path = source === 'scope'
    ? `/acompanhamento/comercial/projetos/${encodeURIComponent(projectId)}/sistemas`
    : rdoApiPath(`/reports/project-systems/${encodeURIComponent(projectId)}`);
  return (await apiClient.get<ProjectSystem[]>(path)).data;
}
export async function saveProjectSystemAlias(projectId: string, target: ProjectSystem, alias: ProjectSystemAlias, remove = false) {
  return (await apiClient.put<ProjectSystem>(`/acompanhamento/comercial/projetos/${encodeURIComponent(projectId)}/sistemas/${encodeURIComponent(target.id)}/alias`, {
    ...alias, remove, revision: target.revision
  })).data;
}
