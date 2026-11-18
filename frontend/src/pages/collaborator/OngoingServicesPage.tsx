import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import { rdoPath } from '../../auth/rolePath';
import { AppIcon } from '../../components/icons/AppIcon';
import { serviceTypeLabels } from '../../components/reports/serviceTypes';
import { useReportMutations, useReports } from '../../hooks/useReports';
import { Button, Card, SearchInput, StatusPill } from '../../components/ui/ds';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { DS_ICONS } from '../../components/ui/ds/icons';
import { useToast } from '../../components/ui/ToastContext';
import { PageHeader } from '../../layout/PageHeader';
import { collectOngoingServices } from '../../utils/ongoingServices';
import { matchesSearch, reportSearchParts } from '../../utils/search';
import { RdoAppShell } from '../RdoAppShell';

export function OngoingServicesPage() {
  const navigate = useNavigate();
  const showToast = useToast();
  const reportsQuery = useReports({ mine: true, summary: true });
  const reportMutations = useReportMutations();
  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ reportId: string; serviceId: string; label: string } | null>(null);
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
  const navigationSections = useMemo(() => [
    { id: 'home', label: 'Início', href: rdoPath('/home'), active: false },
    { id: 'pending', label: 'Pendentes', href: `${rdoPath('/meus-relatorios')}?tab=pending`, active: false },
    { id: 'approved', label: 'Aprovados', href: `${rdoPath('/meus-relatorios')}?tab=approved`, active: false },
    { id: 'ongoing', label: 'Em andamento', href: rdoPath('/andamento'), active: true },
    { id: 'archived', label: 'Arquivados', href: rdoPath('/meus-relatorios/arquivados'), active: false }
  ], []);

  async function handleDeleteService(reportId: string, serviceId: string) {
    setDeleteTarget(null);
    try {
      await reportMutations.deleteService.mutateAsync({ reportId, serviceId });
      showToast('Serviço excluído.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível excluir o serviço.', 'error');
    }
  }

  return (
    <RdoAppShell
      title="Serviços em andamento"
      sectionLabel="Em andamento"
      subNavigation={navigationSections}
    >
      <main className="fv-ds rdo-role-page rdo-ongoing-services-page">
        <PageHeader
          title="Serviços em andamento"
          description="Acompanhe serviços ainda abertos e remova registros que não serão continuados."
          actions={(
            <Button variant="secondary" size="sm" onClick={() => navigate(rdoPath('/home'))}>
              Voltar ao início
            </Button>
          )}
      />
        <Card className="rdo-role-toolbar" padding="sm">
          <div className="rdo-role-toolbar__controls">
            <SearchInput value={search} onChange={setSearch} placeholder="Buscar em serviços em andamento" aria-label="Buscar em serviços em andamento" />
          </div>
        </Card>
        {reportsQuery.isLoading ? (
          <Card className="placeholder-copy" padding="lg">Carregando serviços em andamento...</Card>
        ) : null}
        {!reportsQuery.isLoading && !services.length ? (
          <Card className="placeholder-copy" padding="lg">
            {search.trim() ? 'Nenhum serviço em andamento encontrado.' : 'Nenhum serviço em andamento.'}
          </Card>
        ) : null}
        {Object.entries(groups).map(([projectTitle, items]) => (
          <Card className="rdo-ongoing-project" key={projectTitle} title={projectTitle} padding="md">
            <div className="rdo-ongoing-project__list">
              {items.map(item => (
                <Card className="rdo-ongoing-service" padding="sm" key={`${item.report.id}-${item.service.id}`}>
                  <div className="rdo-ongoing-service__main">
                    <span className="rdo-ongoing-service__icon"><AppIcon icon={DS_ICONS.servicePressure} size="md" /></span>
                    <div className="rdo-ongoing-service__copy">
                      <div className="admin-item-title">{serviceTypeLabels[item.serviceType] || item.serviceType}</div>
                      <div className="rdo-ongoing-service__meta">
                        {item.equipment}{item.system ? ` - ${item.system}` : ''} - RDO {item.report.sequenceNumber || '---'}
                      </div>
                    </div>
                    <div className="rdo-ongoing-service__actions">
                      <StatusPill status="pending" label="Em andamento" tone="warning" />
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={reportMutations.deleteService.isPending}
                        onClick={() => setDeleteTarget({
                          reportId: item.report.id,
                          serviceId: item.service.id,
                          label: serviceTypeLabels[item.serviceType] || item.serviceType
                        })}
                      >
                        Excluir
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </Card>
        ))}
        <ConfirmDialog
          open={Boolean(deleteTarget)}
          appearance="design-system"
          title="Excluir serviço em andamento?"
          description="O serviço será removido deste relatório e não poderá ser recuperado por esta tela."
          highlight={deleteTarget?.label}
          confirmLabel="Excluir serviço"
          confirmDisabled={reportMutations.deleteService.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => deleteTarget && void handleDeleteService(deleteTarget.reportId, deleteTarget.serviceId)}
        />
      </main>
    </RdoAppShell>
  );
}
