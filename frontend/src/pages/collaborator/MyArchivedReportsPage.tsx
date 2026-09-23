import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { navigationStateFromLocation } from '../../auth/moduleNavigation';
import { rdoPath, rdoReportDetailPath } from '../../auth/rolePath';
import { GroupedReportList } from '../../components/reports/GroupedReportList';
import { ReportPdfBatchActions, ReportSelectionCheckbox } from '../../components/reports/ReportPdfBatchActions';
import { ReportSummaryCard } from '../../components/reports/ReportSummaryCard';
import { ManagerReportListing } from '../../components/reports/manager/ManagerReportListing';
import { Button, Card, SearchInput } from '../../components/ui/ds';
import { ReportListSkeleton } from '../../components/ui/Skeleton';
import { PageHeader } from '../../layout/PageHeader';
import { useAccumulatedReportsPage } from '../../hooks/useReports';
import { useInfiniteScrollSentinel } from '../../hooks/useInfiniteScrollSentinel';
import { usePersistentSearch } from '../../hooks/usePersistentSearch';
import { currentPageScrollState, saveCurrentPageScroll } from '../../hooks/usePageScrollRestoration';
import { RdoAppShell } from '../RdoAppShell';

const REPORT_PAGE_SIZE = 25;

export function MyArchivedReportsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  // Busca persistida: ao abrir um relatório e voltar, o termo da busca é restaurado.
  const [search, setSearch] = usePersistentSearch(`my-archived-search:${user?.id || user?.username || 'anonymous'}`);
  const [selectedReportIds, setSelectedReportIds] = useState<string[]>([]);
  const reportsQuery = useAccumulatedReportsPage({
    mine: true,
    summary: true,
    projectActive: false,
    statuses: ['APPROVED', 'SIGNED'],
    search,
    projectSort: 'asc',
    pageSize: REPORT_PAGE_SIZE
  });
  const reports = reportsQuery.items;
  const loadMoreRef = useInfiniteScrollSentinel({
    hasMore: reportsQuery.hasMore,
    isLoading: reportsQuery.isLoadingMore,
    onLoadMore: reportsQuery.loadMore
  });

  const groups = useMemo(() => {
    const sorted = [...reports].sort(
      (a, b) => new Date(b.reportDate).getTime() - new Date(a.reportDate).getTime()
    );
    return sorted;
  }, [reports]);
  const navigationSections = useMemo(() => [
    { id: 'home', label: 'Início', href: rdoPath('/home'), active: false },
    { id: 'pending', label: 'Pendentes', href: `${rdoPath('/meus-relatorios')}?tab=pending`, active: false },
    { id: 'approved', label: 'Aprovados', href: `${rdoPath('/meus-relatorios')}?tab=approved`, active: false },
    { id: 'ongoing', label: 'Em andamento', href: rdoPath('/andamento'), active: false },
    { id: 'archived', label: 'Arquivados', href: rdoPath('/meus-relatorios/arquivados'), active: true }
  ], []);

  function handleOpenReport(report: (typeof reports)[number]) {
    saveCurrentPageScroll(location, user?.id || user?.username || 'anonymous');
    navigate(rdoReportDetailPath(user, report.id), {
      state: {
        ...(navigationStateFromLocation(location) || {}),
        ...currentPageScrollState()
      }
    });
  }

  return (
    <RdoAppShell
      title="Arquivados"
      sectionLabel="Relatórios arquivados"
      subNavigation={navigationSections}
    >
      <main className="fv-ds rdo-role-page rdo-collaborator-reports-page">
        <PageHeader
          title="Relatórios arquivados"
          description="Consulte e baixe os relatórios vinculados a projetos já arquivados."
          actions={(
            <Button variant="secondary" size="sm" onClick={() => navigate(rdoPath('/home'))}>
              Voltar ao início
            </Button>
          )}
      />
        <Card className="rdo-role-toolbar" padding="sm">
          <div className="rdo-role-toolbar__controls">
            <SearchInput value={search} onChange={setSearch} placeholder="Buscar em arquivados" aria-label="Buscar em arquivados" />
          </div>
        </Card>
        {reportsQuery.isLoading ? <ReportListSkeleton /> : null}
        {!reportsQuery.isLoading && !groups.length ? (
          <Card className="placeholder-copy" padding="lg">
            {search.trim() ? 'Nenhum relatório arquivado encontrado.' : 'Nenhum relatório arquivado.'}
          </Card>
        ) : null}
        <div className="rdo-manager-listing rdo-role-report-listing">
          <GroupedReportList
            reports={groups}
            archived
            appearance="design-system"
            storageKey={`collaborator-archived-report-groups:${user?.id || user?.username || 'anonymous'}`}
            renderTypeActions={typeReports => (
              <ReportPdfBatchActions
                appearance="design-system"
                reports={typeReports}
                selectedIds={selectedReportIds}
                onSelectionChange={setSelectedReportIds}
              />
            )}
            onLoadMoreType={reportsQuery.loadMoreGroup}
            onEnsureTypePage={reportsQuery.ensureGroupPage}
            isTypePageReady={reportsQuery.isGroupPageReady}
            getTypeLoadedCount={reportsQuery.groupLoadedCount}
            hasMoreType={reportsQuery.hasMoreGroup}
            isTypeLoading={reportsQuery.isGroupLoading}
            isTypePageErrored={reportsQuery.isGroupError}
            getTypeTotal={reportsQuery.groupTotal}
            getProjectTypeTotals={reportsQuery.projectTypeTotals}
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
              />
            )}
            renderReport={report => (
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
            )}
          />
        </div>
        <div ref={loadMoreRef} aria-hidden="true" />
        {reportsQuery.hasMore || reportsQuery.isLoadingMore ? (
          <div className="admin-create-toolbar rdo-role-load-more">
            <Button variant="secondary" size="sm" loading={reportsQuery.isLoadingMore} disabled={reportsQuery.isLoadingMore} onClick={reportsQuery.loadMore}>
              {reportsQuery.isLoadingMore ? 'Carregando...' : 'Carregar mais'}
            </Button>
          </div>
        ) : null}
      </main>
    </RdoAppShell>
  );
}
