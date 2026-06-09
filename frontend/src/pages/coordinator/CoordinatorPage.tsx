import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { downloadReportPdf } from '../../api/reports';
import type { SurveyQuestion, SurveyResponses } from '../../api/surveys';

import { useAuth } from '../../auth/AuthContext';
import { accountPageStateFromPath } from '../../auth/moduleNavigation';
import { rdoPath } from '../../auth/rolePath';
import { GroupedReportList } from '../../components/reports/GroupedReportList';
import { ReportSummaryCard } from '../../components/reports/ReportSummaryCard';
import { ReportListSkeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { useProjects } from '../../hooks/useProjects';
import { useAccumulatedReportsPage, useReportsPage } from '../../hooks/useReports';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { usePersistentSearch } from '../../hooks/usePersistentSearch';
import { useInfiniteScrollSentinel } from '../../hooks/useInfiniteScrollSentinel';
import { InfiniteScrollSentinel } from '../../components/ui/InfiniteScrollSentinel';
import { useSurveys } from '../../hooks/useSurveys';
import { SurveyDashboardOverlay } from '../../components/surveys/SurveyDashboard';
import { MonthlyAllocationDashboardOverlay, StatsDashboardOverlay, StatsOverview } from '../../components/stats/StatsDashboard';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { useRdoStore } from '../../store/rdoStore';
import type { Project, ReportSummary, SatisfactionSurveySummary } from '../../types/domain';
import { downloadBlob } from '../../utils/download';
import { compareReportTypes, ProjectSortButton, sortProjects, sortReportsInGroup, type ProjectSortDirection } from '../../utils/projectSort';
import { reportDownloadFileName } from '../../utils/reportFileName';
import { matchesSearch, projectSearchParts, reportSearchParts } from '../../utils/search';
import { handleHorizontalTabListKeyDown } from '../../utils/tabKeyboard';

type CoordinatorTab = 'pending' | 'approved' | 'archived' | 'nps' | 'estatisticas';
const REPORT_PAGE_SIZE = 50;
const REPORT_TYPE_PAGE_SIZE = 10;

const TEXT = {
  archived: 'Arquivados',
  approved: 'Aprovados',
  coordinatorPanel: 'Painel do coordenador',
  downloadError: 'Não foi possível baixar o relatório.',
  loading: 'Carregando relatórios...',
  noArchived: 'Nenhum relatório arquivado.',
  noApproved: 'Nenhum relatório aprovado.',
  noPending: 'Nenhum relatório pendente.',
  pending: 'Pendentes',
  reports: 'Relatórios'
};

function surveyBadge(survey?: SatisfactionSurveySummary | null) {
  if (!survey) return { label: 'Pesquisa não enviada', className: 'badge badge-pen' };
  if (survey.respondedAt) return { label: 'Pesquisa respondida', className: 'badge badge-ok' };
  if (new Date(survey.expiresAt).getTime() <= Date.now()) return { label: 'Pesquisa expirada', className: 'badge badge-rev' };
  if (survey.reminderOptOutAt) return { label: 'Lembretes cancelados', className: 'badge badge-pen' };
  return { label: 'Pesquisa enviada', className: 'badge badge-pen' };
}

function formatSurveyDate(value?: string | null) {
  if (!value) return 'sem data';
  return new Date(value).toLocaleDateString('pt-BR');
}

function surveyHistoryBadges(project: Project) {
  const surveys = project.surveys || [];
  if (!surveys.length) return [surveyBadge(null)];
  return surveys.map((survey, index) => {
    const badge = surveyBadge(survey);
    const date = formatSurveyDate(survey.respondedAt || survey.sentAt || survey.createdAt);
    return {
      ...badge,
      label: surveys.length > 1 ? `${badge.label} #${surveys.length - index} - ${date}` : `${badge.label} - ${date}`
    };
  });
}

function surveyIsExpired(survey?: SatisfactionSurveySummary | null) {
  return !!survey && !survey.respondedAt && new Date(survey.expiresAt).getTime() <= Date.now();
}

function surveyStatusLabel(survey: SatisfactionSurveySummary) {
  if (survey.respondedAt) return { label: 'Respondida', className: 'status-approved' };
  if (surveyIsExpired(survey)) return { label: 'Expirada', className: 'status-returned' };
  return { label: 'Pendente', className: 'status-pending' };
}

function surveyResponseValue(value: unknown, fallback = 'Não respondido') {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

const legacyNpsResponseLabels: Record<string, string> = {
  nps: 'Probabilidade de recomendar a Filtrovali',
  serviceQuality: 'Qualidade dos serviços prestados',
  communication: 'Comunicação da equipe durante o projeto',
  deadlines: 'Cumprimento de prazos',
  documentation: 'Qualidade da documentação entregue',
  improvement: 'O que podemos melhorar?',
  highlight: 'Algo que gostaria de destacar?'
};

function npsResponseRows(responses?: SurveyResponses | null, questions: SurveyQuestion[] = []) {
  if (questions.length) {
    return questions.map(question => [question.label, surveyResponseValue(responses?.[question.id])]);
  }
  return Object.keys(responses || {}).map(key => [
    legacyNpsResponseLabels[key] || key,
    surveyResponseValue(responses?.[key])
  ]);
}

function npsProjectTitle(survey: SatisfactionSurveySummary & { project?: { code?: string; name?: string } | null }) {
  return [survey.project?.code, survey.project?.name].filter(Boolean).join(' - ') || 'Projeto não informado';
}

function npsProjectKey(survey: SatisfactionSurveySummary & { project?: { id?: string } | null }) {
  return survey.project?.id || survey.projectId || survey.id;
}

export function CoordinatorPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { reset } = useRdoStore();
  const [tab, setTab] = useState<CoordinatorTab>('pending');
  // Busca persistida por aba: ao voltar (de outra aba ou do detalhe), restaura o termo da aba.
  const [search, setSearch] = usePersistentSearch(`coordinator-search:${user?.id || 'anonymous'}:${tab}`);
  // Só o valor enviado às queries é adiado; a filtragem client-side segue instantânea.
  const debouncedSearch = useDebouncedValue(search, 300);
  const [projectSortDir, setProjectSortDir] = useState<ProjectSortDirection>('asc');
  const [npsSortDir, setNpsSortDir] = useState<ProjectSortDirection>('asc');
  const [openSurveyId, setOpenSurveyId] = useState<string | null>(null);
  const [npsDashboardOpen, setNpsDashboardOpen] = useState(false);
  const [statsDashboardOpen, setStatsDashboardOpen] = useState(false);
  const [allocationDashboardOpen, setAllocationDashboardOpen] = useState(false);
  const [closedArchivedProjectIds, setClosedArchivedProjectIds] = useState<string[]>([]);
  const [closedArchivedTypeKeys, setClosedArchivedTypeKeys] = useState<string[]>([]);
  const [archivedVisibleByType, setArchivedVisibleByType] = useState<Record<string, number>>({});
  const [archivedTypeSortDirections, setArchivedTypeSortDirections] = useState<Record<string, ProjectSortDirection>>({});
  const showToast = useToast();
  const pendingReportFilters = {
    summary: true,
    statuses: ['PENDING', 'RETURNED'],
    projectActive: true,
    createdByUserId: user?.id || '',
    search: debouncedSearch,
    projectSort: projectSortDir,
    pageSize: REPORT_PAGE_SIZE
  };
  const approvedReportFilters = {
    summary: true,
    statuses: ['APPROVED', 'SIGNED'],
    projectActive: true,
    search: debouncedSearch,
    projectSort: projectSortDir,
    pageSize: REPORT_PAGE_SIZE
  };
  const archivedReportFilters = {
    summary: true,
    statuses: ['APPROVED', 'SIGNED'],
    projectActive: false,
    search: debouncedSearch,
    projectSort: projectSortDir,
    pageSize: REPORT_PAGE_SIZE
  };
  const pendingReportsQuery = useAccumulatedReportsPage(pendingReportFilters, tab === 'pending');
  const approvedReportsQuery = useAccumulatedReportsPage(approvedReportFilters, tab === 'approved');
  const archivedReportsQuery = useAccumulatedReportsPage(archivedReportFilters, tab === 'archived');
  const reportsQuery = tab === 'pending'
    ? pendingReportsQuery
    : tab === 'archived'
      ? archivedReportsQuery
      : approvedReportsQuery;
  const loadMoreReportsRef = useInfiniteScrollSentinel({
    hasMore: reportsQuery.hasMore,
    isLoading: reportsQuery.isLoadingMore,
    onLoadMore: reportsQuery.loadMore
  });
  const pendingCountQuery = useReportsPage({
    summary: true,
    statuses: ['PENDING', 'RETURNED'],
    projectActive: true,
    createdByUserId: user?.id || '',
    page: 1,
    pageSize: 1
  });
  const archivedProjectsQuery = useProjects(false);
  const surveysQuery = useSurveys();

  const visibleReports = reportsQuery.items;
  const reportPagination = reportsQuery.pagination;
  const pendingReportCount = tab === 'pending'
    ? reportPagination?.total ?? visibleReports.length
    : pendingCountQuery.data?.pagination.total ?? 0;

  useEffect(() => {
    if (tab !== 'archived') return;
    const archivedProjects = (archivedProjectsQuery.data || []).filter(project => project.isActive === false);
    archivedProjects.forEach(project => {
      if (closedArchivedProjectIds.includes(project.id)) return;
      reportsQuery.projectTypeTotals(project.id).forEach(typeTotal => {
        const typeKey = `${project.id}-${typeTotal.reportType}`;
        if (closedArchivedTypeKeys.includes(typeKey)) return;
        void reportsQuery.ensureGroupPage({
          projectId: project.id,
          reportType: typeTotal.reportType,
          pageSize: REPORT_TYPE_PAGE_SIZE,
          sortDirection: archivedTypeSortDirections[typeKey] || 'asc'
        });
      });
    });
  }, [
    archivedProjectsQuery.data,
    archivedTypeSortDirections,
    closedArchivedProjectIds,
    closedArchivedTypeKeys,
    reportsQuery,
    tab
  ]);

  async function handleLogout() {
    await logout();
    navigate('/', { replace: true });
  }

  function handleNewReport() {
    reset();
    navigate(rdoPath('/relatorio/novo'));
  }

  async function handleDownloadPdf(report: ReportSummary) {
    showToast('Gerando PDF...', 'info');
    try {
      const blob = await downloadReportPdf(report.id);
      downloadBlob(blob, reportDownloadFileName(report, 'pdf'));
      showToast('PDF gerado com sucesso.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : TEXT.downloadError, 'error');
    }
  }

  function toggleArchivedProject(projectId: string) {
    setClosedArchivedProjectIds(current =>
      current.includes(projectId) ? current.filter(id => id !== projectId) : [...current, projectId]
    );
  }

  function toggleArchivedType(typeKey: string) {
    setClosedArchivedTypeKeys(current =>
      current.includes(typeKey) ? current.filter(id => id !== typeKey) : [...current, typeKey]
    );
  }

  function toggleArchivedTypeSort(typeKey: string) {
    setArchivedTypeSortDirections(current => ({
      ...current,
      [typeKey]: (current[typeKey] || 'asc') === 'asc' ? 'desc' : 'asc'
    }));
  }

  function visibleArchivedTypeLimit(typeKey: string) {
    return archivedVisibleByType[typeKey] || REPORT_TYPE_PAGE_SIZE;
  }

  function revealMoreArchivedType(typeKey: string, total: number) {
    setArchivedVisibleByType(current => ({
      ...current,
      [typeKey]: Math.min(total, (current[typeKey] || REPORT_TYPE_PAGE_SIZE) + REPORT_TYPE_PAGE_SIZE)
    }));
  }

  async function handleLoadMoreArchivedType(
    projectId: string,
    reportType: string,
    typeKey: string,
    loadedCount: number,
    hasLoadedItemsToReveal: boolean,
    sortDirection: ProjectSortDirection
  ) {
    if (!hasLoadedItemsToReveal) {
      const loaded = await reportsQuery.loadMoreGroup({
        projectId,
        reportType,
        loadedCount,
        pageSize: REPORT_TYPE_PAGE_SIZE,
        sortDirection
      });
      if (loaded === false) return;
    }
    setArchivedVisibleByType(current => ({
      ...current,
      [typeKey]: (current[typeKey] || REPORT_TYPE_PAGE_SIZE) + REPORT_TYPE_PAGE_SIZE
    }));
  }

  function renderReportActions(report: ReportSummary) {
    return (
      <button className="secondary-button" type="button" onClick={() => void handleDownloadPdf(report)}>
        PDF
      </button>
    );
  }

  function renderReportGroups() {
    return (
      <GroupedReportList
        reports={visibleReports}
        archived={tab === 'archived'}
        sortDirection={projectSortDir}
        showTypeSort
        storageKey={`coordinator-report-groups:${user?.id || user?.username || 'anonymous'}:${tab}`}
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
          <ReportSummaryCard key={report.id} report={report} actions={renderReportActions(report)} />
        )}
      />
    );
  }

  function renderArchivedReportTypeSections(reports: ReportSummary[], projectId: string) {
    const byType = reports.reduce<Record<string, ReportSummary[]>>((acc, report) => {
      if (!acc[report.reportType]) acc[report.reportType] = [];
      acc[report.reportType].push(report);
      return acc;
    }, {});
    reportsQuery.projectTypeTotals(projectId).forEach(typeTotal => {
      if (!byType[typeTotal.reportType]) byType[typeTotal.reportType] = [];
    });

    return Object.entries(byType)
      .sort(([a], [b]) => compareReportTypes(a, b))
      .map(([reportType, typeReports]) => {
        const typeKey = `${projectId}-${reportType}`;
        const typeClosed = closedArchivedTypeKeys.includes(typeKey);
        const typeSortDirection = archivedTypeSortDirections[typeKey] || 'asc';
        const sortedReports = sortReportsInGroup(typeReports, typeSortDirection);
        const visibleLimit = visibleArchivedTypeLimit(typeKey);
        const totalReports = reportsQuery.groupTotal(projectId, reportType) ?? typeReports.length;
        const typeErrored = reportsQuery.isGroupError(projectId, reportType);
        const orderedLoadedCount = Math.min(
          reportsQuery.groupLoadedCount(projectId, reportType, REPORT_TYPE_PAGE_SIZE, typeSortDirection),
          totalReports
        );
        const needsOrderedPage = totalReports > 0
          && !typeErrored
          && !reportsQuery.isGroupPageReady(projectId, reportType, REPORT_TYPE_PAGE_SIZE, typeSortDirection);
        const orderedReports = sortedReports.slice(0, orderedLoadedCount);
        const visibleReports = needsOrderedPage ? [] : orderedReports.slice(0, visibleLimit);
        const hasLoadedItemsToReveal = !needsOrderedPage && visibleReports.length < orderedReports.length;
        const hasRemoteItemsToLoad = !needsOrderedPage
          && !hasLoadedItemsToReveal
          && orderedLoadedCount < totalReports;
        const typeLoading = reportsQuery.isGroupLoading(projectId, reportType);

        return (
          <div className="report-type-group" key={typeKey}>
            <div
              className="report-type-header"
              onClick={() => toggleArchivedType(typeKey)}
              role="button"
              tabIndex={0}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  toggleArchivedType(typeKey);
                }
              }}
            >
              <span className={`rtype-badge rtype-${reportType}`}>{reportType}</span>
              <span className="rtype-count">
                {visibleReports.length} de {totalReports} relatório{totalReports !== 1 ? 's' : ''}
              </span>
              <span onClick={event => event.stopPropagation()}>
                <ProjectSortButton direction={typeSortDirection} onToggle={() => toggleArchivedTypeSort(typeKey)} />
              </span>
              <span className="rtype-chevron">{typeClosed ? '▸' : '▾'}</span>
            </div>
            {!typeClosed ? (
              <>
                {visibleReports.length ? (
                  <div className="report-type-list">
                    {visibleReports.map(report => (
                      <ReportSummaryCard key={report.id} report={report} actions={renderReportActions(report)} />
                    ))}
                  </div>
                ) : null}
                {needsOrderedPage ? (
                  <div className="placeholder-copy">Carregando relatórios...</div>
                ) : null}
                {typeErrored ? (
                  <div className="placeholder-copy">Não foi possível carregar os relatórios desta aba.</div>
                ) : null}
                {hasLoadedItemsToReveal || hasRemoteItemsToLoad ? (
                  <div className="admin-create-toolbar report-type-load-more">
                    <InfiniteScrollSentinel
                      hasMore={(hasLoadedItemsToReveal || hasRemoteItemsToLoad) && !typeErrored}
                      isLoading={typeLoading}
                      onLoadMore={() => {
                        if (hasLoadedItemsToReveal) {
                          revealMoreArchivedType(typeKey, sortedReports.length);
                          return;
                        }
                        void handleLoadMoreArchivedType(projectId, reportType, typeKey, sortedReports.length, hasLoadedItemsToReveal, typeSortDirection);
                      }}
                    />
                    <button
                      className="mini-btn"
                      type="button"
                      disabled={typeLoading}
                      onClick={() => {
                        if (hasLoadedItemsToReveal) {
                          revealMoreArchivedType(typeKey, sortedReports.length);
                          return;
                        }
                        void handleLoadMoreArchivedType(projectId, reportType, typeKey, sortedReports.length, hasLoadedItemsToReveal, typeSortDirection);
                      }}
                    >
                      {typeLoading ? 'Carregando...' : typeErrored ? 'Tentar novamente' : 'Carregar mais'}
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        );
      });
  }

  function renderProjectCard(project: Project, projectReports: ReportSummary[]) {
    const projectClosed = closedArchivedProjectIds.includes(project.id);
    const surveyInfos = surveyHistoryBadges(project);

    return (
      <article className="card admin-card" key={project.id}>
        <div className="admin-card-head">
          <div>
            <div className="admin-card-title">
              {project.code} - {project.name}
              <span className="badge badge-rev" style={{ textTransform: 'none', marginLeft: 6 }}>
                Arquivado
              </span>
              {surveyInfos.map((surveyInfo, index) => (
                <span className={surveyInfo.className} style={{ textTransform: 'none', marginLeft: 6 }} key={`${project.id}-survey-${index}`}>
                  {surveyInfo.label}
                </span>
              ))}
            </div>
            <div className="admin-card-meta">
              <span>{project.clientName}</span>
              <span>{project.location}</span>
              <span>{projectReports.length} relatório{projectReports.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
          <div className="admin-card-actions">
            <button className="mini-btn alt" type="button" onClick={() => toggleArchivedProject(project.id)}>
              {projectClosed ? 'Ver relatórios' : 'Ocultar relatórios'}
            </button>
          </div>
        </div>
        <div className="det-section" style={{ marginTop: 12 }}>
          <div className="det-row"><span className="det-label">Cliente</span><span className="det-val">{project.clientName}</span></div>
          <div className="det-row"><span className="det-label">Contrato</span><span className="det-val">{project.contractCode || '-'}</span></div>
          <div className="det-row"><span className="det-label">Local</span><span className="det-val">{project.location || '-'}</span></div>
          <div className="det-row"><span className="det-label">Líder</span><span className="det-val">{project.operator?.name || 'Não informado'}</span></div>
        </div>
        {!projectClosed ? (
          projectReports.length ? (
            <div className="admin-stack" style={{ marginTop: 14 }}>
              {renderArchivedReportTypeSections(projectReports, project.id)}
            </div>
          ) : (
            <div className="placeholder-copy" style={{ marginTop: 14 }}>
              Nenhum relatório aprovado neste projeto arquivado.
            </div>
          )
        ) : null}
      </article>
    );
  }

  function renderArchivedTab() {
    const archivedProjects = (archivedProjectsQuery.data || []).filter(project => project.isActive === false);

    if (archivedProjectsQuery.isLoading || reportsQuery.isLoading) {
      return <div className="page-card placeholder-copy">Carregando projetos arquivados...</div>;
    }

    const projectCards = sortProjects(archivedProjects, projectSortDir)
      .map(project => {
        const projectReports = visibleReports.filter(report => report.projectId === project.id);
        const projectMatches = matchesSearch(projectSearchParts(project), search);
        const filteredReports = projectMatches
          ? projectReports
          : projectReports.filter(report => matchesSearch(reportSearchParts(report), search));
        return {
          project,
          projectReports: filteredReports,
          visible: projectMatches || filteredReports.length > 0
        };
      })
      .filter(item => item.visible);

    return (
      <section className="page-card">
        <div className="admin-section-head">
          <div className="section-title">Projetos arquivados</div>
          <ProjectSortButton
            direction={projectSortDir}
            onToggle={() => setProjectSortDir(direction => direction === 'asc' ? 'desc' : 'asc')}
          />
        </div>
        {projectCards.length ? (
          <div className="admin-stack">
            {projectCards.map(({ project, projectReports }) => renderProjectCard(project, projectReports))}
          </div>
        ) : (
          <p className="placeholder-copy">
            {search.trim() ? 'Nenhum projeto arquivado encontrado.' : TEXT.noArchived}
          </p>
        )}
        {renderLoadMoreReports()}
      </section>
    );
  }

  function renderEstatisticasTab() {
    return (
      <>
        {statsDashboardOpen && <StatsDashboardOverlay onClose={() => setStatsDashboardOpen(false)} />}
        {allocationDashboardOpen && <MonthlyAllocationDashboardOverlay onClose={() => setAllocationDashboardOpen(false)} />}
        <div className="nps-tab-toolbar">
          <div className="nps-tab-toolbar-left" />
          <div className="nps-tab-toolbar-right">
            <button className="mini-btn alt" type="button" onClick={() => setAllocationDashboardOpen(true)}>
              Alocação mensal
            </button>
            <button className="mini-btn" type="button" onClick={() => setStatsDashboardOpen(true)}>
              Dashboard detalhado
            </button>
          </div>
        </div>
        <StatsOverview />
      </>
    );
  }

  function renderLoadMoreReports() {
    const showButton = reportsQuery.hasMore || reportsQuery.isLoadingMore;
    return (
      <>
        <div ref={loadMoreReportsRef} aria-hidden="true" />
        {showButton ? (
          <div className="admin-create-toolbar">
            <button
              className="mini-btn"
              type="button"
              disabled={reportsQuery.isLoadingMore}
              onClick={reportsQuery.loadMore}
            >
              {reportsQuery.isLoadingMore ? 'Carregando...' : 'Carregar mais'}
            </button>
          </div>
        ) : null}
      </>
    );
  }

  function renderTabContent() {
    if (tab === 'archived') return renderArchivedTab();
    if (tab === 'nps') return renderNpsTab();
    if (tab === 'estatisticas') return renderEstatisticasTab();

    if (reportsQuery.isLoading) return <ReportListSkeleton />;

    return (
      <>
        <div className="admin-create-toolbar">
          {tab === 'pending' ? (
            <button className="mini-btn" type="button" onClick={handleNewReport}>
              + Criar Relatório
            </button>
          ) : null}
          <ProjectSortButton
            direction={projectSortDir}
            onToggle={() => setProjectSortDir(direction => direction === 'asc' ? 'desc' : 'asc')}
          />
        </div>
        {!visibleReports.length ? (
          <div className="page-card placeholder-copy">
            {tab === 'pending' ? TEXT.noPending : TEXT.noApproved}
          </div>
        ) : null}
        {renderReportGroups()}
        {renderLoadMoreReports()}
      </>
    );
  }

  function renderNpsTab() {
    const surveys = (surveysQuery.data || [])
      .filter(survey => {
        const status = surveyStatusLabel(survey).label.toLowerCase();
        const parts = [
          survey.project?.code,
          survey.project?.name,
          survey.project?.clientName,
          survey.emailTo,
          status
        ];
        return matchesSearch(parts, search);
      });
    const surveyGroups = Array.from(surveys.reduce((groups, survey) => {
      const key = npsProjectKey(survey);
      const current = groups.get(key);
      if (current) {
        current.surveys.push(survey);
      } else {
        groups.set(key, { key, title: npsProjectTitle(survey), clientName: survey.project?.clientName || '-', surveys: [survey] });
      }
      return groups;
    }, new Map<string, { key: string; title: string; clientName: string; surveys: typeof surveys }>()).values())
      .map(group => ({
        ...group,
        surveys: group.surveys.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
      }))
      .sort((a, b) => {
        const titleA = a.title;
        const titleB = b.title;
        return npsSortDir === 'asc'
          ? titleA.localeCompare(titleB, 'pt-BR', { numeric: true, sensitivity: 'base' })
          : titleB.localeCompare(titleA, 'pt-BR', { numeric: true, sensitivity: 'base' });
      });

    if (surveysQuery.isLoading) {
      return <div className="page-card placeholder-copy">Carregando pesquisas...</div>;
    }

    return (
      <>
      {npsDashboardOpen && <SurveyDashboardOverlay onClose={() => setNpsDashboardOpen(false)} />}
      <div className="nps-tab-toolbar">
        <div className="nps-tab-toolbar-left" />
        <div className="nps-tab-toolbar-right">
          <button className="mini-btn" type="button" onClick={() => setNpsDashboardOpen(true)}>
            Dashboard NPS
          </button>
        </div>
      </div>
      <section className="nps-tab-content">
        <div className="nps-tab-heading">
          <div>
            <div className="section-title">NPS</div>
            <div className="admin-card-subtitle">Pesquisas pendentes, respondidas e expiradas.</div>
          </div>
          <ProjectSortButton
            direction={npsSortDir}
            onToggle={() => setNpsSortDir(direction => direction === 'asc' ? 'desc' : 'asc')}
          />
        </div>
        {surveyGroups.length ? (
          <div className="admin-stack">
            {surveyGroups.map(group => {
              return (
                <article className="card admin-card" key={group.key}>
                  <div className="admin-card-title">{group.title}</div>
                  <div className="admin-card-meta">
                    <span>{group.clientName}</span>
                    <span>{group.surveys.length} pesquisa{group.surveys.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="admin-stack" style={{ marginTop: 12 }}>
                    {group.surveys.map((survey, index) => {
                      const status = surveyStatusLabel(survey);
                      const open = openSurveyId === survey.id;
                      return (
                        <div className="report-type-group" key={survey.id}>
                          <button
                            className="client-account-group-toggle"
                            type="button"
                            onClick={() => setOpenSurveyId(current => current === survey.id ? null : survey.id)}
                          >
                            <span className="rtype-chevron">{open ? '▾' : '▸'}</span>
                            <span>Pesquisa #{group.surveys.length - index}</span>
                          </button>
                          <div className="admin-card-meta">
                            <span>Enviada: {formatSurveyDate(survey.sentAt)}</span>
                            <span>Respondida: {survey.respondedAt ? formatSurveyDate(survey.respondedAt) : '-'}</span>
                            <span>Expira: {formatSurveyDate(survey.expiresAt)}</span>
                            <span className={`status-pill ${status.className}`}>{status.label}</span>
                          </div>
                          {open ? (
                            survey.respondedAt ? (
                              <div className="det-section" style={{ marginTop: 12 }}>
                                {npsResponseRows(survey.responses, survey.questions || []).map(([question, answer]) => (
                                  <div className="det-row" key={question}>
                                    <span className="det-label">{question}</span>
                                    <span className="det-val">{answer}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="placeholder-copy" style={{ marginTop: 12 }}>
                                {surveyIsExpired(survey)
                                  ? 'Pesquisa expirada sem resposta do cliente.'
                                  : 'Pesquisa enviada, aguardando resposta do cliente.'}
                              </p>
                            )
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="placeholder-copy">
            {search.trim() ? 'Nenhuma pesquisa encontrada.' : 'Nenhuma pesquisa NPS disponível.'}
          </p>
        )}
      </section>
      </>
    );
  }

  return (
    <Shell>
      <TopBar
        title={TEXT.coordinatorPanel}
        subtitle={user?.name}
        showLogo
        actions={
          <>
            <button className="topbar-chip" type="button" onClick={() => navigate('/conta', { state: accountPageStateFromPath(location.pathname) })}>
              Conta
            </button>
            <button className="topbar-chip" type="button" onClick={handleLogout}>
              Sair
            </button>
          </>
        }
      />
      <div className="nav-tabs-wrap">
        <div className="nav-tabs" role="tablist" aria-label="Seções do coordenador" onKeyDown={handleHorizontalTabListKeyDown}>
          <button className={`nav-tab ${tab === 'pending' ? 'active' : ''}`} type="button" role="tab" aria-selected={tab === 'pending'} onClick={() => setTab('pending')}>
            {TEXT.pending}
            <span className="nav-tab-count">{pendingReportCount}</span>
          </button>
          <button className={`nav-tab ${tab === 'approved' ? 'active' : ''}`} type="button" role="tab" aria-selected={tab === 'approved'} onClick={() => setTab('approved')}>
            {TEXT.approved}
          </button>
          <button className={`nav-tab ${tab === 'archived' ? 'active' : ''}`} type="button" role="tab" aria-selected={tab === 'archived'} onClick={() => setTab('archived')}>
            {TEXT.archived}
          </button>
          <button className={`nav-tab ${tab === 'nps' ? 'active' : ''}`} type="button" role="tab" aria-selected={tab === 'nps'} onClick={() => setTab('nps')}>
            NPS
          </button>
          <button className={`nav-tab ${tab === 'estatisticas' ? 'active' : ''}`} type="button" role="tab" aria-selected={tab === 'estatisticas'} onClick={() => setTab('estatisticas')}>
            Estatísticas
          </button>
        </div>
      </div>
      <main className="page-scroll">
        <section className="page-card">
          <div className="section-title">{TEXT.reports}</div>
          <div className="admin-search-row">
            <input
              aria-label={`Buscar em ${tab === 'pending' ? 'pendentes' : tab === 'archived' ? 'arquivados' : tab === 'nps' ? 'pesquisas NPS' : 'aprovados'}`}
              placeholder={`Buscar em ${tab === 'pending' ? 'pendentes' : tab === 'archived' ? 'arquivados' : tab === 'nps' ? 'pesquisas NPS' : 'aprovados'}`}
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
          </div>
        </section>
        {renderTabContent()}
      </main>
    </Shell>
  );
}
