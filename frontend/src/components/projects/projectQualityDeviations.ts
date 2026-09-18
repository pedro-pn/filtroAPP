import type { ProjectDetail } from '../../api/acompanhamentoComercial';

export interface QualityDeviationProject {
  projectId: string;
  code: string;
  name: string;
  clientName: string;
}

export function qualityDeviationProjects(
  data: ProjectDetail | undefined,
  projectId: string | undefined,
  isGroup: boolean
): QualityDeviationProject[] {
  if (isGroup) {
    return (data?.group?.members ?? [])
      .filter(member => member.visible !== false)
      .map(({ projectId: memberProjectId, code, name, clientName }) => ({
        projectId: memberProjectId,
        code,
        name,
        clientName
      }));
  }
  if (!projectId) return [];
  return [{
    projectId,
    code: data?.header.code ?? '',
    name: '',
    clientName: data?.header.clientName ?? ''
  }];
}
