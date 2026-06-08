import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../auth/AuthContext';
import { rdoPath } from '../../auth/rolePath';
import { GroupedReportList } from '../../components/reports/GroupedReportList';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { useAccumulatedReportsPage } from '../../hooks/useReports';

const REPORT_PAGE_SIZE = 25;

export function MyArchivedReportsPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [search, setSearch] = useState('');
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
        title="Arquivados"
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
          <div className="admin-search-row">
            <input
              aria-label="Buscar em arquivados"
              placeholder="Buscar em arquivados"
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
          </div>
        </section>
        {reportsQuery.isLoading ? (
          <div className="page-card placeholder-copy">Carregando relatórios...</div>
        ) : null}
        {!reportsQuery.isLoading && !groups.length ? (
          <div className="page-card placeholder-copy">
            {search.trim() ? 'Nenhum relatório arquivado encontrado.' : 'Nenhum relatório arquivado.'}
          </div>
        ) : null}
        <GroupedReportList
          reports={groups}
          archived
          storageKey={`collaborator-archived-report-groups:${user?.id || user?.username || 'anonymous'}`}
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
