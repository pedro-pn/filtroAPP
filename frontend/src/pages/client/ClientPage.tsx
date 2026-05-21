import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { driver } from 'driver.js';

import { downloadReportPdf, downloadReportsBatch, type ReleasedServiceReportNotification } from '../../api/reports';
import { getClientSurveyLink } from '../../api/surveys';
import { useAuth } from '../../auth/AuthContext';
import { rdoReportDetailPath } from '../../auth/rolePath';
import { ClientTutorial } from '../../components/ClientTutorial';
import { SignatureProgress } from '../../components/reports/SignatureProgress';
import { SignatureConsentDialog } from '../../components/reports/SignatureConsentDialog';
import { useToast } from '../../components/ui/Toast';
import { useReportMutations, useReports } from '../../hooks/useReports';
import { useProjects } from '../../hooks/useProjects';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import type { Project, ReportSummary, SatisfactionSurveySummary } from '../../types/domain';
import { downloadBlob } from '../../utils/download';
import { formatCnpj } from '../../utils/formatCnpj';
import { formatDateOnlyPtBr } from '../../utils/dateOnly';
import { compareReportTypes, ProjectSortButton, sortReportsInGroup, type ProjectSortDirection } from '../../utils/projectSort';
import { reportDownloadFileName } from '../../utils/reportFileName';
import { reportSignatureProgress } from '../../utils/signatureProgress';
import { matchesSearch, reportSearchParts } from '../../utils/search';
import { handleHorizontalTabListKeyDown } from '../../utils/tabKeyboard';

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
  rejectRequired: 'Informe um motivo para reprovar o relatório.',
  requestSignatureError: 'Não foi possível solicitar a assinatura.',
  reviewError: 'Não foi possível registrar a avaliação.',
  signed: 'Assinados',
  signatureRequested: 'Assinatura registrada.',
  summary: 'Resumo'
};

const statusMap: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'Pendente', className: 'status-pending' },
  RETURNED: { label: 'Devolvido', className: 'status-returned' },
  APPROVED: { label: 'Aprovado', className: 'status-approved' },
  SIGNED: { label: 'Assinado', className: 'status-signed' }
};

interface ClientProjectGroup {
  id: string;
  title: string;
  clientName: string;
  cnpj: string;
  reports: ReportSummary[];
  surveyProject?: Project;
}

function releasedReportTabKey(projectId: string, reportType: string) {
  return `${projectId}::${reportType}`;
}

function formatDate(value: string) {
  return formatDateOnlyPtBr(value, value);
}

function reportLabel(report: Pick<ReportSummary, 'reportType' | 'sequenceNumber'>) {
  return report.sequenceNumber ? `${report.reportType} ${report.sequenceNumber}` : report.reportType;
}

function userSignatureEmail(user: ReturnType<typeof useAuth>['user']) {
  const email = String(user?.email || '').trim().toLowerCase();
  if (email) return email;
  const username = String(user?.username || '').trim().toLowerCase();
  return username.includes('@') ? username : '';
}

function initialSignerNameForReport(report: ReportSummary | undefined, user: ReturnType<typeof useAuth>['user']) {
  const email = userSignatureEmail(user);
  const matchingSignature = report?.reportSignatures?.find(signature =>
    String(signature.signerEmail || '').trim().toLowerCase() === email
  );
  return matchingSignature?.signerName || user?.name || report?.project.clientName || '';
}

function projectTitle(report: ReportSummary) {
  return [report.project.code, report.project.name].filter(Boolean).join(' - ') || report.project.name || report.projectId;
}

function projectDisplayTitle(project: Project) {
  return [project.code, project.name].filter(Boolean).join(' - ') || project.name;
}

function releasedReportProjectTitle(report: ReleasedServiceReportNotification) {
  return [report.project?.code, report.project?.name].filter(Boolean).join(' - ') || report.projectId;
}

function latestSurvey(project: Project) {
  return (project.surveys || [])[0] || null;
}

function isPendingSurvey(survey?: SatisfactionSurveySummary | null) {
  return !!survey && !survey.respondedAt && new Date(survey.expiresAt).getTime() > Date.now();
}

function surveyBadge(survey?: SatisfactionSurveySummary | null) {
  if (!survey) return null;
  if (survey.respondedAt) return { label: 'Respondida', className: 'status-approved' };
  if (new Date(survey.expiresAt).getTime() <= Date.now()) return { label: 'Expirada', className: 'status-returned' };
  return { label: 'Pendente', className: 'status-pending' };
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

function activeSpecialRejection(report: ReportSummary) {
  const special = report.specialConditions || {};
  const rejectedAt = clientReviewDateValue(typeof special.__clientRejectedAt === 'string' ? special.__clientRejectedAt : null);
  const resolvedAt = clientReviewDateValue(typeof special.__clientRejectionResolvedAt === 'string' ? special.__clientRejectionResolvedAt : null);
  if (!rejectedAt || report.status === 'SIGNED') return null;
  if (resolvedAt && rejectedAt <= resolvedAt) return null;
  const comment = typeof special.__clientRejectionComment === 'string' ? special.__clientRejectionComment : '';
  return {
    comment,
    createdAt: typeof special.__clientRejectedAt === 'string' ? special.__clientRejectedAt : null
  };
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
  const archivedProjectsQuery = useProjects(false);
  const reportMutations = useReportMutations();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [commentsById, setCommentsById] = useState<Record<string, string>>({});
  const [activeProjectId, setActiveProjectId] = useState('');
  const [activeTypeByProject, setActiveTypeByProject] = useState<Record<string, string>>({});
  const [closedTypeByProject, setClosedTypeByProject] = useState<Record<string, boolean>>({});
  const [signatureTargetIds, setSignatureTargetIds] = useState<string[]>([]);
  const [clientSortDirection, setClientSortDirection] = useState<ProjectSortDirection>('asc');
  const [clientTogglesLoaded, setClientTogglesLoaded] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [releasedReportCounts, setReleasedReportCounts] = useState<Record<string, number>>({});
  const tutorialTrigger = useRef<(() => void) | null>(null);
  const showToast = useToast();
  const clientToggleStorageKey = user ? `filtrovali-client-tabs:${user.id || user.username}` : '';

  const reports = useMemo(() => reportsQuery.data || [], [reportsQuery.data]);
  const visibleClientReports = useMemo(
    () => reports.filter(report => matchesSearch(reportSearchParts(report), clientSearch)),
    [clientSearch, reports]
  );
  const surveyProjects = useMemo(
    () => (archivedProjectsQuery.data || []).filter(project => latestSurvey(project)),
    [archivedProjectsQuery.data]
  );
  const clientProjects = useMemo(() => {
    const byProject = new Map<string, ClientProjectGroup>();
    visibleClientReports.forEach(report => {
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
    surveyProjects.forEach(project => {
      const current = byProject.get(project.id);
      if (current) {
        current.surveyProject = project;
        current.clientName = current.clientName || project.clientName;
        current.cnpj = current.cnpj || project.clientCnpj;
        return;
      }
      byProject.set(project.id, {
        id: project.id,
        title: projectDisplayTitle(project),
        clientName: project.clientName,
        cnpj: project.clientCnpj,
        reports: [],
        surveyProject: project
      });
    });
    return Array.from(byProject.values()).sort((a, b) => (
      clientSortDirection === 'asc'
        ? a.title.localeCompare(b.title, 'pt-BR', { numeric: true, sensitivity: 'base' })
        : b.title.localeCompare(a.title, 'pt-BR', { numeric: true, sensitivity: 'base' })
    ));
  }, [clientSortDirection, surveyProjects, visibleClientReports]);

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
        if (parsed.clientSortDirection === 'asc' || parsed.clientSortDirection === 'desc') {
          setClientSortDirection(parsed.clientSortDirection);
        }
        if (parsed.activeTypeByProject && typeof parsed.activeTypeByProject === 'object' && !Array.isArray(parsed.activeTypeByProject)) {
          setActiveTypeByProject(parsed.activeTypeByProject as Record<string, string>);
        }
        if (parsed.closedTypeByProject && typeof parsed.closedTypeByProject === 'object' && !Array.isArray(parsed.closedTypeByProject)) {
          setClosedTypeByProject(parsed.closedTypeByProject as Record<string, boolean>);
        }
      }
    } catch {
      // Ignore unavailable localStorage.
    } finally {
      setClientTogglesLoaded(true);
    }
  }, [clientToggleStorageKey]);

  useEffect(() => {
    if (!clientToggleStorageKey || !clientTogglesLoaded) return;
    try {
      localStorage.setItem(clientToggleStorageKey, JSON.stringify({ activeProjectId, activeTypeByProject, closedTypeByProject, clientSortDirection }));
    } catch {
      // Ignore unavailable localStorage.
    }
  }, [activeProjectId, activeTypeByProject, clientSortDirection, clientToggleStorageKey, clientTogglesLoaded, closedTypeByProject]);

  useEffect(() => {
    if (!clientTogglesLoaded || reportsQuery.isLoading || archivedProjectsQuery.isLoading) return;
    if (!clientProjects.length) {
      if (activeProjectId) setActiveProjectId('');
      return;
    }
    if (!activeProjectId || !clientProjects.some(project => project.id === activeProjectId)) {
      setActiveProjectId(clientProjects[0].id);
    }
  }, [activeProjectId, archivedProjectsQuery.isLoading, clientProjects, clientTogglesLoaded, reportsQuery.isLoading]);

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
  const activeTypeKey = activeProject ? `${activeProject.id}-${activeReportType}` : '';
  const activeTypeClosed = activeTypeKey ? closedTypeByProject[activeTypeKey] === true : false;

  useEffect(() => {
    setSelectedIds([]);
  }, [activeProjectId, activeReportType]);

  const reportSummary = useMemo(() => {
    return {
      total: reports.length,
      approved: reports.filter(report => report.status === 'APPROVED').length,
      signed: reports.filter(report => report.status === 'SIGNED').length,
      projectCount: new Set([...reports.map(report => report.project.id), ...surveyProjects.map(project => project.id)]).size
    };
  }, [reports, surveyProjects]);

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

  function toggleActiveReportType() {
    if (!activeTypeKey) return;
    setClosedTypeByProject(current => ({ ...current, [activeTypeKey]: !current[activeTypeKey] }));
  }

  function clearReleasedReportCount(projectId: string, reportType: string) {
    const key = releasedReportTabKey(projectId, reportType);
    setReleasedReportCounts(current => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function selectClientReportType(projectId: string, reportType: string) {
    setActiveProjectId(projectId);
    setActiveTypeByProject(current => ({ ...current, [projectId]: reportType }));
    setClosedTypeByProject(current => ({ ...current, [`${projectId}-${reportType}`]: false }));
    clearReleasedReportCount(projectId, reportType);
  }

  function highlightReleasedReportTab(report: ReleasedServiceReportNotification) {
    window.setTimeout(() => {
      const selector = `[data-client-report-tab="${report.projectId}-${report.reportType}"]`;
      const target = document.querySelector(selector);
      const driverObj = driver({
        showProgress: false,
        doneBtnText: 'Entendi',
        allowClose: true,
        animate: true,
        smoothScroll: true,
        overlayOpacity: 0.55,
        steps: [{
          element: target ? selector : '.filter-tabs[aria-label="Tipos de relatório"]',
          popover: {
            title: 'Relatório de serviço liberado',
            description: `${reportLabel(report)} está em ${releasedReportProjectTitle(report)}, na aba ${report.reportType}.`,
            side: 'bottom',
            align: 'center'
          }
        }]
      });
      driverObj.drive();
    }, 250);
  }

  function revealReleasedReport(report: ReleasedServiceReportNotification) {
    setClientSearch('');
    selectClientReportType(report.projectId, report.reportType);
    highlightReleasedReportTab(report);
  }

  async function handleDownloadPdf(report: ReportSummary) {
    try {
      const blob = await downloadReportPdf(report.id);
      downloadBlob(blob, reportDownloadFileName(report, 'pdf'));
    } catch (error) {
      showToast(error instanceof Error ? error.message : TEXT.downloadError, 'error');
    }
  }

  async function handleOpenSurvey(project: Project) {
    try {
      const link = await getClientSurveyLink(project.id);
      const target = new URL(link.url, window.location.origin);
      if (target.origin === window.location.origin) {
        navigate(`${target.pathname}${target.search}${target.hash}`);
      } else {
        window.location.assign(target.toString());
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível abrir a pesquisa.', 'error');
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

  function handleBatchSignature(ids: string[]) {
    if (!ids.length) {
      showToast('Selecione ao menos um RDO aprovado.', 'error');
      return;
    }
    setSignatureTargetIds(ids);
  }

  async function confirmSignature({
    signerName,
    signatureImageDataUrl
  }: {
    signerName: string;
    signatureImageDataUrl: string;
  }) {
    const ids = signatureTargetIds;
    if (!ids.length) return;
    try {
      const selectedComments = ids.reduce<Record<string, string>>((acc, id) => {
        const comment = commentsById[id]?.trim();
        if (comment) acc[id] = comment;
        return acc;
      }, {});
      const releasedReportsById = new Map<string, ReleasedServiceReportNotification>();
      for (const id of ids) {
        const result = await reportMutations.requestSignature.mutateAsync({
          id,
          comment: selectedComments[id] || null,
          signerName,
          signatureImageDataUrl
        });
        (result.releasedServiceReports || []).forEach(report => releasedReportsById.set(report.id, report));
      }
      const releasedReports = Array.from(releasedReportsById.values());
      if (releasedReports.length) {
        setReleasedReportCounts(current => {
          const next = { ...current };
          releasedReports.forEach(report => {
            const key = releasedReportTabKey(report.projectId, report.reportType);
            next[key] = (next[key] || 0) + 1;
          });
          return next;
        });
        revealReleasedReport(releasedReports[0]);
      }
      setSignatureTargetIds([]);
      showToast(
        releasedReports.length
          ? `${releasedReports.length} relatório${releasedReports.length !== 1 ? 's' : ''} de serviço liberado${releasedReports.length !== 1 ? 's' : ''}.`
          : ids.length === 1 ? TEXT.signatureRequested : 'Assinatura eletrônica registrada para os relatórios selecionados.',
        'success'
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : TEXT.requestSignatureError, 'error');
    }
  }

  function handleRequestSignature(report: ReportSummary) {
    setSignatureTargetIds([report.id]);
  }

  const signatureTargetReport = useMemo(
    () => activeProject?.reports.find(report => report.id === signatureTargetIds[0]),
    [activeProject?.reports, signatureTargetIds]
  );
  const initialSignerName = initialSignerNameForReport(signatureTargetReport, user);

  async function handleReject(report: ReportSummary) {
    const comment = commentsById[report.id]?.trim();
    if (!comment) {
      showToast(TEXT.rejectRequired, 'error');
      return;
    }
    if (!window.confirm('Confirmar reprovação deste relatório?')) return;

    try {
      await reportMutations.clientReview.mutateAsync({
        id: report.id,
        payload: { action: 'REJECTED', comment }
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
    const signatureProgress = reportSignatureProgress(report);
    const signaturePending = signable && signatureProgress
      ? signatureProgress.signed < signatureProgress.total
      : false;
    const status = clientStatusMeta(report);
    const rejections = clientRejectionReviews(report);
    const specialRejection = activeSpecialRejection(report);
    const rejectionComments = new Set(rejections.map(review => normalizeClientComment(review.comment)));
    const specialRejectionComment = normalizeClientComment(specialRejection?.comment);
    const serviceOnly = report.specialConditions?.serviceOnly === true;
    const subtitle = clientRejected
      ? 'Reprovado. Aguarde a alteração do gestor.'
      : report.reportType === 'RDO'
        ? 'RDO pronto para conferência do cliente'
        : serviceOnly
          ? 'Relatório de serviço liberado pelo gestor'
          : 'Relatório de serviço liberado após assinatura do RDO';

    return (
      <article className="client-report-card report-card-clickable" key={report.id} onClick={() => navigate(rdoReportDetailPath(user, report.id))}>
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
                {signaturePending ? 'Continuar assinatura eletrônica' : 'Aprovar e assinar eletronicamente'}
              </button>
              <button className="danger-button" type="button" onClick={() => void handleReject(report)}>
                {TEXT.reject}
              </button>
            </>
          ) : null}
        </div>
        <SignatureProgress report={report} />
        {rejections.length || specialRejectionComment ? (
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
            {specialRejectionComment && !rejectionComments.has(specialRejectionComment) ? (
              <div className="client-rejection-note">
                <strong>Reprovação do cliente {formatClientReviewDate(specialRejection?.createdAt) ? `- ${formatClientReviewDate(specialRejection?.createdAt)}` : ''}:</strong>{' '}
                {specialRejectionComment}
              </div>
            ) : null}
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
                  disabled={reportMutations.requestSignature.isPending}
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

  const tutorialReady = !reportsQuery.isLoading && !archivedProjectsQuery.isLoading && clientTogglesLoaded;

  return (
    <Shell>
      {user && (
        <ClientTutorial
          userId={user.id || user.username}
          ready={tutorialReady}
          triggerRef={tutorialTrigger}
        />
      )}
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
          <div className="client-welcome-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => tutorialTrigger.current?.()}
            >
              Ver tutorial
            </button>
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

        {reportsQuery.isLoading || archivedProjectsQuery.isLoading ? <div className="page-card placeholder-copy">{TEXT.loading}</div> : null}
        {!reportsQuery.isLoading && !archivedProjectsQuery.isLoading && !reportSummary.total && !surveyProjects.length ? (
          <div className="page-card placeholder-copy">{TEXT.noReports}</div>
        ) : null}

        <section className="page-card">
          <div className="admin-search-row">
            <input
              aria-label="Buscar relatórios"
              placeholder="Buscar relatórios"
              value={clientSearch}
              onChange={event => setClientSearch(event.target.value)}
            />
          </div>
        </section>

        {activeProject ? (
          <>
            <section className="page-card compact-link-card">
              <div className="filter-tabs" role="tablist" aria-label="Projetos do cliente" onKeyDown={handleHorizontalTabListKeyDown}>
                {clientProjects.map(project => {
                  const hasPendingSurvey = (project.surveyProject?.surveys || []).some(isPendingSurvey);
                  return (
                    <button
                      className={`filter-tab client-project-tab ${project.id === activeProject.id ? 'active' : ''}`}
                      type="button"
                      key={project.id}
                      role="tab"
                      aria-selected={project.id === activeProject.id}
                      aria-label={hasPendingSurvey ? `${project.title}, pesquisa pendente` : project.title}
                      onClick={() => setActiveProjectId(project.id)}
                    >
                      <span className="client-project-tab-title">{project.title}</span>
                      {hasPendingSurvey ? (
                        <>
                          <span className="client-project-pending-dot" aria-hidden="true" />
                          <span className="visually-hidden">Pesquisa pendente</span>
                        </>
                      ) : null}
                    </button>
                  );
                })}
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
              {activeProject.surveyProject ? (
                <div className="survey-project-panel">
                  <div>
                    <div className="admin-card-title">Pesquisa de satisfação</div>
                    <div className="admin-card-meta">
                      {(activeProject.surveyProject.surveys || []).map(survey => {
                        const badge = surveyBadge(survey);
                        return badge ? (
                          <span className={`status-pill ${badge.className}`} key={survey.id}>
                            {badge.label} - {formatDateOnlyPtBr(survey.respondedAt || survey.sentAt || survey.createdAt)}
                          </span>
                        ) : null;
                      })}
                    </div>
                  </div>
                  {(() => {
                    const survey = latestSurvey(activeProject.surveyProject);
                    return isPendingSurvey(survey) ? (
                      <button className="primary-button" type="button" onClick={() => void handleOpenSurvey(activeProject.surveyProject as Project)}>
                        Responder pesquisa
                      </button>
                    ) : null;
                  })()}
                </div>
              ) : null}
            </section>

            {activeProject.reports.length ? (
              <section className="page-card compact-link-card">
                <div className="filter-tabs" role="tablist" aria-label="Tipos de relatório" onKeyDown={handleHorizontalTabListKeyDown}>
                  {activeTypes.map(reportType => {
                    const releasedCount = releasedReportCounts[releasedReportTabKey(activeProject.id, reportType)] || 0;
                    return (
                      <button
                        className={`filter-tab client-report-type-tab ${reportType === activeReportType ? 'active' : ''}`}
                        type="button"
                        key={reportType}
                        role="tab"
                        aria-selected={reportType === activeReportType}
                        aria-label={releasedCount ? `${reportType}, ${releasedCount} relatório liberado` : reportType}
                        data-client-report-tab={`${activeProject.id}-${reportType}`}
                        onClick={() => selectClientReportType(activeProject.id, reportType)}
                      >
                        <span>{reportType}</span>
                        {releasedCount ? <span className="client-report-tab-badge">{releasedCount}</span> : null}
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {activeProject.reports.length ? (
              <section className="page-card">
                <div
                  className="report-type-header"
                  onClick={toggleActiveReportType}
                  role="button"
                  tabIndex={0}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      toggleActiveReportType();
                    }
                  }}
                >
                  <span className={`rtype-badge rtype-${activeReportType}`}>{activeReportType}</span>
                  <span className="rtype-count">
                    {visibleReports.length} relatório{visibleReports.length !== 1 ? 's' : ''}
                  </span>
                  <span onClick={event => event.stopPropagation()}>
                    <ProjectSortButton
                      direction={clientSortDirection}
                      onToggle={() => setClientSortDirection(direction => direction === 'asc' ? 'desc' : 'asc')}
                    />
                  </span>
                  <span className="rtype-chevron">{activeTypeClosed ? '▸' : '▾'}</span>
                </div>
                {!activeTypeClosed ? (
                  <>
                    {renderClientTypeActions(visibleReports)}
                    {visibleReports.length ? (
                      <div className="report-type-list">
                        {visibleReports.map(report => renderClientReportCard(report))}
                      </div>
                    ) : (
                      <p className="placeholder-copy">Nenhum relatório deste tipo.</p>
                    )}
                  </>
                ) : null}
              </section>
            ) : null}
          </>
        ) : !reportsQuery.isLoading && reportSummary.total ? (
          <div className="page-card placeholder-copy">
            {clientSearch.trim() ? 'Nenhum relatório encontrado.' : TEXT.noReports}
          </div>
        ) : null}
      </main>
      <SignatureConsentDialog
        open={signatureTargetIds.length > 0}
        title={signatureTargetIds.length > 1 ? `Assinar ${signatureTargetIds.length} relatórios` : 'Assinar relatório'}
        initialSignerName={initialSignerName}
        cacheIdentity={user?.email || user?.username || user?.id || ''}
        isSubmitting={reportMutations.requestSignature.isPending}
        onCancel={() => setSignatureTargetIds([])}
        onConfirm={payload => void confirmSignature(payload)}
      />
    </Shell>
  );
}
