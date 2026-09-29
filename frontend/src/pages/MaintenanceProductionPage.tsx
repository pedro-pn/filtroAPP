import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';

import {
  getOperationalContext,
  listMaintenanceHistoryCategories,
  listMaintenanceSchedule,
  listOperationalReports,
  listStandaloneMaintenances,
  type MaintenanceHistorySort,
  type MaintenanceHistorySortDirection,
  type MaintenanceScheduleStatus,
  type OperationalStatus
} from '../api/operationalReports';
import {
  allowedOperationalModuleTabs,
  operationalReportEditorPath,
  resolveOperationalModuleTab,
  type OperationalModuleTab
} from '../auth/reportPermissions';
import { useAuth } from '../auth/AuthContext';
import { MaintenanceHistoryTable } from '../components/reports/MaintenanceHistoryTable';
import { MaintenanceReportListing } from '../components/reports/MaintenanceReportListing';
import { MaintenanceScheduleBoard } from '../components/reports/MaintenanceScheduleBoard';
import { OperationalReportSummaryCard } from '../components/reports/OperationalReportSummaryCard';
import { OperationalReportsNovelty } from '../components/reports/OperationalReportsNovelty';
import { Alert, Button, Card, EmptyState, Field, Select, Skeleton } from '../components/ui/ds';
import { SearchBar } from '../components/ui/SearchBar';
import { PageHeader } from '../layout/PageHeader';
import { OperationalModuleAppShell } from './OperationalModuleAppShell';
import './MaintenanceProductionPage.ds.css';

const tabLabels: Record<OperationalModuleTab, string> = {
  manutencao: 'Manutenção',
  producao: 'Produção',
  'programacao-manutencao': 'Programação',
  'historico-manutencao': 'Histórico de manutenção'
};

function normalizedText(value: unknown) {
  return String(value || '').trim().toLocaleLowerCase('pt-BR');
}

function validStatus(value: string | null): OperationalStatus | undefined {
  return value === 'PENDING' || value === 'RETURNED' || value === 'APPROVED'
    ? value
    : undefined;
}

function validMaintenanceHistorySort(
  value: string | null
): MaintenanceHistorySort {
  return value === 'tag' ||
    value === 'equipment' ||
    value === 'category' ||
    value === 'responsible'
    ? value
    : 'maintenanceDate';
}

function validSortDirection(
  value: string | null
): MaintenanceHistorySortDirection {
  return value === 'asc' ? 'asc' : 'desc';
}

function validScheduleStatus(
  value: string | null
): MaintenanceScheduleStatus | undefined {
  return value === 'OVERDUE' ||
    value === 'DUE_TODAY' ||
    value === 'UPCOMING' ||
    value === 'NO_HISTORY' ||
    value === 'UNCONFIGURED'
    ? value
    : undefined;
}

export function MaintenanceProductionPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const permissions = user?.reportEmissionPermissions || [];
  const tabs = allowedOperationalModuleTabs(permissions);
  const tab = resolveOperationalModuleTab(permissions, searchParams.get('tab'));
  const search = searchParams.get('q') || '';
  const status = validStatus(searchParams.get('status'));
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const scheduleStatus = validScheduleStatus(searchParams.get('prazo'));
  const categoryId = searchParams.get('categoria') || undefined;
  const historySort = validMaintenanceHistorySort(searchParams.get('sort'));
  const historySortDirection = validSortDirection(
    searchParams.get('direction')
  );
  const maintenanceActive = tab === 'manutencao';
  const productionActive = tab === 'producao';
  const scheduleActive = tab === 'programacao-manutencao';
  const canManageEquipment =
    user?.accountType === 'ADMIN' ||
    Boolean(user?.moduleRoles?.includes('equipamentos:manager'));
  const subNavigation = tabs.map(item => ({
    id: item,
    label: tabLabels[item],
    href: `/manutencao-producao?tab=${item}`,
    active: tab === item
  }));

  const contextQuery = useQuery({
    queryKey: ['operational-reports', 'context'],
    queryFn: getOperationalContext,
    enabled: Boolean(tab)
  });
  const reportsQuery = useQuery({
    queryKey: ['operational-reports', 'module-list', tab, status],
    queryFn: () =>
      listOperationalReports({
        kind: maintenanceActive ? 'MAINTENANCE' : 'PRODUCTION',
        status,
        pageSize: 100
      }),
    enabled: maintenanceActive || productionActive
  });
  const standaloneQuery = useQuery({
    queryKey: ['operational-reports', 'module-list', 'standalone', status],
    queryFn: () => listStandaloneMaintenances({ status, pageSize: 100 }),
    enabled: maintenanceActive
  });
  const scheduleQuery = useQuery({
    queryKey: [
      'operational-reports',
      'maintenance-schedule',
      search,
      categoryId,
      scheduleStatus,
      page
    ],
    queryFn: () =>
      listMaintenanceSchedule({
        q: search || undefined,
        categoryId,
        status: scheduleStatus,
        page,
        pageSize: 50
      }),
    enabled: scheduleActive
  });
  const historyCategoriesQuery = useQuery({
    queryKey: ['operational-reports', 'maintenance-history-categories'],
    queryFn: listMaintenanceHistoryCategories,
    enabled: tab === 'historico-manutencao'
  });

  useEffect(() => {
    if (!tab || searchParams.get('tab') === tab) return;
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    next.delete('status');
    next.delete('q');
    next.delete('page');
    next.delete('sort');
    next.delete('direction');
    next.delete('prazo');
    next.delete('categoria');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, tab]);

  const visibleReports = useMemo(() => {
    const needle = normalizedText(search);
    return (reportsQuery.data?.items || []).filter((report) => {
      if (!needle) return true;
      return normalizedText([
        report.project.code,
        report.project.name,
        report.sequenceNumber,
        report.createdBy.name,
        report.reportDate,
        ...report.maintenanceRecords.flatMap((record) => [
          record.equipment.code,
          record.equipment.name
        ]),
        ...report.chemicalCleanings.map((item) => item.description)
      ].join(' ')).includes(needle);
    });
  }, [reportsQuery.data?.items, search]);
  const visibleStandalone = useMemo(() => {
    const needle = normalizedText(search);
    return (standaloneQuery.data?.items || []).filter((record) => {
      if (!needle) return true;
      return normalizedText([
        record.equipment.code,
        record.equipment.name,
        record.responsibleNameSnapshot,
        record.maintenanceDate,
        ...record.selectedServices.map((item) => item.label)
      ].join(' ')).includes(needle);
    });
  }, [search, standaloneQuery.data?.items]);

  function updateParams(values: Record<string, string | number | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(values)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, String(value));
    }
    setSearchParams(next, { replace: true });
  }

  function selectTab(nextTab: OperationalModuleTab) {
    updateParams({
      tab: nextTab,
      q: null,
      status: null,
      page: null,
      sort: null,
      direction: null,
      prazo: null,
      categoria: null
    });
  }

  if (!user) return null;
  if (!tab) return <Navigate to="/modulos" replace />;

  const isListLoading =
    reportsQuery.isLoading || (maintenanceActive && standaloneQuery.isLoading);
  const isListError =
    reportsQuery.isError || (maintenanceActive && standaloneQuery.isError);
  const hasListItems = visibleReports.length || (maintenanceActive && visibleStandalone.length);

  return (
    <OperationalModuleAppShell
      moduleId="maintenance-production"
      title="Manutenção e produção"
      sectionLabel={tabLabels[tab]}
      subNavigation={subNavigation}
    >
      <main className="fv-ds operational-module-page operational-module-page-v2">
        <PageHeader
          title={tabLabels[tab]}
          description={tab === 'historico-manutencao'
            ? 'Consulte as manutenções aprovadas dos equipamentos.'
            : tab === 'programacao-manutencao'
              ? 'Acompanhe os prazos preventivos dos equipamentos.'
              : 'Consulte os relatórios e registre novos serviços.'}
        />
        <div
          className={`nav-tabs-wrap operational-module-tabs operational-module-tabs-${tabs.length}`}
          data-operational-module-tabs
        >
          <div className="nav-tabs" role="tablist" aria-label="Áreas de manutenção e produção">
            {tabs.map((item) => (
              <button
                className={`nav-tab ${tab === item ? 'active' : ''}`}
                type="button"
                role="tab"
                aria-selected={tab === item}
                key={item}
                data-operational-schedule-tab={
                  item === 'programacao-manutencao' ? true : undefined
                }
                onClick={() => selectTab(item)}
              >
                {tabLabels[item]}
              </button>
            ))}
          </div>
        </div>

        {tab === 'historico-manutencao' ? (
          <>
            <div className="operational-history-search-panel" role="search">
              <Field id="maintenance-history-search" label="Buscar" optionalText="">
                <SearchBar
                  id="maintenance-history-search-control"
                  value={search}
                  onChange={(value) => updateParams({ q: value, page: null })}
                  placeholder="TAG, equipamento ou categoria"
                />
              </Field>
              <Field
                id="maintenance-history-category"
                label="Categoria"
                optionalText=""
                errorText={historyCategoriesQuery.isError
                  ? 'Não foi possível carregar as categorias.'
                  : undefined}
              >
                <Select
                  value={categoryId || ''}
                  disabled={historyCategoriesQuery.isError}
                  onChange={(event) =>
                    updateParams({ categoria: event.target.value, page: null })
                  }
                >
                  <option value="">Todas as categorias</option>
                  {(historyCategoriesQuery.data || []).map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <MaintenanceHistoryTable
              search={search}
              categoryId={categoryId}
              page={page}
              sortBy={historySort}
              sortDirection={historySortDirection}
              onPageChange={(nextPage) => updateParams({ page: nextPage })}
              onSortChange={(sortBy, sortDirection) =>
                updateParams({
                  sort: sortBy,
                  direction: sortDirection,
                  page: null
                })
              }
            />
          </>
        ) : tab === 'programacao-manutencao' ? (
          <>
            <Card className="operational-module-toolbar" padding="md">
              <div>
                <div className="section-title">Programação de manutenção</div>
                <p className="placeholder-copy">
                  Acompanhe os prazos preventivos de todos os equipamentos.
                </p>
              </div>
              {canManageEquipment ? (
                <div className="operational-module-create-actions">
                  <Button
                    variant="secondary"
                    onClick={() => navigate('/equipamentos?tab=maintenance')}
                  >
                    Configurar prazos
                  </Button>
                </div>
              ) : null}
            </Card>

            <Card className="operational-schedule-filters" padding="md">
              <SearchBar
                id="maintenance-schedule-search"
                value={search}
                onChange={(value) => updateParams({ q: value, page: null })}
                placeholder="Buscar TAG, nome ou categoria"
              />
              <Field id="maintenance-schedule-category" label="Categoria">
                <Select
                  id="maintenance-schedule-category"
                  value={categoryId || ''}
                  onChange={(event) =>
                    updateParams({ categoria: event.target.value, page: null })
                  }
                >
                  <option value="">Todas</option>
                  {(scheduleQuery.data?.categories || []).map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="maintenance-schedule-status" label="Situação">
                <Select
                  id="maintenance-schedule-status"
                  value={scheduleStatus || ''}
                  onChange={(event) =>
                    updateParams({ prazo: event.target.value, page: null })
                  }
                >
                  <option value="">Todas</option>
                  <option value="OVERDUE">Vencida</option>
                  <option value="DUE_TODAY">Vence hoje</option>
                  <option value="UPCOMING">Em dia</option>
                  <option value="NO_HISTORY">Sem histórico</option>
                  <option value="UNCONFIGURED">Não configurado</option>
                </Select>
              </Field>
            </Card>

            {scheduleQuery.isLoading ? (
              <section className="page-card">Carregando programação…</section>
            ) : null}
            {scheduleQuery.isError ? (
              <div className="inline-error">
                Não foi possível carregar a programação de manutenção.
              </div>
            ) : null}
            {scheduleQuery.data ? (
              <MaintenanceScheduleBoard
                data={scheduleQuery.data}
                onPageChange={(nextPage) => updateParams({ page: nextPage })}
              />
            ) : null}
            {scheduleQuery.data && !scheduleQuery.data.items.length ? (
              <section className="page-card placeholder-copy">
                Nenhum equipamento encontrado para os filtros informados.
              </section>
            ) : null}
          </>
        ) : (
          <>
            <Card className="operational-module-toolbar" padding="md">
              <div>
                <div className="section-title">
                  {maintenanceActive ? 'Relatórios de manutenção' : 'Relatórios de produção'}
                </div>
                <p className="placeholder-copy">
                  Consulte o que já foi feito ou inicie um novo registro.
                </p>
              </div>
              <div className="operational-module-create-actions">
                {maintenanceActive ? (
                  <>
                    <Button
                      variant="primary"
                      data-operational-new-report
                      onClick={() => navigate('/manutencao-producao/relatorio/novo?tipo=manutencao')}
                    >
                      Novo relatório 5002
                    </Button>
                    <Button
                      variant="secondary"
                      data-operational-standalone
                      onClick={() => navigate('/manutencao-producao/relatorio/novo?tipo=manutencao-avulsa')}
                    >
                      Manutenção avulsa
                    </Button>
                  </>
                ) : (
                  <Button
                    data-operational-new-report
                    onClick={() => navigate('/manutencao-producao/relatorio/novo?tipo=producao')}
                  >
                    Novo relatório 5004
                  </Button>
                )}
              </div>
            </Card>

            <Card className="operational-module-filters" padding="md">
              <SearchBar
                id="operational-report-search"
                value={search}
                onChange={(value) => updateParams({ q: value })}
                placeholder="Buscar no histórico"
              />
              <Field id="operational-report-status" label="Status">
                <Select
                  id="operational-report-status"
                  value={status || ''}
                  onChange={(event) => updateParams({ status: event.target.value })}
                >
                  <option value="">Todos</option>
                  <option value="PENDING">Pendente</option>
                  <option value="RETURNED">Devolvido</option>
                  <option value="APPROVED">Aprovado</option>
                </Select>
              </Field>
            </Card>

            {isListLoading ? <Skeleton variant="card" label="Carregando relatórios…" /> : null}
            {isListError ? <Alert tone="danger">Não foi possível carregar os relatórios.</Alert> : null}
            {!isListLoading && !isListError && hasListItems ? (
              maintenanceActive ? (
                <MaintenanceReportListing
                  reports={visibleReports}
                  standalone={visibleStandalone}
                  onOpenReport={report => navigate(operationalReportEditorPath(
                    'manutencao', report.id, Boolean(contextQuery.data?.canReviewMaintenance)
                  ))}
                  onOpenStandalone={record => navigate(operationalReportEditorPath(
                    'manutencao-avulsa', record.id, Boolean(contextQuery.data?.canReviewMaintenance)
                  ))}
                />
              ) : (
                <div className="report-type-list operational-module-report-list">
                  {visibleReports.map(report => <OperationalReportSummaryCard
                    key={report.id}
                    report={report}
                    onOpen={() => navigate(operationalReportEditorPath(
                      'producao', report.id, Boolean(contextQuery.data?.canReviewProduction)
                    ))}
                  />)}
                </div>
              )
            ) : null}
            {!isListLoading && !isListError && !hasListItems ? (
              <EmptyState variant="search" title="Nenhum relatório encontrado." description="Ajuste a busca ou o filtro de status para ver outros registros." />
            ) : null}
          </>
        )}
      </main>
      <OperationalReportsNovelty user={user} eligible />
    </OperationalModuleAppShell>
  );
}
