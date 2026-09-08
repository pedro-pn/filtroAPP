import { lazy, Suspense, useMemo, useState } from 'react';

import { downloadReportPdf } from '../../api/reports';
import { useAuth } from '../../auth/AuthContext';
import { hasAnyModuleRole } from '../../auth/rolePath';
import { useAccumulatedReportsPage } from '../../hooks/useReports';
import type { ReportSummary } from '../../types/domain';
import { downloadBlob } from '../../utils/download';
import { reportDownloadFileName } from '../../utils/reportFileName';
import { GroupedReportList } from '../reports/GroupedReportList';
import { ReportSummaryCard } from '../reports/ReportSummaryCard';
import { Modal } from '../ui/Modal';
import { ReportListSkeleton } from '../ui/Skeleton';
import { useToast } from '../ui/ToastContext';

const REPORT_PAGE_SIZE = 30;
const PdfCanvasViewer = lazy(() => import('./PdfCanvasViewer').then(module => ({ default: module.PdfCanvasViewer })));

interface PdfPreview {
  report: ReportSummary;
  blob: Blob;
}

export function ProjectReportsDialog({
  projectId,
  missionLabel
}: {
  projectId: string;
  missionLabel: string;
}) {
  const { user } = useAuth();
  const showToast = useToast();
  const [open, setOpen] = useState(false);
  const [openingReportId, setOpeningReportId] = useState<string | null>(null);
  const [downloadingReportId, setDownloadingReportId] = useState<string | null>(null);
  const [pdfPreview, setPdfPreview] = useState<PdfPreview | null>(null);
  const canViewReports = hasAnyModuleRole(user, ['rdo:manager', 'rdo:coordinator']);
  const filters = useMemo(() => ({
    summary: true,
    statuses: ['APPROVED', 'SIGNED'],
    projectId,
    pageSize: REPORT_PAGE_SIZE
  }), [projectId]);
  const reportsQuery = useAccumulatedReportsPage(filters, canViewReports && open);
  const titleId = `project-reports-title-${projectId}`;
  const pdfTitleId = `project-report-pdf-title-${projectId}`;

  function closePdfPreview() {
    setPdfPreview(null);
  }

  function closeReports() {
    closePdfPreview();
    setOpen(false);
  }

  async function handleOpenPdf(report: ReportSummary) {
    if (openingReportId || downloadingReportId) return;
    setOpeningReportId(report.id);
    try {
      const blob = await downloadReportPdf(report.id);
      setPdfPreview({ report, blob });
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível abrir o PDF.', 'error');
    } finally {
      setOpeningReportId(null);
    }
  }

  async function handleDownload(report: ReportSummary) {
    if (downloadingReportId || openingReportId) return;
    setDownloadingReportId(report.id);
    try {
      const blob = await downloadReportPdf(report.id);
      downloadBlob(blob, reportDownloadFileName(report, 'pdf'));
      showToast('PDF baixado com sucesso.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível baixar o PDF.', 'error');
    } finally {
      setDownloadingReportId(null);
    }
  }

  function handlePreviewDownload() {
    if (!pdfPreview) return;
    downloadBlob(pdfPreview.blob, reportDownloadFileName(pdfPreview.report, 'pdf'));
    showToast('PDF baixado com sucesso.', 'success');
  }

  if (!canViewReports) return null;

  return (
    <>
      <button
        type="button"
        className="mini-btn alt acp-mission-reports-trigger"
        onClick={() => setOpen(true)}
      >
        Relatórios da missão
      </button>
      <Modal
        open={open && !pdfPreview}
        onClose={closeReports}
        closeOnBackdrop
        ariaLabelledBy={titleId}
        panelClassName="modal-card acp-mission-reports-modal"
      >
        <div className="acp-mission-reports-dialog">
          <header className="acp-mission-reports-head">
            <div>
              <h2 id={titleId}>Relatórios da missão</h2>
              <p>{missionLabel}</p>
            </div>
            <button
              type="button"
              className="mini-btn alt"
              aria-label="Fechar relatórios da missão"
              onClick={closeReports}
            >
              Fechar
            </button>
          </header>
          <div className="acp-mission-reports-body">
            {reportsQuery.isLoading ? (
              <ReportListSkeleton groups={1} rowsPerGroup={3} />
            ) : reportsQuery.isError ? (
              <div className="acp-mission-reports-feedback">
                <span className="placeholder-copy">Não foi possível carregar os relatórios desta missão.</span>
                <button type="button" className="mini-btn alt" onClick={() => void reportsQuery.refetch()}>
                  Tentar novamente
                </button>
              </div>
            ) : reportsQuery.items.length === 0 ? (
              <div className="placeholder-copy">Nenhum relatório aprovado ou assinado para esta missão.</div>
            ) : (
              <GroupedReportList
                reports={reportsQuery.items}
                archived={false}
                storageKey={`acp-mission-reports:${user?.id || user?.username || 'anonymous'}:${projectId}`}
                onLoadMoreType={reportsQuery.loadMoreGroup}
                onEnsureTypePage={reportsQuery.ensureGroupPage}
                isTypePageReady={reportsQuery.isGroupPageReady}
                getTypeLoadedCount={reportsQuery.groupLoadedCount}
                hasMoreType={reportsQuery.hasMoreGroup}
                isTypeLoading={reportsQuery.isGroupLoading}
                isTypePageErrored={reportsQuery.isGroupError}
                getTypeTotal={reportsQuery.groupTotal}
                getProjectTypeTotals={reportsQuery.projectTypeTotals}
                renderReport={report => (
                  <ReportSummaryCard
                    key={report.id}
                    report={report}
                    allowOpenDetail={false}
                    actions={(
                      <span className="report-download-actions">
                        <button
                          type="button"
                          className="mini-btn"
                          disabled={openingReportId !== null || downloadingReportId !== null}
                          onClick={() => void handleOpenPdf(report)}
                        >
                          {openingReportId === report.id ? 'Abrindo...' : 'Abrir PDF'}
                        </button>
                        <button
                          type="button"
                          className="mini-btn alt"
                          disabled={downloadingReportId !== null || openingReportId !== null}
                          onClick={() => void handleDownload(report)}
                        >
                          {downloadingReportId === report.id ? 'Baixando...' : 'Baixar PDF'}
                        </button>
                      </span>
                    )}
                  />
                )}
              />
            )}
          </div>
        </div>
      </Modal>
      <Modal
        open={Boolean(pdfPreview)}
        onClose={closePdfPreview}
        ariaLabelledBy={pdfTitleId}
        panelClassName="modal-card acp-pdf-viewer-modal"
      >
        {pdfPreview ? (
          <div className="acp-pdf-viewer">
            <header className="acp-pdf-viewer-head">
              <div>
                <h2 id={pdfTitleId}>Visualizar PDF</h2>
                <p>{pdfPreview.report.reportType} {pdfPreview.report.sequenceNumber || ''} · {missionLabel}</p>
              </div>
              <div className="acp-pdf-viewer-actions">
                <button type="button" className="mini-btn" onClick={handlePreviewDownload}>Baixar PDF</button>
                <button type="button" className="mini-btn alt" onClick={closePdfPreview}>Fechar</button>
              </div>
            </header>
            <Suspense fallback={<div className="acp-pdf-viewer-loading">Preparando visualizador...</div>}>
              <PdfCanvasViewer blob={pdfPreview.blob} />
            </Suspense>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
