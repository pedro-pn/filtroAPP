import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../auth/AuthContext';
import { rdoPath } from '../../auth/rolePath';
import { GroupedReportList } from '../../components/reports/GroupedReportList';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { useAccumulatedReportsPage } from '../../hooks/useReports';
import { ProjectSortButton, type ProjectSortDirection } from '../../utils/projectSort';
import { handleHorizontalTabListKeyDown } from '../../utils/tabKeyboard';

type MyReportsTab = 'pending' | 'approved';
const REPORT_PAGE_SIZE = 25;

export function MyReportsPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<MyReportsTab>('pending');
  const [search, setSearch] = useState('');
  const [projectSortDir, setProjectSortDir] = useState<ProjectSortDirection>('asc');
  const statuses = tab === 'pending' ? ['PENDING', 'RETURNED'] : ['APPROVED', 'SIGNED'];
  const reportsQuery = useAccumulatedReportsPage({
    mine: true,
    summary: true,
    projectActive: true,
    statuses,
    search,
    projectSort: projectSortDir,
    pageSize: REPORT_PAGE_SIZE
  });
  const reports = reportsQuery.items;

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
            <input
              aria-label={tab === 'pending' ? 'Buscar em pendentes' : 'Buscar em aprovados'}
              placeholder={tab === 'pending' ? 'Buscar em pendentes' : 'Buscar em aprovados'}
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
          </div>
          <div className="admin-create-toolbar collaborator-report-sort-toolbar">
            <ProjectSortButton
              direction={projectSortDir}
              onToggle={() => setProjectSortDir(direction => direction === 'asc' ? 'desc' : 'asc')}
            />
          </div>
        </section>
        {reportsQuery.isLoading ? (
          <div className="page-card placeholder-copy">Carregando relatórios...</div>
        ) : null}
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
        {reportsQuery.hasMore ? (
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
