import { downloadReportsBatch } from '../../api/reports';
import type { ReportSummary } from '../../types/domain';
import { downloadBlob } from '../../utils/download';
import { Button } from '../ui/ds';
import { useToast } from '../ui/ToastContext';

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
  const visibleIds = reports.map(report => report.id);
  const selectedVisibleIds = selectedIds.filter(id => visibleIds.includes(id));
  const hasSelection = selectedVisibleIds.length > 0;

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
            </>
          ) : null}
        </div>
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
          </>
        ) : null}
      </div>
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
