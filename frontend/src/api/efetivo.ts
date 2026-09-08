import { apiClient } from './client';

export interface EfetivoPeriod {
  ano: number;
  ateMes: number;
}

export interface EfetivoSyncState {
  ultimaSincronizacao: string | null;
  inicioHistorico: string | null;
  fimHistorico: string | null;
}

export interface EfetivoMonthlyEvolution {
  mes: string;
  mediaHH: number | null;
  referencia: number;
  instavel: boolean;
  temFerias: boolean;
}

export interface EfetivoCollaboratorSummary {
  id: string;
  nome: string;
  cargo: string;
  hhAcumuladas: number;
  mediaMensal: number;
  heExcluidas: number;
  mesesAnalisados: number;
  improdutividade: number;
  situacao: 'CONSOLIDADO' | 'PODE_MUDAR' | 'SEM_BASE';
  mesesInstaveis: string[];
  mesesComFerias: string[];
}

export interface EfetivoPendingItem {
  tipo: 'PONTO_SEM_VINCULO' | 'SEM_DADOS_PERIODO' | 'CARGO_NAO_CADASTRADO';
  descricao: string;
  referencia: string | null;
}

export interface EfetivoProductivityResponse {
  referenciaMensalHH: number;
  periodo: EfetivoPeriod;
  sincronizacao: EfetivoSyncState;
  resumo: {
    hhAcumuladas: number;
    mediaMensalEquipe: number | null;
    taxaGeral: number | null;
    pendencias: number;
  };
  evolucaoMensal: EfetivoMonthlyEvolution[];
  colaboradores: EfetivoCollaboratorSummary[];
  pendentes: EfetivoPendingItem[];
}

export interface EfetivoProductivityMonth {
  mes: string;
  hhNormais: number;
  heExcluidas: number;
  mesesEquivalentes: number;
  distanciaReferencia: number;
  ferias: boolean;
  instavel: boolean;
}

export interface EfetivoCollaboratorDetail {
  colaborador: EfetivoCollaboratorSummary;
  meses: EfetivoProductivityMonth[];
}

export interface EfetivoReferenceSetting {
  referenciaMensalHH: number;
  atualizadoEm: string | null;
  atualizadoPor: string | null;
}

export interface EfetivoAbsence {
  id: string;
  collaboratorId: string;
  collaborator: { id: string; name: string; role: string };
  type: 'FERIAS' | 'FOLGA' | 'AFASTAMENTO';
  startDate: string;
  endDate: string;
  note: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface WorkforceAbsenceResult {
  absence: EfetivoAbsence;
  affectedMissionIds: string[];
  calendarRevision: number;
}

export interface EfetivoAbsencePayload {
  collaboratorId: string;
  type?: 'FERIAS' | 'FOLGA' | 'AFASTAMENTO';
  startDate: string;
  endDate: string;
  note?: string | null;
}

export interface EfetivoCollaboratorOption {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
}

export async function getEfetivoProductivity(period: EfetivoPeriod) {
  const { data } = await apiClient.get<EfetivoProductivityResponse>('/efetivo/produtividade', { params: period });
  return data;
}

export async function getEfetivoCollaboratorDetail(collaboratorId: string, period: EfetivoPeriod) {
  const { data } = await apiClient.get<EfetivoCollaboratorDetail>(
    `/efetivo/produtividade/${encodeURIComponent(collaboratorId)}`,
    { params: period }
  );
  return data;
}

export async function getEfetivoReferenceSetting() {
  const { data } = await apiClient.get<EfetivoReferenceSetting>('/efetivo/parametros');
  return data;
}

export async function saveEfetivoReferenceSetting(referenciaMensalHH: number) {
  const { data } = await apiClient.put<EfetivoReferenceSetting>('/efetivo/parametros', { referenciaMensalHH });
  return data;
}

export async function listEfetivoAbsences(filters: { ano: number; collaboratorId?: string }) {
  const { data } = await apiClient.get<EfetivoAbsence[]>('/workforce/absences', {
    params: {
      from: `${filters.ano}-01-01`,
      to: `${filters.ano}-12-31`,
      collaboratorId: filters.collaboratorId
    }
  });
  return data;
}

export async function listEfetivoCollaborators() {
  const { data } = await apiClient.get<EfetivoCollaboratorOption[]>('/efetivo/colaboradores');
  return data;
}

export async function createEfetivoAbsence(payload: EfetivoAbsencePayload) {
  const { data } = await apiClient.post<WorkforceAbsenceResult>('/workforce/absences', payload);
  return data;
}

export async function updateEfetivoAbsence(id: string, version: number, payload: Partial<Omit<EfetivoAbsencePayload, 'collaboratorId'>>) {
  const { data } = await apiClient.patch<WorkforceAbsenceResult>(`/workforce/absences/${encodeURIComponent(id)}`, payload, {
    headers: { 'If-Match-Version': version }
  });
  return data;
}

export async function removeEfetivoAbsence(id: string, version: number) {
  await apiClient.delete(`/workforce/absences/${encodeURIComponent(id)}`, {
    headers: { 'If-Match-Version': version }
  });
}
