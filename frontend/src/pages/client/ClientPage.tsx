import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { downloadReportPdf, downloadReportsBatch } from '../../api/reports';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { useReportMutations, useReports } from '../../hooks/useReports';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import type { ReportSummary } from '../../types/domain';
import { downloadBlob } from '../../utils/download';
import { formatCnpj } from '../../utils/formatCnpj';
import { compareReportTypes, ProjectSortButton, sortReportsInGroup, type ProjectSortDirection } from '../../utils/projectSort';
import { closeZapSignPendingWindow, openZapSignPendingWindow, redirectZapSignWindow } from '../../utils/zapSign';

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

function projectTitle(report: ReportSummary) {
  return [report.project.code, report.project.name].filter(Boolean).join(' - ') || report.project.name || report.projectId;
}

function clientReviewDateValue(value?: string | null) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}

function formatClientReviewDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('pt-BR');
}

function normalizeClientComment(value?: string | null) {
  return String(value || '')
    .replace(/^justificativa do cliente:\s*/i, '')
    .trim();
}

function clientRejectionReviews(report: ReportSummary) {
  return (report.clientReviews || [])
    .filter(review => review.action === 'REJECTED')
    .sort((a, b) => clientReviewDateValue(b.createdAt) - clientReviewDateValue(a.createdAt));
}

function isClientRejectedReport(report: ReportSummary) {
  const special = report.specialConditions || {};
  const rejectedAt = clientReviewDateValue(typeof special.__clientRejectedAt === 'string' ? special.__clientRejectedAt : null);
  const resolvedAt = clientReviewDateValue(typeof special.__clientRejectionResolvedAt === 'string' ? special.__clientRejectionResolvedAt : null);
  if (rejectedAt) return !resolvedAt || rejectedAt > resolvedAt;

  const latest = report.clientReviews?.[0];
  if (!latest || latest.action !== 'REJECTED') return false;
  if (resolvedAt && clientReviewDateValue(latest.createdAt) <= resolvedAt) return false;
  return report.status !== 'SIGNED';
}

function clientStatusMeta(report: ReportSummary) {
  if (report.status === 'SIGNED') return statusMap.SIGNED;
  if (isClientRejectedReport(report) || report.status === 'RETURNED') {
    return { label: 'Reprovado', className: 'status-returned' };
  }
  return statusMap[report.status] || { label: report.status, className: 'status-pending' };
}

function canSelectClientReport(report: ReportSummary) {
  return !isClientRejectedReport(report) && (report.status === 'APPROVED' || report.status === 'SIGNED');
}

export function ClientPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const reportsQuery = useReports();
  const reportMutations = useReportMutations();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [commentsById, setCommentsById] = useState<Record<string, string>>({});
  const [activeProjectId, setActiveProjectId] = useState('');
  const [activeTypeByProject, setActiveTypeByProject] = useState<Record<string, string>>({});
  const [clientSortDirection, setClientSortDirection] = useState<ProjectSortDirection>('asc');
  const [clientTogglesLoaded, setClientTogglesLoaded] = useState(false);
  const showToast = useToast();
  const clientToggleStorageKey = user ? `filtrovali-client-tabs:${user.id || user.username}` : '';

  const reports = reportsQuery.data || [];
  const clientProjects = useMemo(() => {
    const byProject = new Map<string, { id: string; title: string; clientName: string; cnpj: string; reports: ReportSummary[] }>();
    reports.forEach(report => {
      const current = byProject.get(report.projectId);
      if (current) {
        current.reports.push(report);
        return;
      }
      byProject.set(report.projectId, {
        id: report.projectId,
        title: projectTitle(report),
        clientName: report.project.clientName,
        cnpj: report.project.clientCnpj,
        reports: [report]
      });
    });
    return Array.from(byProject.values()).sort((a, b) => (
      clientSortDirection === 'asc'
        ? a.title.localeCompare(b.title, 'pt-BR', { numeric: true, sensitivity: 'base' })
        : b.title.localeCompare(a.title, 'pt-BR', { numeric: true, sensitivity: 'base' })
    ));
  }, [clientSortDirection, reports]);

  useEffect(() => {
    setClientTogglesLoaded(false);
    if (!clientToggleStorageKey) {
      setClientTogglesLoaded(true);
      return;
    }
    try {
      const stored = localStorage.getItem(clientToggleStorageKey);
      const parsed = stored ? JSON.parse(stored) : null;
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.activeProjectId === 'string') setActiveProjectId(parsed.activeProjectId);
        if (parsed.activeTypeByProject && typeof parsed.activeTypeByProject === 'object' && !Array.isArray(parsed.activeTypeByProject)) {
          setActiveTypeByProject(parsed.activeTypeByProject as Record<string, string>);
        }
      }
    } catch {
      // Ignore unavailable localStorage.
    } finally {
      setClientTogglesLoaded(true);
    }
  }, [clientToggleStorageKey]);

  useEffect(() => {
    if (!clientToggleStorageKey || !clientTogglesLoaded || !activeProjectId) return;
    try {
      localStorage.setItem(clientToggleStorageKey, JSON.stringify({ activeProjectId, activeTypeByProject }));
    } catch {
      // Ignore unavailable localStorage.
    }
  }, [activeProjectId, activeTypeByProject, clientToggleStorageKey, clientTogglesLoaded]);

  useEffect(() => {
    if (!clientTogglesLoaded || reportsQuery.isLoading) return;
    if (!clientProjects.length) {
      if (activeProjectId) setActiveProjectId('');
      return;
    }
    if (!activeProjectId || !clientProjects.some(project => project.id === activeProjectId)) {
      setActiveProjectId(clientProjects[0].id);
    }
  }, [activeProjectId, clientProjects, clientTogglesLoaded, reportsQuery.isLoading]);

  const activeProject = clientProjects.find(project => project.id === activeProjectId) || clientProjects[0] || null;
  const activeTypes = useMemo(
    () => activeProject
      ? Array.from(new Set(activeProject.reports.map(report => report.reportType))).sort(compareReportTypes)
      : [],
    [activeProject]
  );
  const activeReportType = activeProject ? activeTypeByProject[activeProject.id] || activeTypes[0] || 'RDO' : 'RDO';
  const visibleReports = activeProject
    ? sortReportsInGroup(
      activeProject.reports.filter(report => report.reportType === activeReportType),
      clientSortDirection
    )
    : [];

  useEffect(() => {
    setSelectedIds([]);
  }, [activeProjectId, activeReportType]);

  const reportSummary = useMemo(() => {
    return {
      total: reports.length,
      approved: reports.filter(report => report.status === 'APPROVED').length,
      signed: reports.filter(report => report.status === 'SIGNED').length,
      projectCount: new Set(reports.map(report => report.project.id)).size
    };
  }, [reports]);

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
    const label = ids.length === 1 ? '1 relatório' : `${ids.length} relatórios`;
    if (!window.confirm(`Você será redirecionado para a ZapSign para assinar ${label} de uma vez. Deseja continuar?`)) return;

    const signWindow = openZapSignPendingWindow();
    try {
      const selectedComments = ids.reduce<Record<string, string>>((acc, id) => {
        const comment = commentsById[id]?.trim();
        if (comment) acc[id] = comment;
        return acc;
      }, {});
      const response = await reportMutations.batchSignature.mutateAsync({ ids, commentsById: selectedComments });
      if (response.signUrl) {
        redirectZapSignWindow(signWindow, response.signUrl);
        showToast('Lote enviado para assinatura na ZapSign.', 'success');
        return;
      }
      closeZapSignPendingWindow(signWindow);
      throw new Error('Link de assinatura não retornado.');
    } catch (error) {
      closeZapSignPendingWindow(signWindow);
      showToast(error instanceof Error ? error.message : TEXT.requestSignatureError, 'error');
    }
  }

  async function handleRequestSignature(report: ReportSummary) {
    const confirmText = `Você será redirecionado para a ZapSign para assinar digitalmente o ${report.reportType || 'RDO'} nº ${report.sequenceNumber ?? '---'}. Deseja continuar?`;
    if (!window.confirm(confirmText)) return;

    const signWindow = openZapSignPendingWindow();
    try {
      const response = await reportMutations.requestSignature.mutateAsync({
        id: report.id,
        comment: commentsById[report.id]?.trim() || null
      });
      if (response.signUrl) {
        redirectZapSignWindow(signWindow, response.signUrl);
        showToast('Link de assinatura aberto na ZapSign.', 'success');
        return;
      }
      closeZapSignPendingWindow(signWindow);
      throw new Error('Link de assinatura não retornado.');
    } catch (error) {
      closeZapSignPendingWindow(signWindow);
      showToast(error instanceof Error ? error.message : TEXT.requestSignatureError, 'error');
    }
  }

  async function handleReject(report: ReportSummary) {
    if (!window.confirm('Confirmar reprovação deste relatório?')) return;

    try {
      await reportMutations.clientReview.mutateAsync({
        id: report.id,
        payload: { action: 'REJECTED', comment: commentsById[report.id]?.trim() || null }
      });
      showToast('Avaliação registrada.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : TEXT.reviewError, 'error');
    }
  }

  function renderClientReportCard(report: ReportSummary) {
    const clientRejected = isClientRejectedReport(report);
    const signable = report.reportType === 'RDO' && report.status === 'APPROVED' && !clientRejected;
    const selectable = canSelectClientReport(report);
    const signaturePending = signable && Boolean(report.zapsignRequestedAt) && !report.zapsignSignedAt;
    const status = clientStatusMeta(report);
    const rejections = clientRejectionReviews(report);
    const subtitle = clientRejected
      ? 'Reprovado. Aguarde a alteração do gestor.'
      : report.reportType === 'RDO'
        ? 'RDO pronto para conferência do cliente'
        : 'Relatório de serviço liberado após assinatura do RDO';

    return (
      <article className="client-report-card report-card-clickable" key={report.id} onClick={() => navigate(`/cliente/relatorio/${report.id}`)}>
        <div className="client-report-header">
          <div className="client-report-main">
            {selectable ? (
              <label className="client-report-checkbox" onClick={event => event.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(report.id)}
                  onChange={event => toggleSelection(report.id, event.target.checked)}
                />
              </label>
            ) : null}
            <div className="client-report-copy">
              <div className="admin-card-title">{reportLabel(report)} - {formatDate(report.reportDate)}</div>
              <div className="admin-card-subtitle">{report.createdBy?.name || '-'} - {subtitle}</div>
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
              <div className="field-group client-report-comment">
                <label htmlFor={`client-review-comment-${report.id}`}>Comentário do cliente</label>
                <textarea
                  id={`client-review-comment-${report.id}`}
                  rows={3}
                  placeholder="Comentário opcional que será exibido no relatório final"
                  value={commentsById[report.id] || ''}
                  onChange={event => setCommentsById(current => ({ ...current, [report.id]: event.target.value }))}
                />
              </div>
              <button className="primary-button" type="button" onClick={() => void handleRequestSignature(report)}>
                {signaturePending ? 'Continuar assinatura digital' : 'Aprovar e assinar digitalmente'}
              </button>
              <button className="danger-button" type="button" onClick={() => void handleReject(report)}>
                {TEXT.reject}
              </button>
            </>
          ) : null}
        </div>
        {rejections.length ? (
          <div className="client-rejection-list">
            {rejections.map((review, index) => {
              const date = formatClientReviewDate(review.createdAt);
              return (
                <div className="client-rejection-note" key={review.id}>
                  <strong>Reprovação do cliente {date ? `- ${date}` : `#${index + 1}`}:</strong>{' '}
                  {normalizeClientComment(review.comment) || 'Sem comentário'}
                </div>
              );
            })}
          </div>
        ) : null}
        {report.clientReviews?.some(review => review.action === 'APPROVED') ? (
          <div className="det-section">
            {report.clientReviews.filter(review => review.action === 'APPROVED').slice(0, 3).map(review => (
              <div className="det-row" key={review.id}>
                <span className="det-label">Aprovado</span>
                <span className="det-val">{normalizeClientComment(review.comment) || 'Sem comentário'}</span>
              </div>
            ))}
          </div>
        ) : null}
      </article>
    );
  }

  function renderClientTypeActions(typeReports: ReportSummary[]) {
    const typeIds = typeReports.map(report => report.id);
    const selectedTypeIds = selectedIds.filter(id => typeIds.includes(id));
    const signableIds = selectedTypeIds.filter(id =>
      typeReports.some(report => report.id === id && report.reportType === 'RDO' && report.status === 'APPROVED' && !isClientRejectedReport(report))
    );
    const selectableTypeIds = typeReports.filter(canSelectClientReport).map(report => report.id);
    const hasSelection = selectedTypeIds.length > 0;

    return (
      <div className="report-batch-toolbar">
        {hasSelection ? <span className="report-batch-count">{selectedTypeIds.length} selecionado(s)</span> : null}
        <div className="admin-form-actions">
          <button className="secondary-button" type="button" onClick={() => setSelectedIds(current => Array.from(new Set([...current, ...selectableTypeIds])))}>
            Selecionar todos
          </button>
          {hasSelection ? (
            <>
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
            </>
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
        showLogo
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
            <span><strong>Usuário:</strong> {formatCnpj(user?.username) || user?.username || '—'}</span>
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

        {activeProject ? (
          <>
            <section className="page-card compact-link-card">
              <div className="filter-tabs">
                {clientProjects.map(project => (
                  <button
                    className={`filter-tab ${project.id === activeProject.id ? 'active' : ''}`}
                    type="button"
                    key={project.id}
                    onClick={() => setActiveProjectId(project.id)}
                  >
                    {project.title}
                  </button>
                ))}
              </div>
            </section>

            <section className="page-card">
              <div className="section-title">Projeto atual</div>
              <div className="det-section">
                <div className="det-row"><span className="det-label">Projeto</span><span className="det-val">{activeProject.title}</span></div>
                <div className="det-row"><span className="det-label">Cliente</span><span className="det-val">{activeProject.clientName || user?.name || '-'}</span></div>
                <div className="det-row"><span className="det-label">CNPJ</span><span className="det-val">{formatCnpj(activeProject.cnpj) || '-'}</span></div>
                <div className="det-row"><span className="det-label">Relatórios visíveis</span><span className="det-val">{activeProject.reports.length}</span></div>
              </div>
            </section>

            <section className="page-card compact-link-card">
              <div className="filter-tabs">
                {activeTypes.map(reportType => (
                  <button
                    className={`filter-tab ${reportType === activeReportType ? 'active' : ''}`}
                    type="button"
                    key={reportType}
                    onClick={() => {
                      if (!activeProject) return;
                      setActiveTypeByProject(current => ({ ...current, [activeProject.id]: reportType }));
                    }}
                  >
                    {reportType}
                  </button>
                ))}
              </div>
            </section>

            <section className="page-card">
              <div className="admin-section-head">
                <div className="section-title">{activeReportType}</div>
                <ProjectSortButton
                  direction={clientSortDirection}
                  onToggle={() => setClientSortDirection(direction => direction === 'asc' ? 'desc' : 'asc')}
                />
              </div>
              {renderClientTypeActions(visibleReports)}
              {visibleReports.length ? (
                <div className="report-type-list">
                  {visibleReports.map(report => renderClientReportCard(report))}
                </div>
              ) : (
                <p className="placeholder-copy">Nenhum relatório deste tipo.</p>
              )}
            </section>
          </>
        ) : null}
      </main>
    </Shell>
  );
}
