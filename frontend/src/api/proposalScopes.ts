import { apiClient } from './client';
import type { ProjectProgress } from './acompanhamentoComercial';
export interface ProposalScope {
  key: string;
  proposalCode: string | null;
  source: string;
  kind: 'MAIN' | 'ADDITIONAL';
  revision: number | null;
  parentProposalCode: string | null;
  label: string;
  version?: string;
}
export interface ProposalScopeService {
  reportId: string; reportType: string; number: number; date: string; version: string;
  serviceKey: string; serviceType: string; system: string; contributionKey: string | null;
  method: 'MANUAL' | 'INFERRED'; count: number;
}
export interface ProposalScopeTracking {
  scopes: Array<ProposalScope & { progress: ProjectProgress; serviceCount: number }>;
  services: ProposalScopeService[];
  pending: number;
}
const base = (projectId: string) => `/acompanhamento/comercial/projetos/${projectId}/escopos-propostas`;
export async function fetchProposalScopes(projectId: string) {
  const { data } = await apiClient.get<ProposalScopeTracking>(base(projectId));
  return data;
}
export async function assignProposalScope(projectId: string, service: ProposalScopeService, contributionKey: string | null) {
  const { data } = await apiClient.put(`${base(projectId)}/${service.reportId}`, { serviceKey: service.serviceKey, version: service.version, contributionKey });
  return data;
}
