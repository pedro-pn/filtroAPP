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
import { Button, EmptyState, Skeleton } from '../ui/ds';
import { useToast } from '../ui/ToastContext';
import './ProjectReportsDialog.css';

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
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="acp-mission-reports-trigger"
        onClick={() => setOpen(true)}
      >
        Ver relatórios
      </Button>
      <Modal
        open={open && !pdfPreview}
        onClose={closeReports}
        closeOnBackdrop
        appearance="design-system"
        title="Relatórios da missão"
        size="lg"
        fullscreenOnMobile={false}
        ariaLabelledBy={titleId}
        panelClassName="acp-mission-reports-modal"
      >
        <div className="acp-mission-reports-dialog">
          <p className="acp-mission-reports-context">{missionLabel}</p>
          <div className="acp-mission-reports-body">
            {reportsQuery.isLoading ? (
              <Skeleton variant="text" lines={7} label="Carregando relatórios da missão" />
            ) : reportsQuery.isError ? (
              <div className="acp-mission-reports-feedback">
                <EmptyState title="Não foi possível carregar os relatórios desta missão." />
                <Button size="sm" variant="secondary" type="button" onClick={() => void reportsQuery.refetch()}>
                  Tentar novamente
                </Button>
              </div>
            ) : reportsQuery.items.length === 0 ? (
              <EmptyState title="Nenhum relatório disponível" description="Esta missão ainda não possui relatório aprovado ou assinado." />
            ) : (
              <GroupedReportList
                appearance="design-system"
                defaultTypeCollapsed
                reports={reportsQuery.items}
                archived={false}
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
                        <Button
                          type="button"
                          size="sm"
                          variant="primary"
                          disabled={openingReportId !== null || downloadingReportId !== null}
                          onClick={() => void handleOpenPdf(report)}
                        >
                          {openingReportId === report.id ? 'Abrindo...' : 'Abrir PDF'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={downloadingReportId !== null || openingReportId !== null}
                          onClick={() => void handleDownload(report)}
                        >
                          {downloadingReportId === report.id ? 'Baixando...' : 'Baixar PDF'}
                        </Button>
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
        appearance="design-system"
        title="Visualizar PDF"
        size="full"
        ariaLabelledBy={pdfTitleId}
        panelClassName="acp-pdf-viewer-modal"
      >
        {pdfPreview ? (
          <div className="acp-pdf-viewer">
            <header className="acp-pdf-viewer-head">
              <p>{pdfPreview.report.reportType} {pdfPreview.report.sequenceNumber || ''} · {missionLabel}</p>
              <div className="acp-pdf-viewer-actions">
                <Button size="sm" variant="primary" type="button" onClick={handlePreviewDownload}>Baixar PDF</Button>
                <Button size="sm" variant="secondary" type="button" onClick={closePdfPreview}>Fechar</Button>
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
