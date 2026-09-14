import { apiClient, rdoApiPath } from './client';

export type HistoricalServiceType = 'limpeza' | 'pressao' | 'filtragem' | 'flushing';
export interface HistoricalMeasurement {
  serviceType: HistoricalServiceType;
  equipment: string;
  system: string;
  diameter: string;
  quantity: number;
  unit: 'cm' | 'm' | 'L' | 'mL';
}
export interface HistoricalServiceReport {
  id: string;
  projectId: string;
  reportType: 'RLQ' | 'RTP' | 'RCPU';
  sequenceNumber: number;
  reportDate: string;
  items: HistoricalMeasurement[];
  revision: number;
  sourceFileName?: string | null;
  sourceReportId?: string | null;
  sourceConflict?: string | null;
}
export interface HistoricalImportPreview {
  token: string;
  rowCount: number;
  canImport: boolean;
  errors: Array<{ line: number; message: string }>;
  reports: Array<Pick<HistoricalServiceReport, 'reportType' | 'sequenceNumber' | 'reportDate' | 'items' | 'sourceReportId'> & {
    action: 'CREATE' | 'SKIP' | 'CONFLICT';
    error: string | null;
    lines: number[];
  }>;
}
const base = rdoApiPath('/reports/historical-services');
export async function listHistoricalServices(projectId: string) {
  return (await apiClient.get<{ items: HistoricalServiceReport[] }>(`${base}/${encodeURIComponent(projectId)}`)).data.items;
}
export async function previewHistoricalServices(projectId: string, csv: string) {
  return (await apiClient.post<HistoricalImportPreview>(`${base}/${encodeURIComponent(projectId)}/preview`, { csv })).data;
}
export async function importHistoricalServices(projectId: string, csv: string, token: string, fileName: string) {
  return (await apiClient.post<{ created: number; skipped: number }>(`${base}/${encodeURIComponent(projectId)}/import`, { csv, token, fileName })).data;
}
export async function updateHistoricalServices(projectId: string, id: string, csv: string, revision: number) {
  return (await apiClient.put<HistoricalServiceReport>(`${base}/${encodeURIComponent(projectId)}/${encodeURIComponent(id)}`, { csv, revision })).data;
}
export async function downloadHistoricalTemplate() {
  return (await apiClient.get<Blob>(`${base}/template`, { responseType: 'blob' })).data;
}
