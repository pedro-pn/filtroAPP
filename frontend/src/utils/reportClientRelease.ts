import type { ToastContextValue } from '../components/ui/ToastContext';
import type { ReportSummary } from '../types/domain';

export function isReportManuallyReleased(report: ReportSummary): boolean {
  return Boolean(report.clientReleasedAt && report.clientReleasedAt === report.updatedAt);
}

export async function toggleReportClientRelease(
  report: ReportSummary,
  submit: (release: boolean) => Promise<unknown>,
  showToast: ToastContextValue['showToast']
): Promise<void> {
  const release = !isReportManuallyReleased(report);
  try {
    await submit(release);
    showToast(release ? 'Relatório de serviço liberado para o cliente.' : 'Liberação individual revogada.', 'success');
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Não foi possível alterar a liberação.', 'error');
  }
}
