import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../auth/AuthContext';
import { GroupedReportList } from '../../components/reports/GroupedReportList';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { useReports } from '../../hooks/useReports';

export function MyReportsPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const reportsQuery = useReports({ mine: true });

  const groups = useMemo(() => {
    const active = (reportsQuery.data || []).filter(r => r.project?.isActive !== false);
    const sorted = [...active].sort(
      (a, b) => new Date(b.reportDate).getTime() - new Date(a.reportDate).getTime()
    );
    return sorted;
  }, [reportsQuery.data]);

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
        {reportsQuery.isLoading ? (
          <div className="page-card placeholder-copy">Carregando relatórios...</div>
        ) : null}
        {!reportsQuery.isLoading && !groups.length ? (
          <div className="page-card placeholder-copy">Nenhum relatório encontrado para suas missões.</div>
        ) : null}
        <GroupedReportList reports={groups} storageKey={`collaborator-report-groups:${user?.id || user?.username || 'anonymous'}`} />
        <button className="secondary-button" type="button" onClick={() => navigate('/home')}>
          Voltar
        </button>
      </main>
    </Shell>
  );
}
