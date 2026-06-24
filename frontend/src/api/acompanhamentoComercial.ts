import { apiClient } from './client';

export interface CommercialRevision {
  codBd: number;
  codProp: number;
  nRev: number;
  proposalDate?: string | null;
  modifiedInAccessAt?: string | null;
  serviceModality?: 'INLOCO' | 'POP_SEDE' | null;
  salePrice?: string | number | null;
  plannedCost?: string | number | null;
  expectedProfit?: string | number | null;
  expectedMargin?: string | number | null;
  isComplete?: boolean;
}

export interface ProjectRevisions {
  proposalCode: string | null;
  currentCodBd: number | null;
  revisions: CommercialRevision[];
}

export async function getProjectRevisions(projectId: string): Promise<ProjectRevisions> {
  const { data } = await apiClient.get<ProjectRevisions>(
    `/acompanhamento/comercial/projetos/${projectId}/revisoes`
  );
  return data;
}

export async function setProjectRevision(projectId: string, codBd: number) {
  const { data } = await apiClient.post(
    `/acompanhamento/comercial/projetos/${projectId}/revisao`,
    { codBd }
  );
  return data;
}
