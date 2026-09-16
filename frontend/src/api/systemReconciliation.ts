import { apiClient } from './client';
import type { HistoricalMeasurement } from './historicalServices';

export interface ReconciledMeasurement extends HistoricalMeasurement {
  itemIndex: number;
  measurementKey: string;
  reconciliation: {
    status: 'MATCHED' | 'GLOBAL_SCOPE' | 'SOURCE_CONFLICT' | 'NO_SERVICE' | 'NO_QUANTITY' | 'UNMATCHED' | 'NO_SYSTEM_SCOPE' | 'MEASUREMENT_MISMATCH' | 'DIAMETER_MISMATCH';
    message: string;
    matchedSystem: { id: string; equipment: string; name: string } | null;
    compatibleSystemIds: string[];
    suggestedSystemId?: string | null;
  };
}
export interface ReconciledReport {
  id: string; projectId: string; source: 'HISTORICAL' | 'REPORT'; reportType: string; sequenceNumber: number | null;
  reportDate: string; revision: string | number; items: ReconciledMeasurement[]; unappliedLinks?: number;
}
export interface MeasurementSelection {
  source: ReconciledReport['source']; reportId: string; measurementKey: string; revision: string | number;
}
export interface SystemReconciliation {
  project: { id: string; code: string; name: string };
  reports: ReconciledReport[];
}
const base = (projectId: string) => `/acompanhamento/comercial/projetos/${encodeURIComponent(projectId)}/conciliacao`;
export async function getSystemReconciliation(projectId: string) {
  return (await apiClient.get<SystemReconciliation>(base(projectId))).data;
}
export async function saveMeasurementSystems(projectId: string, measurements: MeasurementSelection[], projectSystemId: string | null) {
  return (await apiClient.put<{ saved: number }>(`${base(projectId)}/measurements`, { measurements, projectSystemId })).data;
}
export const systemReconciliationPath = (projectId: string) => `/acompanhamento?section=projetos&project=${encodeURIComponent(projectId)}&reconcile=1`;
