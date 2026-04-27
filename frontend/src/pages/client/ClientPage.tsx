import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { downloadReportPdf, downloadReportsBatch } from '../../api/reports';
import { useAuth } from '../../auth/AuthContext';
import { ReportSummaryCard } from '../../components/reports/ReportSummaryCard';
import { ReasonDialog } from '../../components/ui/ReasonDialog';
import { useReportMutations, useReports } from '../../hooks/useReports';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import type { ReportSummary } from '../../types/domain';
import { downloadBlob } from '../../utils/download';

const TEXT = {
  approveSignature: 'Assinar',
  batchDownload: 'Baixar selecionados',
  batchSignature: 'Assinar selecionados',
  availableReports: 'Relat\u00f3rios vis\u00edveis',
  clientPortal: 'Portal do cliente',
  downloadError: 'N\u00e3o foi poss\u00edvel baixar o relat\u00f3rio.',
  loading: 'Carregando relat\u00f3rios...',
  noReports: 'Nenhum relat\u00f3rio dispon\u00edvel para esta conta.',
  noSelection: 'Selecione ao menos um relat\u00f3rio.',
  reject: 'Reprovar',
  rejectReason: 'Informe o motivo da reprova\u00e7\u00e3o do relat\u00f3rio:',
  rejectReasonRequired: 'Informe um motivo para reprovar o relat\u00f3rio.',
  requestSignatureError: 'N\u00e3o foi poss\u00edvel solicitar a assinatura.',
  reviewError: 'N\u00e3o foi poss\u00edvel registrar a avalia\u00e7\u00e3o.',
  signed: 'Assinados',
  signatureRequested: 'Assinatura solicitada. Abra o link para concluir.',
  summary: 'Resumo'
};

export function ClientPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const reportsQuery = useReports();
  const reportMutations = useReportMutations();
  const [message, setMessage] = useState<string | null>(null);
  const [rejectReport, setRejectReport] = useState<ReportSummary | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const reportSummary = useMemo(() => {
    const reports = reportsQuery.data || [];
    return {
      total: reports.length,
      approved: reports.filter(report => report.status === 'APPROVED').length,
      signed: reports.filter(report => report.status === 'SIGNED').length
    };
  }, [reportsQuery.data]);

  const batchSignableReports = useMemo(
    () => (reportsQuery.data || []).filter(report => report.reportType === 'RDO' && report.status === 'APPROVED'),
    [reportsQuery.data]
  );

  const selectedSignableIds = useMemo(
    () => selectedIds.filter(id => batchSignableReports.some(report => report.id === id)),
    [batchSignableReports, selectedIds]
  );

  async function handleLogout() {
    await logout();
    navigate('/', { replace: true });
  }

  async function handleDownloadPdf(report: ReportSummary) {
    setMessage(null);
    try {
      const blob = await downloadReportPdf(report.id);
      downloadBlob(blob, `${report.reportType}_${report.sequenceNumber || report.id}.pdf`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : TEXT.downloadError);
    }
  }

  async function handleBatchDownload() {
    setMessage(null);
    if (!selectedIds.length) {
      setMessage(TEXT.noSelection);
      return;
    }

    try {
      const blob = await downloadReportsBatch(selectedIds, 'pdf');
      downloadBlob(blob, `relatorios_pdf_${new Date().toISOString().slice(0, 10)}.zip`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : TEXT.downloadError);
    }
  }

  async function handleBatchSignature() {
    setMessage(null);
    if (!selectedSignableIds.length) {
      setMessage('Selecione ao menos um RDO aprovado.');
      return;
    }

    try {
      const response = await reportMutations.batchSignature.mutateAsync({ ids: selectedSignableIds });
      setMessage(TEXT.signatureRequested);
      if (response.signUrl) window.open(response.signUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : TEXT.requestSignatureError);
    }
  }

  async function handleRequestSignature(report: ReportSummary) {
    setMessage(null);
    try {
      const response = await reportMutations.requestSignature.mutateAsync({ id: report.id });
      setMessage(TEXT.signatureRequested);
      if (response.signUrl) window.open(response.signUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : TEXT.requestSignatureError);
    }
  }

  async function handleReject(report: ReportSummary, comment: string) {
    setMessage(null);

    try {
      await reportMutations.clientReview.mutateAsync({
        id: report.id,
        payload: { action: 'REJECTED', comment }
      });
      setRejectReport(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : TEXT.reviewError);
    }
  }

  function renderClientActions(report: ReportSummary) {
    const signable = report.reportType === 'RDO' && report.status === 'APPROVED';

    return (
      <>
        <label className="checkbox-line">
          <input
            type="checkbox"
            checked={selectedIds.includes(report.id)}
            onChange={event => {
              const checked = event.target.checked;
              setSelectedIds(current => checked ? [...current, report.id] : current.filter(id => id !== report.id));
            }}
          />
          Selecionar
        </label>
        <button className="secondary-button" type="button" onClick={() => void handleDownloadPdf(report)}>
          PDF
        </button>
        {signable ? (
          <>
            <button className="primary-button" type="button" onClick={() => void handleRequestSignature(report)}>
              {TEXT.approveSignature}
            </button>
            <button className="secondary-button" type="button" onClick={() => setRejectReport(report)}>
              {TEXT.reject}
            </button>
          </>
        ) : null}
      </>
    );
  }

  return (
    <Shell>
      <TopBar
        title={TEXT.clientPortal}
        subtitle={user?.name}
        actions={
          <>
            <button className="topbar-chip" type="button" onClick={() => navigate('/conta')}>
              Conta
            </button>
            <button className="topbar-chip" type="button" onClick={handleLogout}>
              Sair
            </button>
          </>
        }
      />
      <main className="page-scroll">
        <section className="page-card">
          <div className="section-title">{TEXT.summary}</div>
          <div className="stats-grid">
            <div className="stat-card-react">
              <div className="stat-number-react">{reportSummary.total}</div>
              <div className="stat-label-react">{TEXT.availableReports}</div>
            </div>
            <div className="stat-card-react">
              <div className="stat-number-react">{reportSummary.approved}</div>
              <div className="stat-label-react">Aprovados</div>
            </div>
            <div className="stat-card-react">
              <div className="stat-number-react">{reportSummary.signed}</div>
              <div className="stat-label-react">{TEXT.signed}</div>
            </div>
          </div>
        </section>

        {message ? <div className="page-card inline-error">{message}</div> : null}
        {reportsQuery.isLoading ? <div className="page-card placeholder-copy">{TEXT.loading}</div> : null}
        {!reportsQuery.isLoading && !reportSummary.total ? (
          <div className="page-card placeholder-copy">{TEXT.noReports}</div>
        ) : null}
        {reportSummary.total ? (
          <section className="page-card">
            <div className="section-title">Ações em lote</div>
            <div className="admin-form-actions">
              <button className="secondary-button" type="button" onClick={() => setSelectedIds(batchSignableReports.map(report => report.id))}>
                Selecionar RDOs aprovados
              </button>
              <button className="secondary-button" type="button" onClick={() => setSelectedIds([])}>
                Limpar seleção
              </button>
              <button className="secondary-button" type="button" onClick={() => void handleBatchDownload()}>
                {TEXT.batchDownload}
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={reportMutations.batchSignature.isPending}
                onClick={() => void handleBatchSignature()}
              >
                {TEXT.batchSignature}
              </button>
            </div>
            <p className="placeholder-copy">{selectedIds.length} selecionado(s).</p>
          </section>
        ) : null}
        {(reportsQuery.data || []).map(report => (
          <ReportSummaryCard key={report.id} report={report} actions={renderClientActions(report)} />
        ))}
        <ReasonDialog
          open={!!rejectReport}
          title={TEXT.reject}
          description={TEXT.rejectReason}
          label="Motivo"
          confirmLabel={TEXT.reject}
          requiredMessage={TEXT.rejectReasonRequired}
          isSubmitting={reportMutations.clientReview.isPending}
          onCancel={() => setRejectReport(null)}
          onConfirm={reason => {
            if (rejectReport) void handleReject(rejectReport, reason);
          }}
        />
      </main>
    </Shell>
  );
}
