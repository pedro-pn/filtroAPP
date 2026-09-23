import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { navigationStateFromLocation } from '../../auth/moduleNavigation';
import { rdoPath, rdoReportDetailPath } from '../../auth/rolePath';
import { GroupedReportList } from '../../components/reports/GroupedReportList';
import { ReportPdfBatchActions, ReportSelectionCheckbox } from '../../components/reports/ReportPdfBatchActions';
import { ReportSummaryCard } from '../../components/reports/ReportSummaryCard';
import { ManagerReportListing } from '../../components/reports/manager/ManagerReportListing';
import { Card, Button, SearchInput } from '../../components/ui/ds';
import { ReportListSkeleton } from '../../components/ui/Skeleton';
import { PageHeader } from '../../layout/PageHeader';
import { useAccumulatedReportsPage } from '../../hooks/useReports';
import { useInfiniteScrollSentinel } from '../../hooks/useInfiniteScrollSentinel';
import { usePersistentSearch } from '../../hooks/usePersistentSearch';
import { useUrlParamState } from '../../hooks/useUrlParamState';
import { currentPageScrollState, saveCurrentPageScroll } from '../../hooks/usePageScrollRestoration';
import { type ProjectSortDirection } from '../../utils/projectSort';
import { ProjectSortButton } from '../../utils/ProjectSortButton';
import { handleHorizontalTabListKeyDown } from '../../utils/tabKeyboard';
import { RdoAppShell } from '../RdoAppShell';

type MyReportsTab = 'pending' | 'approved';
const MY_REPORTS_TABS: MyReportsTab[] = ['pending', 'approved'];
const REPORT_PAGE_SIZE = 25;

function parseMyReportsTab(value: string | null): MyReportsTab {
  return MY_REPORTS_TABS.includes(value as MyReportsTab) ? value as MyReportsTab : 'pending';
}

export function MyReportsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [tab, setTab] = useUrlParamState<MyReportsTab>({
    param: 'tab',
    defaultValue: 'pending',
    parse: parseMyReportsTab
  });
  // Busca persistida por aba: ao voltar (de outra aba ou do detalhe), restaura o termo da aba.
  const [search, setSearch] = usePersistentSearch(`my-reports-search:${user?.id || user?.username || 'anonymous'}:${tab}`);
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
  }, tab === 'pending');
  const approvedReportsQuery = useAccumulatedReportsPage({
    mine: true,
    summary: true,
    projectActive: true,
    statuses: ['APPROVED', 'SIGNED'],
    search,
    projectSort: projectSortDir,
    pageSize: REPORT_PAGE_SIZE
  }, tab === 'approved');
  const reportsQuery = tab === 'pending' ? pendingReportsQuery : approvedReportsQuery;
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
    { id: 'pending', label: 'Pendentes', href: `${rdoPath('/meus-relatorios')}?tab=pending`, active: tab === 'pending' },
    { id: 'approved', label: 'Aprovados', href: `${rdoPath('/meus-relatorios')}?tab=approved`, active: tab === 'approved' },
    { id: 'ongoing', label: 'Em andamento', href: rdoPath('/andamento'), active: false },
    { id: 'archived', label: 'Arquivados', href: rdoPath('/meus-relatorios/arquivados'), active: false }
  ], [tab]);

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
      title="Meus relatórios"
      sectionLabel={tab === 'pending' ? 'Pendentes' : 'Aprovados'}
      subNavigation={navigationSections}
    >
      <main className="fv-ds rdo-role-page rdo-collaborator-reports-page">
        <PageHeader
          title={tab === 'pending' ? 'Relatórios pendentes' : 'Relatórios aprovados'}
          description={tab === 'pending'
            ? 'Acompanhe os relatórios enviados e retome os que precisam de ajustes.'
            : 'Consulte e baixe os relatórios já aprovados ou assinados.'}
          actions={(
            <Button variant="secondary" size="sm" onClick={() => navigate(rdoPath('/home'))}>
              Voltar ao início
            </Button>
          )}
      />
        <Card className="rdo-role-toolbar" padding="sm">
          <div className="filter-tabs rdo-role-tabs" role="tablist" aria-label="Status dos relatórios" onKeyDown={handleHorizontalTabListKeyDown}>
            <button className={`filter-tab ${tab === 'pending' ? 'active' : ''}`} type="button" role="tab" aria-selected={tab === 'pending'} onClick={() => setTab('pending')}>
              Pendentes
            </button>
            <button className={`filter-tab ${tab === 'approved' ? 'active' : ''}`} type="button" role="tab" aria-selected={tab === 'approved'} onClick={() => setTab('approved')}>
              Aprovados
            </button>
          </div>
          <div className="rdo-role-toolbar__controls collaborator-report-search-row">
            <SearchInput
              value={search}
              loading={reportsQuery.isSearching}
              onChange={setSearch}
              placeholder={tab === 'pending' ? 'Buscar em pendentes' : 'Buscar em aprovados'}
              aria-label={tab === 'pending' ? 'Buscar em pendentes' : 'Buscar em aprovados'}
            />
            <ProjectSortButton
              direction={projectSortDir}
              onToggle={() => setProjectSortDir(direction => direction === 'asc' ? 'desc' : 'asc')}
            />
          </div>
        </Card>
        {reportsQuery.isLoading ? <ReportListSkeleton /> : null}
        {!reportsQuery.isLoading && !groups.length ? (
          <Card className="placeholder-copy" padding="lg">
            {tab === 'pending' ? 'Nenhum relatório pendente encontrado.' : 'Nenhum relatório aprovado encontrado.'}
          </Card>
        ) : null}
        <div className="rdo-manager-listing rdo-role-report-listing">
          <GroupedReportList
            reports={groups}
            appearance="design-system"
            sortDirection={projectSortDir}
            showTypeSort
            storageKey={`collaborator-report-groups:${user?.id || user?.username || 'anonymous'}:${tab}`}
            renderTypeActions={tab === 'approved' ? typeReports => (
              <ReportPdfBatchActions
                appearance="design-system"
                reports={typeReports}
                selectedIds={selectedReportIds}
                onSelectionChange={setSelectedReportIds}
              />
            ) : undefined}
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
                selectable={tab === 'approved'}
              />
            )}
            renderReport={report => tab === 'approved' ? (
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
