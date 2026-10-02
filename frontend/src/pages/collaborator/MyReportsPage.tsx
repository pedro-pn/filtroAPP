import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { navigationStateFromLocation } from '../../auth/moduleNavigation';
import { rdoPath, rdoReportDetailPath } from '../../auth/rolePath';
import { GroupedReportList } from '../../components/reports/GroupedReportList';
import { ReportPdfBatchActions, ReportSelectionCheckbox } from '../../components/reports/ReportPdfBatchActions';
import { ReportSummaryCard } from '../../components/reports/ReportSummaryCard';
import { ManagerReportListing } from '../../components/reports/manager/ManagerReportListing';
import { Button, Card, SearchInput, StatusPill } from '../../components/ui/ds';
import { ReportListSkeleton } from '../../components/ui/Skeleton';
import { useInfiniteScrollSentinel } from '../../hooks/useInfiniteScrollSentinel';
import { usePersistentSearch } from '../../hooks/usePersistentSearch';
import { currentPageScrollState, saveCurrentPageScroll } from '../../hooks/usePageScrollRestoration';
import { useAccumulatedReportsPage } from '../../hooks/useReports';
import { PageHeader } from '../../layout/PageHeader';
import type { ReportSummary } from '../../types/domain';
import { type ProjectSortDirection } from '../../utils/projectSort';
import { ProjectSortButton } from '../../utils/ProjectSortButton';
import { RdoAppShell } from '../RdoAppShell';

const REPORT_PAGE_SIZE = 25;

function newestFirst(reports: ReportSummary[]) {
  return [...reports].sort(
    (a, b) => new Date(b.reportDate).getTime() - new Date(a.reportDate).getTime()
  );
}

export function MyReportsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const userKey = user?.id || user?.username || 'anonymous';
  const [search, setSearch] = usePersistentSearch(`my-reports-search:${userKey}`);
  const [projectSortDir, setProjectSortDir] = useState<ProjectSortDirection>('asc');
  const [selectedReportIds, setSelectedReportIds] = useState<string[]>([]);
  const pendingReportsQuery = useAccumulatedReportsPage({
    mine: true,
    summary: true,
    projectActive: true,
    statuses: ['PENDING', 'RETURNED'],
    search,
    projectSort: projectSortDir,
    pageSize: REPORT_PAGE_SIZE
  });
  const approvedReportsQuery = useAccumulatedReportsPage({
    mine: true,
    summary: true,
    projectActive: true,
    statuses: ['APPROVED', 'SIGNED'],
    search,
    projectSort: projectSortDir,
    pageSize: REPORT_PAGE_SIZE
  });
  const pendingLoadMoreRef = useInfiniteScrollSentinel({
    hasMore: pendingReportsQuery.hasMore,
    isLoading: pendingReportsQuery.isLoadingMore,
    onLoadMore: pendingReportsQuery.loadMore
  });
  const approvedLoadMoreRef = useInfiniteScrollSentinel({
    hasMore: approvedReportsQuery.hasMore,
    isLoading: approvedReportsQuery.isLoadingMore,
    onLoadMore: approvedReportsQuery.loadMore
  });
  const pendingReports = useMemo(() => newestFirst(pendingReportsQuery.items), [pendingReportsQuery.items]);
  const approvedReports = useMemo(() => newestFirst(approvedReportsQuery.items), [approvedReportsQuery.items]);
  const navigationSections = useMemo(() => [
    { id: 'home', label: 'Início', href: rdoPath('/home'), active: false },
    { id: 'reports', label: 'Meus relatórios', href: rdoPath('/meus-relatorios'), active: true },
    { id: 'ongoing', label: 'Em andamento', href: rdoPath('/andamento'), active: false },
    { id: 'archived', label: 'Arquivados', href: rdoPath('/meus-relatorios/arquivados'), active: false }
  ], []);

  function handleOpenReport(report: ReportSummary) {
    saveCurrentPageScroll(location, userKey);
    navigate(rdoReportDetailPath(user, report.id), {
      state: {
        ...(navigationStateFromLocation(location) || {}),
        ...currentPageScrollState()
      }
    });
  }

  const sections = [
    { id: 'pending' as const, title: 'Pendentes', reports: pendingReports, query: pendingReportsQuery, loadMoreRef: pendingLoadMoreRef },
    { id: 'approved' as const, title: 'Aprovados e assinados', reports: approvedReports, query: approvedReportsQuery, loadMoreRef: approvedLoadMoreRef }
  ];
  const loading = pendingReportsQuery.isLoadingInitial || approvedReportsQuery.isLoadingInitial;
  const noReports = !loading && !pendingReportsQuery.isError && !approvedReportsQuery.isError
    && !pendingReports.length && !approvedReports.length;

  return (
    <RdoAppShell title="Meus relatórios" subNavigation={navigationSections}>
      <main className="fv-ds rdo-role-page rdo-collaborator-reports-page">
        <PageHeader
          title="Meus relatórios"
          description="Os pendentes aparecem primeiro; consulte e baixe os relatórios aprovados logo abaixo."
          actions={<Button variant="secondary" size="sm" onClick={() => navigate(rdoPath('/home'))}>Voltar ao início</Button>}
        />
        <Card className="rdo-role-toolbar" padding="sm">
          <div className="rdo-role-toolbar__controls collaborator-report-search-row">
            <SearchInput
              value={search}
              loading={pendingReportsQuery.isSearching || approvedReportsQuery.isSearching}
              onChange={setSearch}
              placeholder="Buscar em meus relatórios"
              aria-label="Buscar em meus relatórios"
            />
            <ProjectSortButton
              direction={projectSortDir}
              onToggle={() => setProjectSortDir(direction => direction === 'asc' ? 'desc' : 'asc')}
            />
          </div>
        </Card>
        {noReports ? <Card className="placeholder-copy" padding="lg">Nenhum relatório encontrado.</Card> : null}
        {sections.map(({ id, title, reports, query, loadMoreRef }) => {
          if (id === 'pending' && !reports.length && !query.isLoadingInitial && !query.isError) return null;
          return (
            <section className="rdo-collaborator-report-section" aria-labelledby={`my-reports-${id}`} key={id}>
              <div className="rdo-collaborator-report-section__heading">
                <h2 id={`my-reports-${id}`}>{title}</h2>
                {id === 'pending' ? <StatusPill status="pending" label="Pendente" tone="warning" /> : null}
              </div>
              {query.isLoadingInitial ? <ReportListSkeleton /> : null}
              {query.isError && !reports.length ? (
                <Card className="placeholder-copy" padding="lg">
                  Não foi possível carregar os relatórios.{' '}
                  <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>Tentar novamente</Button>
                </Card>
              ) : null}
              {id === 'approved' && !query.isLoadingInitial && !query.isError && !reports.length && !noReports ? (
                <Card className="placeholder-copy" padding="lg">Nenhum relatório aprovado encontrado.</Card>
              ) : null}
              {reports.length ? (
                <div className="rdo-manager-listing rdo-role-report-listing">
                  <GroupedReportList
                    reports={reports}
                    appearance="design-system"
                    sortDirection={projectSortDir}
                    showTypeSort
                    storageKey={`collaborator-report-groups:${userKey}:${id}`}
                    renderTypeActions={id === 'approved' ? typeReports => (
                      <ReportPdfBatchActions
                        appearance="design-system"
                        reports={typeReports}
                        selectedIds={selectedReportIds}
                        onSelectionChange={setSelectedReportIds}
                      />
                    ) : undefined}
                    onLoadMoreType={query.loadMoreGroup}
                    onEnsureTypePage={query.ensureGroupPage}
                    isTypePageReady={query.isGroupPageReady}
                    getTypeLoadedCount={query.groupLoadedCount}
                    hasMoreType={query.hasMoreGroup}
                    isTypeLoading={query.isGroupLoading}
                    isTypePageErrored={query.isGroupError}
                    getTypeTotal={query.groupTotal}
                    getProjectTypeTotals={query.projectTypeTotals}
                    renderReportCollection={({ reports: typeReports, projectLabel, reportType, sortDirection, onSortChange }) => (
                      <ManagerReportListing
                        reports={typeReports}
                        selectedReportIds={selectedReportIds}
                        onSelectionChange={setSelectedReportIds}
                        onOpenReport={handleOpenReport}
                        renderActions={() => null}
                        reportType={reportType}
                        projectLabel={projectLabel}
                        sortDirection={sortDirection}
                        onSortChange={onSortChange}
                        selectable={id === 'approved'}
                      />
                    )}
                    renderReport={report => id === 'approved' ? (
                      <ReportSummaryCard
                        key={report.id}
                        report={report}
                        leadingControl={(
                          <ReportSelectionCheckbox
                            reportId={report.id}
                            selectedIds={selectedReportIds}
                            onSelectionChange={setSelectedReportIds}
                          />
                        )}
                      />
                    ) : <ReportSummaryCard key={report.id} report={report} />}
                  />
                </div>
              ) : null}
              <div ref={loadMoreRef} aria-hidden="true" />
              {query.hasMore || query.isLoadingMore ? (
                <div className="admin-create-toolbar rdo-role-load-more">
                  <Button variant="secondary" size="sm" loading={query.isLoadingMore} disabled={query.isLoadingMore} onClick={query.loadMore}>
                    {query.isLoadingMore ? 'Carregando...' : 'Carregar mais'}
                  </Button>
                </div>
              ) : null}
            </section>
          );
        })}
      </main>
    </RdoAppShell>
  );
}
