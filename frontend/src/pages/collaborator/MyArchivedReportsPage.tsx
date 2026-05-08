import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../auth/AuthContext';
import { GroupedReportList } from '../../components/reports/GroupedReportList';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { useReports } from '../../hooks/useReports';
import { matchesSearch, reportSearchParts } from '../../utils/search';

export function MyArchivedReportsPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const reportsQuery = useReports({ mine: true });
  const [search, setSearch] = useState('');

  const groups = useMemo(() => {
    const archived = (reportsQuery.data || [])
      .filter(r => r.project?.isActive === false)
      .filter(r => matchesSearch(reportSearchParts(r), search));
    const sorted = [...archived].sort(
      (a, b) => new Date(b.reportDate).getTime() - new Date(a.reportDate).getTime()
    );
    return sorted;
  }, [reportsQuery.data, search]);

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
            <button className="topbar-chip" type="button" onClick={() => navigate('/home')}>
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
        <GroupedReportList reports={groups} archived storageKey={`collaborator-archived-report-groups:${user?.id || user?.username || 'anonymous'}`} />
        <button className="secondary-button" type="button" onClick={() => navigate('/home')}>
          Voltar
        </button>
      </main>
    </Shell>
  );
}
