import { apiClient, rdoApiPath } from './client';

export interface AdequacaoConfig {
  disponivel: boolean;
  maxCaracteres: number;
}

export interface AdequacaoResultado {
  textoFormatado: string;
  avisos: string[];
}

export async function fetchAdequacaoConfig() {
  const { data } = await apiClient.get<AdequacaoConfig>(rdoApiPath('/anotacoes/config'));
  return data;
}

export async function adequarAnotacao(anotacao: string, signal?: AbortSignal) {
  const { data } = await apiClient.post<AdequacaoResultado>(rdoApiPath('/anotacoes/adequar'), { anotacao }, { signal });
  return data;
}
