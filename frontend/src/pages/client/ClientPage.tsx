import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { downloadReportPdf, downloadReportsBatch } from '../../api/reports';
import { useAuth } from '../../auth/AuthContext';
import { GroupedReportList } from '../../components/reports/GroupedReportList';
import { ReasonDialog } from '../../components/ui/ReasonDialog';
import { useToast } from '../../components/ui/Toast';
import { useReportMutations, useReports } from '../../hooks/useReports';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import type { ReportSummary } from '../../types/domain';
import { downloadBlob } from '../../utils/download';

const TEXT = {
  approveSignature: 'Assinar',
  batchDownload: 'Baixar selecionados',
  batchSignature: 'Assinar selecionados',
  availableReports: 'Relatórios visíveis',
  clientPortal: 'Portal do cliente',
  downloadError: 'Não foi possível baixar o relatório.',
  loading: 'Carregando relatórios...',
  noReports: 'Nenhum relatório disponível para esta conta.',
  noSelection: 'Selecione ao menos um relatório.',
  reject: 'Reprovar',
  rejectReason: 'Informe o motivo da reprovação do relatório:',
  rejectReasonRequired: 'Informe um motivo para reprovar o relatório.',
  requestSignatureError: 'Não foi possível solicitar a assinatura.',
  reviewError: 'Não foi possível registrar a avaliação.',
  signed: 'Assinados',
  signatureRequested: 'Assinatura solicitada. Abra o link para concluir.',
  summary: 'Resumo'
};

const statusMap: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'Pendente', className: 'status-pending' },
  RETURNED: { label: 'Devolvido', className: 'status-returned' },
  APPROVED: { label: 'Aprovado', className: 'status-approved' },
  SIGNED: { label: 'Assinado', className: 'status-signed' }
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('pt-BR');
}

function reportLabel(report: ReportSummary) {
  return report.sequenceNumber ? `${report.reportType} ${report.sequenceNumber}` : report.reportType;
}

export function ClientPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const reportsQuery = useReports();
  const reportMutations = useReportMutations();
  const [rejectReport, setRejectReport] = useState<ReportSummary | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const showToast = useToast();

  const reportSummary = useMemo(() => {
    const reports = reportsQuery.data || [];
    return {
      total: reports.length,
      approved: reports.filter(report => report.status === 'APPROVED').length,
      signed: reports.filter(report => report.status === 'SIGNED').length,
      projectCount: new Set(reports.map(report => report.project.id)).size
    };
  }, [reportsQuery.data]);

  async function handleLogout() {
    await logout();
    navigate('/', { replace: true });
  }

  function toggleSelection(reportId: string, checked: boolean) {
    setSelectedIds(current => {
      const next = checked ? [...current, reportId] : current.filter(id => id !== reportId);
      return Array.from(new Set(next));
    });
  }

  async function handleDownloadPdf(report: ReportSummary) {
    try {
      const blob = await downloadReportPdf(report.id);
      downloadBlob(blob, `${report.reportType}_${report.sequenceNumber || report.id}.pdf`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : TEXT.downloadError, 'error');
    }
  }

  async function handleBatchDownload(ids: string[]) {
    if (!ids.length) {
      showToast(TEXT.noSelection, 'error');
      return;
    }

    try {
      const blob = await downloadReportsBatch(ids, 'pdf');
      downloadBlob(blob, `relatorios_pdf_${new Date().toISOString().slice(0, 10)}.zip`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : TEXT.downloadError, 'error');
    }
  }

  async function handleBatchSignature(ids: string[]) {
    if (!ids.length) {
      showToast('Selecione ao menos um RDO aprovado.', 'error');
      return;
    }

    try {
      const response = await reportMutations.batchSignature.mutateAsync({ ids });
      showToast(TEXT.signatureRequested, 'success');
      if (response.signUrl) window.open(response.signUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      showToast(error instanceof Error ? error.message : TEXT.requestSignatureError, 'error');
    }
  }

  async function handleRequestSignature(report: ReportSummary) {
    try {
      const response = await reportMutations.requestSignature.mutateAsync({ id: report.id });
      showToast(TEXT.signatureRequested, 'success');
      if (response.signUrl) window.open(response.signUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      showToast(error instanceof Error ? error.message : TEXT.requestSignatureError, 'error');
    }
  }

  async function handleReject(report: ReportSummary, comment: string) {
    try {
      await reportMutations.clientReview.mutateAsync({
        id: report.id,
        payload: { action: 'REJECTED', comment }
      });
      setRejectReport(null);
      showToast('Avaliação registrada.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : TEXT.reviewError, 'error');
    }
  }

  function renderClientReportCard(report: ReportSummary) {
    const signable = report.reportType === 'RDO' && report.status === 'APPROVED';
    const status = statusMap[report.status] || { label: report.status, className: 'status-pending' };

    return (
      <article className="client-report-card report-card-clickable" key={report.id} onClick={() => navigate(`/cliente/relatorio/${report.id}`)}>
        <div className="client-report-header">
          <div className="client-report-main">
            <label className="client-report-checkbox" onClick={event => event.stopPropagation()}>
              <input
                type="checkbox"
                checked={selectedIds.includes(report.id)}
                onChange={event => toggleSelection(report.id, event.target.checked)}
              />
            </label>
            <div className="client-report-copy">
              <div className="admin-card-title">{reportLabel(report)} - {formatDate(report.reportDate)}</div>
              <div className="admin-card-subtitle">{report.arrivalTime} às {report.departureTime}</div>
            </div>
          </div>
          <span className={`status-pill ${status.className} client-report-badge`}>{status.label}</span>
        </div>
        <div className="client-report-actions" onClick={event => event.stopPropagation()}>
          <button className="secondary-button" type="button" onClick={() => void handleDownloadPdf(report)}>
            Baixar PDF
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
        </div>
      </article>
    );
  }

  function renderClientTypeActions(typeReports: ReportSummary[]) {
    const typeIds = typeReports.map(report => report.id);
    const selectedTypeIds = selectedIds.filter(id => typeIds.includes(id));
    const signableIds = selectedTypeIds.filter(id =>
      typeReports.some(report => report.id === id && report.reportType === 'RDO' && report.status === 'APPROVED')
    );

    return (
      <div className="report-batch-toolbar">
        <span className="report-batch-count">{selectedTypeIds.length} selecionado(s)</span>
        <div className="admin-form-actions">
          <button className="secondary-button" type="button" onClick={() => setSelectedIds(current => Array.from(new Set([...current, ...typeIds])))}>
            Selecionar todos
          </button>
          <button className="secondary-button" type="button" onClick={() => setSelectedIds(current => current.filter(id => !typeIds.includes(id)))}>
            Limpar seleção
          </button>
          <button className="secondary-button" type="button" onClick={() => void handleBatchDownload(selectedTypeIds)}>
            {TEXT.batchDownload}
          </button>
          {typeReports[0]?.reportType === 'RDO' ? (
            <button
              className="primary-button"
              type="button"
              disabled={reportMutations.batchSignature.isPending}
              onClick={() => void handleBatchSignature(signableIds)}
            >
              {TEXT.batchSignature}
            </button>
          ) : null}
        </div>
      </div>
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
        <section className="client-welcome-card">
          <div className="section-title">Bem-vindo</div>
          <div className="client-welcome-title">{user?.name || 'Cliente'}</div>
          <div className="client-welcome-subtitle">
            Acompanhe os relatórios liberados e registre a aprovação do cliente.
          </div>
          <div className="client-welcome-meta">
            <span><strong>Usuário:</strong> {user?.username || '—'}</span>
            <span><strong>E-mail:</strong> {user?.email || '—'}</span>
            <span><strong>Projetos vinculados:</strong> {reportSummary.projectCount}</span>
          </div>
        </section>

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

        {reportsQuery.isLoading ? <div className="page-card placeholder-copy">{TEXT.loading}</div> : null}
        {!reportsQuery.isLoading && !reportSummary.total ? (
          <div className="page-card placeholder-copy">{TEXT.noReports}</div>
        ) : null}

        {reportSummary.total ? (
          <GroupedReportList
            reports={[...(reportsQuery.data || [])].sort((a, b) => new Date(b.reportDate).getTime() - new Date(a.reportDate).getTime())}
            renderTypeActions={renderClientTypeActions}
            renderReport={renderClientReportCard}
          />
        ) : null}

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
