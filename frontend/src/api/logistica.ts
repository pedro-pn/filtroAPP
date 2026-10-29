import { apiClient } from './client';

export interface UnloadingHistory { id: string; tipo: 'PARCIAL' | 'TOTAL'; confirmadaEm: string; confirmadaPorEmail: string }
export interface LogisticsCte { id: string; numero: string; emissao: string; transportadora: string; invoiceId: string | null }
export async function getRomaneioLogistics(id: string) {
  return (await apiClient.get<{ history: UnloadingHistory[]; ctes: LogisticsCte[] }>(`/logistica/romaneios/${encodeURIComponent(id)}`)).data;
}
export async function confirmUnloading(body: { romaneioId: string; tipo: 'PARCIAL' | 'TOTAL'; confirmadaEm: string }, key: string) {
  return (await apiClient.post<UnloadingHistory>('/logistica/descargas', body, { headers: { 'Idempotency-Key': key } })).data;
}
export async function importRomaneioCte(id: string, body: { omieId: string; invoiceId?: string }) {
  return (await apiClient.post<LogisticsCte>(`/logistica/romaneios/${encodeURIComponent(id)}/cte`, body)).data;
}
