import { downloadReportsBatch } from '../../api/reports';
import type { ReportSummary } from '../../types/domain';
import { downloadBlob } from '../../utils/download';
import { useToast } from '../ui/ToastContext';

type ReportPdfBatchActionsProps = {
  reports: ReportSummary[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
};

export function ReportPdfBatchActions({ reports, selectedIds, onSelectionChange }: ReportPdfBatchActionsProps) {
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

  return (
    <div className="report-batch-toolbar">
      <span className="report-batch-count">{selectedVisibleIds.length} selecionado(s)</span>
      <div className="admin-form-actions">
        <button
          className="mini-btn alt"
          type="button"
          onClick={() => onSelectionChange(Array.from(new Set([...selectedIds, ...visibleIds])))}
        >
          Selecionar todos
        </button>
        {hasSelection ? (
          <>
            <button
              className="mini-btn alt"
              type="button"
              onClick={() => onSelectionChange(selectedIds.filter(id => !visibleIds.includes(id)))}
            >
              Limpar seleção
            </button>
            <button className="mini-btn alt" type="button" onClick={() => void handleDownload()}>
              Baixar PDF
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
