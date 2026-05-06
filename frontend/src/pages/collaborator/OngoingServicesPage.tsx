import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../auth/AuthContext';
import { serviceTypeLabels } from '../../components/reports/ServiceFields';
import { useReports } from '../../hooks/useReports';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { collectOngoingServices } from '../../utils/ongoingServices';

export function OngoingServicesPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const reportsQuery = useReports({ mine: true });
  const services = useMemo(() => collectOngoingServices(reportsQuery.data || []), [reportsQuery.data]);
  const groups = useMemo(() => {
    return services.reduce<Record<string, typeof services>>((acc, item) => {
      if (!acc[item.projectTitle]) acc[item.projectTitle] = [];
      acc[item.projectTitle].push(item);
      return acc;
    }, {});
  }, [services]);

  async function handleLogout() {
    await logout();
    navigate('/', { replace: true });
  }

  return (
    <Shell>
      <TopBar
        title="Serviços em andamento"
        subtitle={user?.name}
        actions={
          <>
            <button className="topbar-chip" type="button" onClick={() => navigate('/home')}>
              Voltar
            </button>
            <button className="topbar-chip" type="button" onClick={handleLogout}>
              Sair
            </button>
          </>
        }
      />
      <main className="page-scroll">
        {reportsQuery.isLoading ? (
          <div className="page-card placeholder-copy">Carregando serviços em andamento...</div>
        ) : null}
        {!reportsQuery.isLoading && !services.length ? (
          <div className="page-card placeholder-copy">Nenhum serviço em andamento.</div>
        ) : null}
        {Object.entries(groups).map(([projectTitle, items]) => (
          <section className="page-card" key={projectTitle}>
            <div className="section-title">{projectTitle}</div>
            <div className="admin-stack">
              {items.map(item => (
                <article className="ongoing-item-react" key={`${item.report.id}-${item.service.id}`}>
                  <div className="admin-item-row">
                    <div className="admin-item-main">
                      <div className="admin-item-title">{serviceTypeLabels[item.serviceType] || item.serviceType}</div>
                      <div className="admin-item-sub">
                        {item.equipment}{item.system ? ` - ${item.system}` : ''} - RDO {item.report.sequenceNumber || '---'}
                      </div>
                    </div>
                    <span className="status-pill status-pending">Em andamento</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </main>
    </Shell>
  );
}
