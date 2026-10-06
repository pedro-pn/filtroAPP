import type { ReportSummary } from '../types/domain';

export interface ReportRegenerationResult {
  savedIds: string[];
  errors: Array<{ id: string; message: string }>;
  warnings: string[];
}

export function canRegenerateReport(report: ReportSummary) {
  const manual = report.specialConditions?.__manualUpload as { uploadedAt?: unknown } | undefined;
  return report.status !== 'SIGNED' && !report.physicalSignedAt && !manual?.uploadedAt
    && !report.reportSignatures?.some(signature => signature.status === 'SIGNED');
}

export async function regenerateSelectedReports(
  ids: string[],
  regenerate: (id: string) => Promise<{ warning?: string } | void>,
  onProgress?: (completed: number, total: number) => void
): Promise<ReportRegenerationResult> {
  const uniqueIds = [...new Set(ids)];
  const result: ReportRegenerationResult = { savedIds: [], errors: [], warnings: [] };
  onProgress?.(0, uniqueIds.length);
  for (const [index, id] of uniqueIds.entries()) {
    try {
      const response = await regenerate(id);
      result.savedIds.push(id);
      if (response?.warning) result.warnings.push(response.warning);
    } catch (error) {
      result.errors.push({ id, message: error instanceof Error ? error.message : 'Não foi possível reemitir o relatório.' });
    }
    onProgress?.(index + 1, uniqueIds.length);
  }
  return result;
}

export function reportRegenerationMessage(result: ReportRegenerationResult) {
  const count = result.savedIds.length;
  const saved = count === 1 ? '1 relatório reemitido.' : `${count} relatórios reemitidos.`;
  const warnings = [...new Set(result.warnings)].join(' ');
  if (!result.errors.length) return [saved, warnings].filter(Boolean).join(' ');
  const reasons = [...new Set(result.errors.map(error => error.message))].join(' ');
  return `${saved} ${result.errors.length} não reemitido(s). ${reasons} ${warnings}`.trim();
}
