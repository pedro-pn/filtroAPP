import { BrandLoading } from '../../components/brand/BrandLoading';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { driver } from 'driver.js';
import type { DriveStep } from 'driver.js';
import { useQuery } from '@tanstack/react-query';

import { downloadReportPdf, downloadReportsBatch, listClientReportTypeTabs, type ReleasedServiceReportNotification } from '../../api/reports';
import { getClientSurveyLink } from '../../api/surveys';

import { useAuth } from '../../auth/AuthContext';
import { navigationStateFromLocation } from '../../auth/moduleNavigation';
import { rdoPath, rdoReportDetailPath } from '../../auth/rolePath';
import { AppIcon } from '../../components/icons/AppIcon';
import { ClientTutorial } from '../../components/ClientTutorial';
import { PrivacyNotice } from '../../components/privacy/PrivacyNotice';
import { SignatureProgress } from '../../components/reports/SignatureProgress';
import { SignatureDialog } from '../../components/reports/SignatureDialog';
import { useToast } from '../../components/ui/ToastContext';
import { SIGNATURE_RDO_NOTICE_VERSION } from '../../constants/privacy';
import { useAccumulatedReportsPage, useReportMutations } from '../../hooks/useReports';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { usePersistentSearch } from '../../hooks/usePersistentSearch';
import { useInfiniteScrollSentinel } from '../../hooks/useInfiniteScrollSentinel';
import { currentPageScrollState, saveCurrentPageScroll } from '../../hooks/usePageScrollRestoration';
import { InfiniteScrollSentinel } from '../../components/ui/InfiniteScrollSentinel';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Button, Card, MetricCard, SearchInput, StatusPill, type SemanticTone } from '../../components/ui/ds';
import { DS_ICONS } from '../../components/ui/ds/icons';
import { ReportListSkeleton } from '../../components/ui/Skeleton';
import { useProjects } from '../../hooks/useProjects';
import { PageHeader } from '../../layout/PageHeader';
import type { AuthUser } from '../../types/auth';
import type { Project, ReportSummary, SatisfactionSurveySummary } from '../../types/domain';
import { clientCanSignReport, clientSignerPrefillNameForReport } from '../../utils/clientSignature';
import { downloadBlob } from '../../utils/download';
import { isReportManuallyReleased } from '../../utils/reportClientRelease';
import { formatCnpj } from '../../utils/formatCnpj';
import { formatDateOnlyPtBr } from '../../utils/dateOnly';
import { compareReportTypes, sortReportsInGroup, type ProjectSortDirection } from '../../utils/projectSort';
import { ProjectSortButton } from '../../utils/ProjectSortButton';
import { reportDownloadFileName } from '../../utils/reportFileName';
import { handleHorizontalTabListKeyDown } from '../../utils/tabKeyboard';
import { RdoAppShell } from '../RdoAppShell';

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
const REPORT_PAGE_SIZE = 30;
const REPORT_TYPE_VISIBLE_STEP = 10;
const CLIENT_REPORT_REFRESH_MS = 15_000;
const BATCH_SIGNATURE_TIP_STORAGE_KEY_PREFIX = 'filtrovali-client-batch-signature-tip-done';

const statusMap: Record<string, { label: string; tone: SemanticTone }> = {
  PENDING: { label: 'Pendente', tone: 'warning' },
  RETURNED: { label: 'Devolvido', tone: 'danger' },
  APPROVED: { label: 'Aprovado', tone: 'success' },
  SIGNED: { label: 'Assinado', tone: 'info' }
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

function normalizeTutorialKeyPart(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

function clientTutorialUserKey(user?: AuthUser | null) {
  return normalizeTutorialKeyPart(user?.email)
    || normalizeTutorialKeyPart(user?.username)
    || normalizeTutorialKeyPart(user?.clientCnpj)
    || normalizeTutorialKeyPart(user?.id);
}

function clientTutorialLegacyKeys(user?: AuthUser | null) {
  const currentKey = clientTutorialUserKey(user);
  return Array.from(new Set([
    normalizeTutorialKeyPart(user?.id),
    normalizeTutorialKeyPart(user?.username)
  ].filter(key => key && key !== currentKey)));
}

function clientBatchSignatureTipStorageKey(identity: string) {
  return `${BATCH_SIGNATURE_TIP_STORAGE_KEY_PREFIX}:${normalizeTutorialKeyPart(identity)}`;
}

function hasSeenClientBatchSignatureTip(identity: string) {
  try {
    return localStorage.getItem(clientBatchSignatureTipStorageKey(identity)) === '1';
  } catch {
    return false;
  }
}

function markClientBatchSignatureTipSeen(identity: string) {
  try {
    localStorage.setItem(clientBatchSignatureTipStorageKey(identity), '1');
  } catch {
    // Ignore unavailable localStorage; the in-memory guard still avoids repeats in this session.
  }
}

function escapeCssSelectorValue(value: string) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, '\\$&');
}

function reportLabel(report: Pick<ReportSummary, 'reportType' | 'sequenceNumber'>) {
  return report.sequenceNumber ? `${report.reportType} ${report.sequenceNumber}` : report.reportType;
}

function initialSignerNameForReport(report: ReportSummary | undefined, user: ReturnType<typeof useAuth>['user']) {
  return clientSignerPrefillNameForReport(report, user);
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
  if (report.status === 'SIGNED') return report.physicalSignedAt
    ? { label: 'Assinado em papel', tone: 'success' as const }
    : statusMap.SIGNED;
  if (isClientRejectedReport(report) || report.status === 'RETURNED') {
    return { label: 'Reprovado', tone: 'danger' as const };
  }
  return statusMap[report.status] || { label: report.status, tone: 'neutral' as const };
}

function canSelectClientReport(report: ReportSummary) {
  return !isClientRejectedReport(report) && (report.status === 'APPROVED' || report.status === 'SIGNED');
}

export function ClientPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedProjectId = searchParams.get('projeto') || '';
  const { user } = useAuth();
  const projectsQuery = useProjects();
  const reportMutations = useReportMutations();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [commentsById, setCommentsById] = useState<Record<string, string>>({});
  const [activeProjectId, setActiveProjectId] = useState('');
  const [activeTypeByProject, setActiveTypeByProject] = useState<Record<string, string>>({});
  const [closedTypeByProject, setClosedTypeByProject] = useState<Record<string, boolean>>({});
  const [signatureTargetIds, setSignatureTargetIds] = useState<string[]>([]);
  const [signaturePrivacyAccepted, setSignaturePrivacyAccepted] = useState(false);
  const [clientSortDirection, setClientSortDirection] = useState<ProjectSortDirection>('asc');
  const [clientTogglesLoaded, setClientTogglesLoaded] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<ReportSummary | null>(null);
  // Busca persistida: ao abrir um relatório e voltar, o termo da busca é restaurado.
  const [clientSearch, setClientSearch] = usePersistentSearch(`client-search:${user?.id || user?.username || 'anonymous'}`);
  const debouncedClientSearch = useDebouncedValue(clientSearch, 300);
  const [visibleByClientType, setVisibleByClientType] = useState<Record<string, number>>({});
  const [releasedReportCounts, setReleasedReportCounts] = useState<Record<string, number>>({});
  const tutorialTrigger = useRef<(() => void) | null>(null);
  const batchSignatureTipShownRef = useRef(false);
  const clientReportGroupRefreshRef = useRef<Record<string, number>>({});
  const showToast = useToast();
  const clientToggleStorageKey = user ? `filtrovali-client-tabs:${user.id || user.username}` : '';
  const reportsQuery = useAccumulatedReportsPage({
    summary: true,
    search: debouncedClientSearch,
    projectSort: clientSortDirection,
    pageSize: REPORT_PAGE_SIZE
  }, true, {
    refetchInterval: CLIENT_REPORT_REFRESH_MS
  });
  const clientTabsQuery = useQuery({
    queryKey: ['reports', 'client-tabs', user?.id || 'anonymous'],
    queryFn: listClientReportTypeTabs,
    refetchInterval: CLIENT_REPORT_REFRESH_MS
  });

  const reports = reportsQuery.items;
  const reportPagination = reportsQuery.pagination;
  const loadMoreReportsRef = useInfiniteScrollSentinel({
    hasMore: reportsQuery.hasMore,
    isLoading: reportsQuery.isLoadingMore,
    onLoadMore: reportsQuery.loadMore
  });
  const clientProjects = useMemo(() => {
    const byProject = new Map<string, ClientProjectGroup>();
    (projectsQuery.data || []).forEach(project => {
      byProject.set(project.id, {
        id: project.id,
        title: projectDisplayTitle(project),
        clientName: project.clientName,
        cnpj: project.clientCnpj,
        reports: [],
        surveyProject: !project.isActive && latestSurvey(project) ? project : undefined
      });
    });
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
  }, [clientSortDirection, projectsQuery.data, reports]);

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
    if (requestedProjectId) setActiveProjectId(requestedProjectId);
  }, [requestedProjectId]);

  useEffect(() => {
    if (!clientToggleStorageKey || !clientTogglesLoaded) return;
    try {
      localStorage.setItem(clientToggleStorageKey, JSON.stringify({ activeProjectId, activeTypeByProject, closedTypeByProject, clientSortDirection }));
    } catch {
      // Ignore unavailable localStorage.
    }
  }, [activeProjectId, activeTypeByProject, clientSortDirection, clientToggleStorageKey, clientTogglesLoaded, closedTypeByProject]);

  useEffect(() => {
    if (!clientTogglesLoaded || reportsQuery.isLoading || projectsQuery.isLoading) return;
    if (!clientProjects.length) {
      if (activeProjectId) setActiveProjectId('');
      return;
    }
    if (!activeProjectId || !clientProjects.some(project => project.id === activeProjectId)) {
      setActiveProjectId(clientProjects[0].id);
    }
  }, [activeProjectId, projectsQuery.isLoading, clientProjects, clientTogglesLoaded, reportsQuery.isLoading]);

  const activeProject = clientProjects.find(project => project.id === activeProjectId) || clientProjects[0] || null;
  const activeTypes = useMemo(
    () => {
      if (!activeProject) return [];
      const loadedTypes = activeProject.reports.map(report => report.reportType);
      const remoteTypes = reportsQuery.projectTypeTotals(activeProject.id).map(group => group.reportType);
      return Array.from(new Set([...loadedTypes, ...remoteTypes])).sort(compareReportTypes);
    },
    [activeProject, reportsQuery]
  );
  const displayTypes = useMemo(() => {
    const types = new Map<string, boolean>();
    (clientTabsQuery.data || [])
      .filter(tab => tab.projectId === activeProject?.id)
      .forEach(tab => types.set(tab.reportType, tab.available));
    activeTypes.forEach(type => types.set(type, true));
    return [...types].map(([reportType, available]) => ({ reportType, available }))
      .sort((a, b) => compareReportTypes(a.reportType, b.reportType));
  }, [activeProject?.id, activeTypes, clientTabsQuery.data]);
  const selectedType = activeProject ? activeTypeByProject[activeProject.id] : '';
  const activeReportType = selectedType && displayTypes.some(type => type.reportType === selectedType && type.available)
    ? selectedType : displayTypes.find(type => type.available)?.reportType || 'RDO';
  const selectClientProject = useCallback((projectId: string) => {
    setActiveProjectId(projectId);
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      next.set('projeto', projectId);
      return next;
    }, { replace: true, preventScrollReset: true });
  }, [setSearchParams]);
  const navigationSections = useMemo(() => clientProjects.map(project => ({
    id: `project-${project.id}`,
    label: project.title,
    mobileLabel: project.title.split(' - ')[0] || project.title,
    href: `${rdoPath('/cliente')}?projeto=${encodeURIComponent(project.id)}`,
    active: project.id === activeProject?.id,
    badge: (project.surveyProject?.surveys || []).some(isPendingSurvey) ? '!' : undefined,
    onSelect: () => selectClientProject(project.id)
  })), [activeProject?.id, clientProjects, selectClientProject]);
  const mobileReportSections = activeProject ? displayTypes.map(({ reportType, available }) => ({
    id: `report-${reportType.toLowerCase()}`,
    label: reportType,
    href: `${rdoPath('/cliente')}?projeto=${encodeURIComponent(activeProject.id)}`,
    active: available && reportType === activeReportType,
    locked: !available,
    onSelect: () => available
      ? selectClientReportType(activeProject.id, reportType)
      : showToast('Relatório bloqueado devido a assinaturas pendentes.', 'info')
  })) : [];
  const activeTypeKey = activeProject ? `${activeProject.id}-${activeReportType}` : '';
  const loadedTypeReports = activeProject
    ? sortReportsInGroup(
      activeProject.reports.filter(report => report.reportType === activeReportType),
      clientSortDirection
    )
    : [];
  const activeTypeVisibleLimit = activeTypeKey ? visibleByClientType[activeTypeKey] || REPORT_TYPE_VISIBLE_STEP : REPORT_TYPE_VISIBLE_STEP;
  const activeTypeTotal = activeProject ? reportsQuery.groupTotal(activeProject.id, activeReportType) ?? loadedTypeReports.length : loadedTypeReports.length;
  const activeTypeOrderedLoadedCount = activeProject
    ? Math.min(
        reportsQuery.groupLoadedCount(activeProject.id, activeReportType, REPORT_TYPE_VISIBLE_STEP, clientSortDirection),
        activeTypeTotal
      )
    : loadedTypeReports.length;
  const activeTypeNeedsOrderedPage = !!activeProject
    && activeTypeTotal > 0
    && !reportsQuery.isGroupError(activeProject.id, activeReportType)
    && !reportsQuery.isGroupPageReady(activeProject.id, activeReportType, REPORT_TYPE_VISIBLE_STEP, clientSortDirection);
  const activeTypeErrored = !!activeProject && reportsQuery.isGroupError(activeProject.id, activeReportType);
  const activeTypeOrderedReports = loadedTypeReports.slice(0, activeTypeOrderedLoadedCount);
  const visibleReports = activeTypeNeedsOrderedPage ? [] : activeTypeOrderedReports.slice(0, activeTypeVisibleLimit);
  const activeTypeHasLoadedItemsToReveal = !activeTypeNeedsOrderedPage && visibleReports.length < activeTypeOrderedReports.length;
  const activeTypeHasRemoteItemsToLoad = !!activeProject
    && !activeTypeNeedsOrderedPage
    && !activeTypeHasLoadedItemsToReveal
    && activeTypeOrderedLoadedCount < activeTypeTotal;
  const activeTypeIsLoading = !!activeProject && reportsQuery.isGroupLoading(activeProject.id, activeReportType);
  const activeTypeClosed = activeTypeKey ? closedTypeByProject[activeTypeKey] === true : false;

  useEffect(() => {
    setSelectedIds([]);
  }, [activeProjectId, activeReportType, clientSearch]);

  useEffect(() => {
    setVisibleByClientType({});
  }, [clientSearch]);

  useEffect(() => {
    if (!activeProject || !activeReportType || activeTypeClosed || !activeTypes.length) return;
    const refreshKey = `${activeProject.id}-${activeReportType}-${clientSortDirection}`;
    const force = reportsQuery.dataUpdatedAt > 0
      && clientReportGroupRefreshRef.current[refreshKey] !== reportsQuery.dataUpdatedAt;
    if (force) clientReportGroupRefreshRef.current[refreshKey] = reportsQuery.dataUpdatedAt;
    void reportsQuery.ensureGroupPage({
      projectId: activeProject.id,
      reportType: activeReportType,
      pageSize: REPORT_TYPE_VISIBLE_STEP,
      sortDirection: clientSortDirection,
      force
    });
  }, [activeProject, activeReportType, activeTypeClosed, activeTypes.length, clientSortDirection, reportsQuery]);

  const reportSummary = useMemo(() => {
    return {
      total: reportPagination?.total ?? reports.length,
      approved: reports.filter(report => report.status === 'APPROVED').length,
      signed: reports.filter(report => report.status === 'SIGNED').length,
      projectCount: clientProjects.length
    };
  }, [clientProjects.length, reportPagination?.total, reports]);
  const tutorialReady = !reportsQuery.isLoading && !projectsQuery.isLoading && clientTogglesLoaded;
  const tutorialUserKey = clientTutorialUserKey(user);
  const tutorialLegacyUserKeys = useMemo(() => clientTutorialLegacyKeys(user), [user]);

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

  async function handleLoadMoreActiveType() {
    if (!activeProject || !activeTypeKey) return;
    if (activeTypeHasLoadedItemsToReveal) {
      setVisibleByClientType(current => ({
        ...current,
        [activeTypeKey]: (current[activeTypeKey] || REPORT_TYPE_VISIBLE_STEP) + REPORT_TYPE_VISIBLE_STEP
      }));
      return;
    }
    if (activeTypeHasRemoteItemsToLoad) {
      const loaded = await reportsQuery.loadMoreGroup({
        projectId: activeProject.id,
        reportType: activeReportType,
        loadedCount: loadedTypeReports.length,
        pageSize: REPORT_TYPE_VISIBLE_STEP,
        sortDirection: clientSortDirection
      });
      if (loaded === false) return;
      setVisibleByClientType(current => ({
        ...current,
        [activeTypeKey]: (current[activeTypeKey] || REPORT_TYPE_VISIBLE_STEP) + REPORT_TYPE_VISIBLE_STEP
      }));
    }
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

  function handleOpenReportDetail(report: ReportSummary) {
    saveCurrentPageScroll(location, user?.id || user?.username || 'anonymous');
    navigate(rdoReportDetailPath(user, report.id), {
      state: {
        ...(navigationStateFromLocation(location) || {}),
        ...currentPageScrollState()
      }
    });
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

  function showBatchSignatureTipBeforeFirstSignature(report: ReportSummary) {
    if (!tutorialUserKey) return false;
    if (batchSignatureTipShownRef.current || hasSeenClientBatchSignatureTip(tutorialUserKey)) return false;
    if (document.body.classList.contains('driver-active')) return false;

    batchSignatureTipShownRef.current = true;
    markClientBatchSignatureTipSeen(tutorialUserKey);
    setSelectedIds(current => Array.from(new Set([...current, report.id])));

    window.setTimeout(() => {
      const reportIdSelector = escapeCssSelectorValue(report.id);
      const reportSelector = `[data-client-report-id="${reportIdSelector}"]`;
      const checkboxSelector = `[data-client-report-checkbox="${reportIdSelector}"]`;
      const steps: DriveStep[] = [
        {
          element: reportSelector,
          popover: {
            title: 'Assinatura em lote disponível',
            description:
              'Antes de assinar só este relatório, saiba que você pode assinar vários RDOs aprovados de uma vez dentro da conta.',
            side: 'top',
            align: 'start'
          }
        },
        {
          element: document.querySelector(checkboxSelector) ? checkboxSelector : '.client-report-checkbox',
          popover: {
            title: 'Selecione os documentos',
            description:
              'Marque este RDO e os outros relatórios aprovados que deseja assinar no mesmo envio.',
            side: 'right',
            align: 'start'
          }
        },
        {
          element: '.report-batch-toolbar',
          popover: {
            title: 'Controle da seleção',
            description:
              'Nesta barra você pode selecionar todos os relatórios visíveis, limpar a seleção ou baixar os PDFs escolhidos.',
            side: 'top',
            align: 'start'
          }
        }
      ];

      if (document.querySelector('[data-client-batch-signature-button]')) {
        steps.push({
          element: '[data-client-batch-signature-button]',
          popover: {
            title: 'Assinar selecionados',
            description:
              'Clique aqui para abrir a assinatura com todos os RDOs selecionados. O relatório atual já ficou marcado para facilitar.',
            side: 'top',
            align: 'end',
            doneBtnText: 'Entendi'
          }
        });
      }

      const driverObj = driver({
        showProgress: true,
        progressText: '{{current}} de {{total}}',
        nextBtnText: 'Próximo →',
        prevBtnText: '← Anterior',
        doneBtnText: 'Entendi',
        allowClose: true,
        animate: true,
        smoothScroll: true,
        overlayOpacity: 0.6,
        steps
      });
      driverObj.drive();
    }, 150);

    return true;
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
          signatureImageDataUrl,
          privacyNoticeAccepted: true,
          privacyNoticeVersion: SIGNATURE_RDO_NOTICE_VERSION
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
      setSignaturePrivacyAccepted(false);
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
    if (showBatchSignatureTipBeforeFirstSignature(report)) return;
    setSignatureTargetIds([report.id]);
  }

  const signatureTargetReport = useMemo(
    () => activeProject?.reports.find(report => report.id === signatureTargetIds[0]),
    [activeProject?.reports, signatureTargetIds]
  );
  const initialSignerName = initialSignerNameForReport(signatureTargetReport, user);

  function requestReject(report: ReportSummary) {
    const comment = commentsById[report.id]?.trim();
    if (!comment) {
      showToast(TEXT.rejectRequired, 'error');
      return;
    }
    setRejectTarget(report);
  }

  async function handleReject(report: ReportSummary) {
    const comment = commentsById[report.id]?.trim();
    if (!comment) return;
    setRejectTarget(null);
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
    const signable = clientCanSignReport(report, user, clientRejected);
    const selectable = canSelectClientReport(report);
    const status = clientStatusMeta(report);
    const rejections = clientRejectionReviews(report);
    const specialRejection = activeSpecialRejection(report);
    const rejectionComments = new Set(rejections.map(review => normalizeClientComment(review.comment)));
    const specialRejectionComment = normalizeClientComment(specialRejection?.comment);
    const approvalComments = (report.clientReviews || [])
      .filter(review => review.action === 'APPROVED')
      .map(review => ({ review, comment: normalizeClientComment(review.comment) }))
      .filter(item => item.comment)
      .slice(0, 3);
    const serviceOnly = report.specialConditions?.serviceOnly === true;
    const subtitle = clientRejected
      ? 'Aguardando correção do gestor'
      : report.reportType === 'RDO'
        ? signable ? 'Pronto para assinar' : 'Disponível para consulta'
        : serviceOnly
          ? 'Relatório de serviço liberado pelo gestor'
          : isReportManuallyReleased(report)
            ? 'Relatório de serviço liberado individualmente pelo gestor'
            : 'Relatório de serviço liberado após assinatura do RDO';

    return (
      <article
        className="client-report-card report-card-clickable"
        key={report.id}
        data-client-report-id={report.id}
        onClick={() => handleOpenReportDetail(report)}
      >
        <div className="client-report-header">
          <div className="client-report-main">
            {selectable ? (
              <label
                className="client-report-checkbox"
                data-client-report-checkbox={report.id}
                onClick={event => event.stopPropagation()}
              >
                <input
                  type="checkbox"
                  aria-label={`Selecionar ${reportLabel(report)} de ${formatDate(report.reportDate)}`}
                  checked={selectedIds.includes(report.id)}
                  onChange={event => toggleSelection(report.id, event.target.checked)}
                />
              </label>
            ) : null}
            <div className="client-report-copy">
              <div className="admin-card-title">{reportLabel(report)} - {formatDate(report.reportDate)}</div>
              <div className="admin-card-subtitle">
                {report.createdBy?.name ? <span className="client-report-author">{report.createdBy.name}</span> : null}
                <span className="client-report-context">{subtitle}</span>
              </div>
            </div>
          </div>
          <StatusPill
            className="client-report-badge"
            status={report.status}
            label={status.label}
            tone={status.tone}
            dot={false}
          />
        </div>
        <div className="client-report-actions" onClick={event => event.stopPropagation()}>
          {signable ? (
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
          ) : null}
          <div className="client-report-action-buttons">
            <Button variant="secondary" size="sm" type="button" onClick={() => void handleDownloadPdf(report)}>
              Baixar PDF
            </Button>
            {signable ? (
              <>
                <Button variant="primary" size="sm" type="button" onClick={() => void handleRequestSignature(report)}>
                  <span className="client-report-action-label--full">Assinar digitalmente</span>
                  <span className="client-report-action-label--compact">Assinar</span>
                </Button>
                <Button variant="danger" size="sm" type="button" onClick={() => requestReject(report)}>
                  {TEXT.reject}
                </Button>
              </>
            ) : null}
          </div>
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
        {approvalComments.length ? (
          <div className="det-section">
            {approvalComments.map(({ review, comment }) => (
              <div className="det-row" key={review.id}>
                <span className="det-label">Comentário da aprovação</span>
                <span className="det-val">{comment}</span>
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
      typeReports.some(report => report.id === id && clientCanSignReport(report, user, isClientRejectedReport(report)))
    );
    const selectableTypeIds = typeReports.filter(canSelectClientReport).map(report => report.id);
    const hasSignableReports = typeReports.some(report => clientCanSignReport(report, user, isClientRejectedReport(report)));
    const hasSelection = selectedTypeIds.length > 0;

    return (
      <div className="report-batch-toolbar rdo-manager-listing__batch-toolbar rdo-role-listing__batch-toolbar">
        <span className="report-batch-count" role="status" aria-live="polite">
          {selectedTypeIds.length} selecionado(s)
        </span>
        <div className="admin-form-actions">
          <Button
            className="report-batch-select-all"
            variant="secondary"
            size="sm"
            aria-label="Selecionar todos"
            onClick={() => setSelectedIds(current => Array.from(new Set([...current, ...selectableTypeIds])))}
          >
            <span className="report-batch-action-label report-batch-action-label--full">
              Selecionar todos
            </span>
            <span className="report-batch-action-label report-batch-action-label--compact">
              Todos
            </span>
          </Button>
          {hasSelection ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Limpar seleção"
                onClick={() => setSelectedIds(current => current.filter(id => !typeIds.includes(id)))}
              >
                <span className="report-batch-action-label report-batch-action-label--full">
                  Limpar seleção
                </span>
                <span className="report-batch-action-label report-batch-action-label--compact">
                  Limpar
                </span>
              </Button>
              <Button
                variant="secondary"
                size="sm"
                aria-label={TEXT.batchDownload}
                onClick={() => void handleBatchDownload(selectedTypeIds)}
              >
                <span className="report-batch-action-label report-batch-action-label--full">
                  {TEXT.batchDownload}
                </span>
                <span className="report-batch-action-label report-batch-action-label--compact">
                  Baixar
                </span>
              </Button>
              {hasSignableReports ? (
                <Button
                  variant="primary"
                  size="sm"
                  data-client-batch-signature-button
                  aria-label={TEXT.batchSignature}
                  disabled={reportMutations.requestSignature.isPending || !signableIds.length}
                  onClick={() => void handleBatchSignature(signableIds)}
                >
                  <span className="report-batch-action-label report-batch-action-label--full">
                    {TEXT.batchSignature}
                  </span>
                  <span className="report-batch-action-label report-batch-action-label--compact">
                    Assinar
                  </span>
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    );
  }

  function renderLoadMoreReports() {
    const showButton = reportsQuery.hasMore || reportsQuery.isLoadingMore;
    return (
      <>
        <div ref={loadMoreReportsRef} aria-hidden="true" />
        {showButton ? (
          <div className="admin-create-toolbar">
            <Button
              variant="secondary"
              size="sm"
              loading={reportsQuery.isLoadingMore}
              disabled={reportsQuery.isLoadingMore}
              onClick={reportsQuery.loadMore}
            >
              {reportsQuery.isLoadingMore ? 'Carregando...' : 'Carregar mais'}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <RdoAppShell title={TEXT.clientPortal} sectionLabel="Relatórios disponíveis" subNavigation={navigationSections} mobileSubNavigation={mobileReportSections} showSingleSectionOnMobile>
      {user && tutorialUserKey && (
        <ClientTutorial
          userKey={tutorialUserKey}
          legacyUserKeys={tutorialLegacyUserKeys}
          ready={tutorialReady}
          triggerRef={tutorialTrigger}
        />
      )}
      <main className="fv-ds rdo-role-page rdo-client-page">
        <PageHeader
          title="Relatórios disponíveis"
          description="Acompanhe as entregas dos seus projetos, baixe documentos e registre sua aprovação."
          actions={(
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<AppIcon icon={DS_ICONS.fileText} size="sm" />}
              onClick={() => tutorialTrigger.current?.()}
            >
              Ver tutorial
            </Button>
          )}
      />
        <Card className="client-welcome-card" padding="md">
          <div className="client-welcome-title">{user?.name || 'Cliente'}</div>
          <div className="client-welcome-subtitle">
            Acompanhe os relatórios liberados e registre sua avaliação.
          </div>
          <div className="client-welcome-meta">
            <span><strong>Usuário:</strong> {formatCnpj(user?.username) || user?.username || '—'}</span>
            <span><strong>E-mail:</strong> {user?.email || '—'}</span>
            <span><strong>Projetos:</strong> {reportSummary.projectCount}</span>
          </div>
        </Card>

        <section className="stats-grid" aria-label={TEXT.summary}>
          <MetricCard label="Disponíveis" value={reportSummary.total} tone="brand" icon={<AppIcon icon={DS_ICONS.fileText} size="md" />} />
          <MetricCard label="Aprovados" value={reportSummary.approved} tone="success" icon={<AppIcon icon={DS_ICONS.alertSuccess} size="md" />} />
          <MetricCard label="Assinados" value={reportSummary.signed} tone="info" icon={<AppIcon icon={DS_ICONS.users} size="md" />} />
        </section>

        {reportsQuery.isLoading || projectsQuery.isLoading ? <ReportListSkeleton /> : null}
        {!reportsQuery.isLoading && !projectsQuery.isLoading && !clientProjects.length ? (
          <Card className="placeholder-copy" padding="lg">{TEXT.noReports}</Card>
        ) : null}

        <Card className="rdo-role-toolbar" padding="sm">
          <div className="rdo-role-toolbar__controls">
            <SearchInput
              aria-label="Buscar relatórios"
              placeholder="Buscar relatórios"
              value={clientSearch}
              onChange={setClientSearch}
            />
          </div>
        </Card>

        {activeProject ? (
          <>
            <Card className="rdo-client-project-summary" title="Projeto atual" padding="md">
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
                      <Button variant="primary" size="sm" type="button" onClick={() => void handleOpenSurvey(activeProject.surveyProject as Project)}>
                        Responder pesquisa
                      </Button>
                    ) : null;
                  })()}
                </div>
              ) : null}
            </Card>

            {displayTypes.length ? <Card className="rdo-client-report-tabs" padding="sm">
                <div className="filter-tabs" role="tablist" aria-label="Tipos de relatório" onKeyDown={handleHorizontalTabListKeyDown}>
                  {displayTypes.map(({ reportType, available }) => {
                    const locked = !available;
                    const releasedCount = releasedReportCounts[releasedReportTabKey(activeProject.id, reportType)] || 0;
                    return (
                      <button
                        className={`filter-tab client-report-type-tab${locked ? ' is-locked' : reportType === activeReportType ? ' active' : ''}`}
                        type="button"
                        key={reportType}
                        role="tab"
                        aria-selected={!locked && reportType === activeReportType}
                        aria-label={locked ? `${reportType}, bloqueado devido a assinaturas pendentes` : releasedCount ? `${reportType}, ${releasedCount} relatório liberado` : reportType}
                        title={locked ? 'Bloqueado devido a assinaturas pendentes' : undefined}
                        data-client-report-tab={`${activeProject.id}-${reportType}`}
                        onClick={() => locked
                          ? showToast('Relatório bloqueado devido a assinaturas pendentes.', 'info')
                          : selectClientReportType(activeProject.id, reportType)}
                      >
                        <span>{reportType}</span>
                        {releasedCount ? <span className="client-report-tab-badge">{releasedCount}</span> : null}
                      </button>
                    );
                  })}
                </div>
              </Card> : clientTabsQuery.isError ? (
                <Card className="placeholder-copy" padding="lg">
                  Não foi possível carregar os tipos de relatório.{' '}
                  <Button variant="secondary" size="sm" onClick={() => void clientTabsQuery.refetch()}>Tentar novamente</Button>
                </Card>
              ) : !clientTabsQuery.isLoading && !reportsQuery.isLoading && !clientSearch.trim() ? (
                <Card className="placeholder-copy" padding="lg">Nenhum relatório disponível neste projeto.</Card>
            ) : null}

            {clientSearch.trim() && !activeProject.reports.length && !reportsQuery.isLoading ? (
              <Card className="placeholder-copy" padding="lg">Nenhum relatório encontrado neste projeto para a busca.</Card>
            ) : null}

            {!clientSearch.trim() && displayTypes.length > 0 && !activeTypes.length && !reportsQuery.isLoading ? (
              <Card className="placeholder-copy" padding="lg">Os relatórios deste projeto aguardam liberação após as assinaturas pendentes.</Card>
            ) : null}

            {activeProject.reports.length ? (
              <Card className="rdo-client-report-section" padding="sm">
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
                    {visibleReports.length} de {activeTypeTotal} relatório{activeTypeTotal !== 1 ? 's' : ''}
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
                    {activeTypeNeedsOrderedPage ? (
                      <div className="placeholder-copy"><BrandLoading label="Carregando relatórios" /></div>
                    ) : null}
                    {activeTypeErrored ? (
                      <div className="placeholder-copy">Não foi possível carregar os relatórios desta aba.</div>
                    ) : null}
                    {visibleReports.length ? (
                      <div className="report-type-list">
                        {visibleReports.map(report => renderClientReportCard(report))}
                      </div>
                    ) : !activeTypeNeedsOrderedPage && !activeTypeErrored ? (
                      <p className="placeholder-copy">Nenhum relatório deste tipo.</p>
                    ) : null}
                    {activeTypeHasLoadedItemsToReveal || activeTypeHasRemoteItemsToLoad ? (
                      <div className="admin-create-toolbar report-type-load-more">
                        <InfiniteScrollSentinel
                          hasMore={(activeTypeHasLoadedItemsToReveal || activeTypeHasRemoteItemsToLoad) && !activeTypeErrored}
                          isLoading={activeTypeIsLoading}
                          onLoadMore={() => void handleLoadMoreActiveType()}
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={activeTypeIsLoading}
                          disabled={activeTypeIsLoading}
                          onClick={() => void handleLoadMoreActiveType()}
                        >
                          {activeTypeIsLoading ? 'Carregando...' : activeTypeErrored ? 'Tentar novamente' : 'Carregar mais'}
                        </Button>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </Card>
            ) : null}
            {renderLoadMoreReports()}
          </>
        ) : !reportsQuery.isLoading && reportSummary.total ? (
          <Card className="placeholder-copy" padding="lg">
            {clientSearch.trim() ? 'Nenhum relatório encontrado.' : TEXT.noReports}
          </Card>
        ) : null}
      </main>
      <SignatureDialog
        open={signatureTargetIds.length > 0}
        appearance="design-system"
        title={signatureTargetIds.length > 1 ? `Assinar ${signatureTargetIds.length} relatórios` : 'Assinar relatório'}
        initialSignerName={initialSignerName}
        allowCachedSignerName={Boolean(initialSignerName)}
        cacheIdentity={user?.email || user?.username || user?.id || ''}
        isSubmitting={reportMutations.requestSignature.isPending}
        confirmDisabled={!signaturePrivacyAccepted}
        confirmDisabledMessage="Confirme a ciência do aviso de privacidade para assinar."
        notice={(
          <PrivacyNotice
            variant="signatureRdo"
            checked={signaturePrivacyAccepted}
            onCheckedChange={setSignaturePrivacyAccepted}
            disabled={reportMutations.requestSignature.isPending}
          />
        )}
        onCancel={() => {
          setSignatureTargetIds([]);
          setSignaturePrivacyAccepted(false);
        }}
        onConfirm={payload => void confirmSignature(payload)}
      />
      <ConfirmDialog
        open={Boolean(rejectTarget)}
        appearance="design-system"
        title="Reprovar relatório?"
        description="O motivo informado será registrado e ficará visível no histórico do relatório."
        highlight={rejectTarget ? `${rejectTarget.reportType} ${rejectTarget.sequenceNumber || ''}`.trim() : undefined}
        confirmLabel="Confirmar reprovação"
        confirmDisabled={reportMutations.clientReview.isPending}
        onCancel={() => setRejectTarget(null)}
        onConfirm={() => rejectTarget && void handleReject(rejectTarget)}
      />
    </RdoAppShell>
  );
}
