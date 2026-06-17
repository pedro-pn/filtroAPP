import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../auth/AuthContext';
import { rdoPath } from '../../auth/rolePath';
import { serviceTypeLabels } from '../../components/reports/ServiceFields';
import { useReportMutations, useReports } from '../../hooks/useReports';
import { SearchBar } from '../../components/ui/SearchBar';
import { useToast } from '../../components/ui/Toast';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { collectOngoingServices } from '../../utils/ongoingServices';
import { matchesSearch, reportSearchParts } from '../../utils/search';

export function OngoingServicesPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const showToast = useToast();
  const reportsQuery = useReports({ mine: true, summary: true });
  const reportMutations = useReportMutations();
  const [search, setSearch] = useState('');
  const services = useMemo(
    () => collectOngoingServices(reportsQuery.data || []).filter(item => matchesSearch([
      item.projectTitle,
      item.serviceType,
      item.equipment,
      item.system,
      item.report.sequenceNumber,
      ...reportSearchParts(item.report)
    ], search)),
    [reportsQuery.data, search]
  );
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

  async function handleDeleteService(reportId: string, serviceId: string) {
    if (!window.confirm('Excluir este serviço em andamento?')) return;
    try {
      await reportMutations.deleteService.mutateAsync({ reportId, serviceId });
      showToast('Serviço excluído.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível excluir o serviço.', 'error');
    }
  }

  return (
    <Shell>
      <TopBar
        title="Serviços em andamento"
        subtitle={user?.name}
        actions={
          <>
            <button className="topbar-chip" type="button" onClick={() => navigate(rdoPath('/home'))}>
              Voltar
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
            <SearchBar value={search} onChange={setSearch} placeholder="Buscar em serviços em andamento" />
          </div>
        </section>
        {reportsQuery.isLoading ? (
          <div className="page-card placeholder-copy">Carregando serviços em andamento...</div>
        ) : null}
        {!reportsQuery.isLoading && !services.length ? (
          <div className="page-card placeholder-copy">
            {search.trim() ? 'Nenhum serviço em andamento encontrado.' : 'Nenhum serviço em andamento.'}
          </div>
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
                    <div className="admin-card-actions">
                      <span className="status-pill status-pending">Em andamento</span>
                      <button
                        className="mini-btn danger"
                        type="button"
                        disabled={reportMutations.deleteService.isPending}
                        onClick={() => void handleDeleteService(item.report.id, item.service.id)}
                      >
                        Excluir
                      </button>
                    </div>
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
