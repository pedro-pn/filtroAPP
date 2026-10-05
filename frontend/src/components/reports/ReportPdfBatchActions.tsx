import { downloadReportsBatch } from '../../api/reports';
import { useAuth } from '../../auth/AuthContext';
import { useReportMutations } from '../../hooks/useReports';
import { reportRegenerationMessage } from '../../utils/reportRegeneration';
import { useState } from 'react';
import type { ReportSummary } from '../../types/domain';
import { downloadBlob } from '../../utils/download';
import { Button } from '../ui/ds';
import { useToast } from '../ui/ToastContext';
import { ReportReissueDialog } from './ReportReissueDialog';

type ReportPdfBatchActionsProps = {
  reports: ReportSummary[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  appearance?: 'legacy' | 'design-system';
};

export function ReportPdfBatchActions({
  reports,
  selectedIds,
  onSelectionChange,
  appearance = 'legacy'
}: ReportPdfBatchActionsProps) {
  const showToast = useToast();
  const { user } = useAuth();
  const reportMutations = useReportMutations();
  const [reissueIds, setReissueIds] = useState<string[]>([]);
  const [progress, setProgress] = useState('');
  const visibleIds = reports.map(report => report.id);
  const selectedVisibleIds = selectedIds.filter(id => visibleIds.includes(id));
  const hasSelection = selectedVisibleIds.length > 0;

  async function handleReissue() {
    const result = await reportMutations.regenerateReports.mutateAsync({
      ids: reissueIds,
      onProgress: (completed, total) => setProgress(`${completed}/${total}`)
    });
    onSelectionChange(selectedIds.filter(id => !result.savedIds.includes(id)));
    setReissueIds([]);
    setProgress('');
    showToast(reportRegenerationMessage(result), result.errors.length || result.warnings.length ? 'error' : 'success');
  }

  const reissueDialog = <ReportReissueDialog count={reissueIds.length} submitting={reportMutations.regenerateReports.isPending} progress={progress} onConfirm={() => void handleReissue()} onCancel={() => setReissueIds([])} />;
  const reissueButton = user?.accountType === 'ADMIN' && hasSelection ? (
    <Button variant="secondary" size="sm" aria-label="Reemitir os relatórios selecionados" loading={reportMutations.regenerateReports.isPending} onClick={() => setReissueIds(selectedVisibleIds)}>Reemitir</Button>
  ) : null;

  async function handleDownload() {
    if (!selectedVisibleIds.length) {
      showToast('Selecione ao menos um relatório desta seção.', 'error');
      return;
    }

    showToast('Gerando ZIP...', 'info');
    try {
      const blob = await downloadReportsBatch(selectedVisibleIds, 'pdf');
      downloadBlob(blob, `relatorios_pdf_${new Date().toISOString().slice(0, 10)}.zip`);
      showToast('Download em lote concluído.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível baixar os relatórios.', 'error');
    }
  }

  const selectAllLabel = (
    <>
      <span className="report-batch-action-label report-batch-action-label--full">
        Selecionar todos
      </span>
      <span className="report-batch-action-label report-batch-action-label--compact">
        Todos
      </span>
    </>
  );
  const clearLabel = (
    <>
      <span className="report-batch-action-label report-batch-action-label--full">
        Limpar seleção
      </span>
      <span className="report-batch-action-label report-batch-action-label--compact">
        Limpar
      </span>
    </>
  );
  const downloadLabel = (
    <>
      <span className="report-batch-action-label report-batch-action-label--full">
        Baixar PDF
      </span>
      <span className="report-batch-action-label report-batch-action-label--compact">
        PDF
      </span>
    </>
  );

  if (appearance === 'design-system') {
    return (
      <div className="report-batch-toolbar rdo-manager-listing__batch-toolbar rdo-role-listing__batch-toolbar">
        <span className="report-batch-count" role="status" aria-live="polite">
          {selectedVisibleIds.length} selecionado(s)
        </span>
        <div className="admin-form-actions">
          <Button
            className="report-batch-select-all"
            variant="secondary"
            size="sm"
            aria-label="Selecionar todos"
            onClick={() => onSelectionChange(Array.from(new Set([...selectedIds, ...visibleIds])))}
          >
            {selectAllLabel}
          </Button>
          {hasSelection ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Limpar seleção"
                onClick={() => onSelectionChange(selectedIds.filter(id => !visibleIds.includes(id)))}
              >
                {clearLabel}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                aria-label="Baixar PDF"
                onClick={() => void handleDownload()}
              >
                {downloadLabel}
              </Button>
              {reissueButton}
            </>
          ) : null}
        </div>
        {reissueDialog}
      </div>
    );
  }

  return (
    <div className="report-batch-toolbar">
      <span className="report-batch-count">{selectedVisibleIds.length} selecionado(s)</span>
      <div className="admin-form-actions">
        <button
          className="mini-btn alt"
          type="button"
          aria-label="Selecionar todos"
          onClick={() => onSelectionChange(Array.from(new Set([...selectedIds, ...visibleIds])))}
        >
          {selectAllLabel}
        </button>
        {hasSelection ? (
          <>
            <button
              className="mini-btn alt"
              type="button"
              aria-label="Limpar seleção"
              onClick={() => onSelectionChange(selectedIds.filter(id => !visibleIds.includes(id)))}
            >
              {clearLabel}
            </button>
            <button
              className="mini-btn alt"
              type="button"
              aria-label="Baixar PDF"
              onClick={() => void handleDownload()}
            >
              {downloadLabel}
            </button>
            {reissueButton}
          </>
        ) : null}
      </div>
      {reissueDialog}
    </div>
  );
}

type ReportSelectionCheckboxProps = {
  reportId: string;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
};

export function ReportSelectionCheckbox({ reportId, selectedIds, onSelectionChange }: ReportSelectionCheckboxProps) {
  return (
    <label className="report-select-checkbox" title="Selecionar relatório">
      <input
        type="checkbox"
        checked={selectedIds.includes(reportId)}
        onChange={event => onSelectionChange(event.target.checked
          ? Array.from(new Set([...selectedIds, reportId]))
          : selectedIds.filter(id => id !== reportId))}
      />
    </label>
  );
}
