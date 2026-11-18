import { apiClient } from './client';

export type CollaboratorAllocationStatus = 'alocado' | 'sede' | 'folga';

export interface CollaboratorAllocationPeriod {
  situacao: Exclude<CollaboratorAllocationStatus, 'folga'>;
  projectId: string | null;
  projeto: string | null;
  inicio: string;
  fim: string;
  dias: number;
}

export interface CollaboratorAllocation {
  situacaoAtual: CollaboratorAllocationStatus;
  projetoAtual: string | null;
  disponivel: boolean;
  periodos: CollaboratorAllocationPeriod[];
}

export interface CollaboratorMonthlyProductivity {
  mes: string;
  hhProdutivas: number;
  acimaDaRef: boolean;
}

export interface AcompanhamentoCollaborator {
  collaboratorId: string;
  code: string;
  name: string;
  role: string;
  isOperational: boolean;
  totalHHprodutivas: number;
  mesesAtivos: number;
  mediaMensal: number | null;
  taxaIndividual: number | null;
  porMes: CollaboratorMonthlyProductivity[];
  alocacao: CollaboratorAllocation;
}

export interface AcompanhamentoColaboradoresResponse {
  year: number;
  refMensal: number;
  taxaGeral: number | null;
  colaboradores: AcompanhamentoCollaborator[];
}

export interface AcompanhamentoColaboradoresParams {
  year: number;
  q?: string;
  disponivel?: boolean;
}

export async function fetchAcompanhamentoColaboradores(
  params: AcompanhamentoColaboradoresParams
): Promise<AcompanhamentoColaboradoresResponse> {
  const { data } = await apiClient.get<AcompanhamentoColaboradoresResponse>('/acompanhamento/colaboradores', {
    params: {
      year: params.year,
      ...(params.q ? { q: params.q } : {}),
      ...(params.disponivel ? { disponivel: true } : {})
    }
  });
  return data;
}
