import { apiClient } from './client';

export type CostParams = Record<string, number | Record<string, number>>;

export interface CostProfile {
  id: string;
  key: string;
  label: string;
  version: number | null;
  params: CostParams | null;
  updatedAt?: string;
}

export interface CostResult {
  remuneracaoBruta: number;
  encargos: number;
  provisoes: number;
  beneficios: number;
  passivoRescisorio: number;
  totalMensal: number;
  custoHora220: number;
  custoHora176: number;
  custoDiaUtil: number;
  periculosidade: number;
  produtividade: number;
  transferencia: number;
  valorHora: number;
  he70: number;
  he100: number;
  dsr: number;
}

export async function getCostProfiles(): Promise<CostProfile[]> {
  const { data } = await apiClient.get<CostProfile[]>('/acompanhamento/custo/perfis');
  return data;
}

export async function saveCostParams(key: string, params: CostParams, note?: string) {
  const { data } = await apiClient.put(`/acompanhamento/custo/perfis/${key}/parametros`, { params, note });
  return data;
}

export async function simulateCost(payload: { profileKey?: string; params?: CostParams; inputs: Record<string, number> }): Promise<CostResult> {
  const { data } = await apiClient.post<CostResult>('/acompanhamento/custo/simular', payload);
  return data;
}
