import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../auth/AuthContext';
import { rdoPath } from '../../auth/rolePath';
import { GroupedReportList } from '../../components/reports/GroupedReportList';
import { SearchBar } from '../../components/ui/SearchBar';
import { ReportListSkeleton } from '../../components/ui/Skeleton';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { useAccumulatedReportsPage } from '../../hooks/useReports';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useInfiniteScrollSentinel } from '../../hooks/useInfiniteScrollSentinel';
import { usePersistentSearch } from '../../hooks/usePersistentSearch';
import { type ProjectSortDirection } from '../../utils/projectSort';
import { ProjectSortButton } from '../../utils/ProjectSortButton';
import { handleHorizontalTabListKeyDown } from '../../utils/tabKeyboard';

type MyReportsTab = 'pending' | 'approved';
const REPORT_PAGE_SIZE = 25;

export function MyReportsPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<MyReportsTab>('pending');
  // Busca persistida por aba: ao voltar (de outra aba ou do detalhe), restaura o termo da aba.
  const [search, setSearch] = usePersistentSearch(`my-reports-search:${user?.id || user?.username || 'anonymous'}:${tab}`);
  const debouncedSearch = useDebouncedValue(search, 300);
  const [projectSortDir, setProjectSortDir] = useState<ProjectSortDirection>('asc');
  const pendingReportsQuery = useAccumulatedReportsPage({
    mine: true,
    summary: true,
    projectActive: true,
    statuses: ['PENDING', 'RETURNED'],
    search: debouncedSearch,
    projectSort: projectSortDir,
    pageSize: REPORT_PAGE_SIZE
  }, tab === 'pending');
  const approvedReportsQuery = useAccumulatedReportsPage({
    mine: true,
    summary: true,
    projectActive: true,
    statuses: ['APPROVED', 'SIGNED'],
    search: debouncedSearch,
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

  async function handleLogout() {
    await logout();
    navigate('/', { replace: true });
  }

  return (
    <Shell>
      <TopBar
        title="Meus relatórios"
        subtitle={user?.name}
        actions={
          <>
            <button className="topbar-chip" type="button" onClick={() => navigate(rdoPath('/home'))}>
              Início
            </button>
            <button className="topbar-chip" type="button" onClick={handleLogout}>
              Sair
            </button>
          </>
        }
      />
      <main className="page-scroll">
        <section className="page-card">
          <div className="filter-tabs" role="tablist" aria-label="Status dos relatórios" onKeyDown={handleHorizontalTabListKeyDown}>
            <button className={`filter-tab ${tab === 'pending' ? 'active' : ''}`} type="button" role="tab" aria-selected={tab === 'pending'} onClick={() => setTab('pending')}>
              Pendentes
            </button>
            <button className={`filter-tab ${tab === 'approved' ? 'active' : ''}`} type="button" role="tab" aria-selected={tab === 'approved'} onClick={() => setTab('approved')}>
              Aprovados
            </button>
          </div>
          <div className="admin-search-row collaborator-report-search-row">
            <SearchBar
              value={search}
              onChange={setSearch}
              placeholder={tab === 'pending' ? 'Buscar em pendentes' : 'Buscar em aprovados'}
            />
          </div>
          <div className="admin-create-toolbar collaborator-report-sort-toolbar">
            <ProjectSortButton
              direction={projectSortDir}
              onToggle={() => setProjectSortDir(direction => direction === 'asc' ? 'desc' : 'asc')}
            />
          </div>
        </section>
        {reportsQuery.isLoading ? <ReportListSkeleton /> : null}
        {!reportsQuery.isLoading && !groups.length ? (
          <div className="page-card placeholder-copy">
            {tab === 'pending' ? 'Nenhum relatório pendente encontrado.' : 'Nenhum relatório aprovado encontrado.'}
          </div>
        ) : null}
        <GroupedReportList
          reports={groups}
          sortDirection={projectSortDir}
          showTypeSort
          storageKey={`collaborator-report-groups:${user?.id || user?.username || 'anonymous'}:${tab}`}
          onLoadMoreType={reportsQuery.loadMoreGroup}
          onEnsureTypePage={reportsQuery.ensureGroupPage}
          isTypePageReady={reportsQuery.isGroupPageReady}
          getTypeLoadedCount={reportsQuery.groupLoadedCount}
          hasMoreType={reportsQuery.hasMoreGroup}
          isTypeLoading={reportsQuery.isGroupLoading}
          isTypePageErrored={reportsQuery.isGroupError}
          getTypeTotal={reportsQuery.groupTotal}
          getProjectTypeTotals={reportsQuery.projectTypeTotals}
        />
        <div ref={loadMoreRef} aria-hidden="true" />
        {reportsQuery.hasMore || reportsQuery.isLoadingMore ? (
          <div className="admin-create-toolbar">
            <button className="mini-btn" type="button" disabled={reportsQuery.isLoadingMore} onClick={reportsQuery.loadMore}>
              {reportsQuery.isLoadingMore ? 'Carregando...' : 'Carregar mais'}
            </button>
          </div>
        ) : null}
        <button className="secondary-button" type="button" onClick={() => navigate(rdoPath('/home'))}>
          Voltar
        </button>
      </main>
    </Shell>
  );
}
