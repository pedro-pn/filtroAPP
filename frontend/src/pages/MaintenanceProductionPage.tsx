import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';

import {
  getOperationalContext,
  listMaintenanceSchedule,
  listOperationalReports,
  listStandaloneMaintenances,
  type MaintenanceHistorySort,
  type MaintenanceHistorySortDirection,
  type MaintenanceScheduleStatus,
  type OperationalStatus
} from '../api/operationalReports';
import { accountPageStateFromPath } from '../auth/moduleNavigation';
import {
  allowedOperationalModuleTabs,
  operationalReportEditorPath,
  resolveOperationalModuleTab,
  type OperationalModuleTab
} from '../auth/reportPermissions';
import { useAuth } from '../auth/AuthContext';
import { MaintenanceHistoryTable } from '../components/reports/MaintenanceHistoryTable';
import { MaintenanceScheduleBoard } from '../components/reports/MaintenanceScheduleBoard';
import {
  OperationalReportSummaryCard,
  StandaloneMaintenanceSummaryCard
} from '../components/reports/OperationalReportSummaryCard';
import { OperationalReportsNovelty } from '../components/reports/OperationalReportsNovelty';
import { Button } from '../components/ui/Button';
import { SearchBar } from '../components/ui/SearchBar';
import { Shell } from '../layout/Shell';
import { TopBar } from '../layout/TopBar';

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
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const permissions = user?.reportEmissionPermissions || [];
  const tabs = allowedOperationalModuleTabs(permissions);
  const tab = resolveOperationalModuleTab(permissions, searchParams.get('tab'));
  const search = searchParams.get('q') || '';
  const status = validStatus(searchParams.get('status'));
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const scheduleStatus = validScheduleStatus(searchParams.get('prazo'));
  const scheduleCategoryId = searchParams.get('categoria') || undefined;
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
      scheduleCategoryId,
      scheduleStatus,
      page
    ],
    queryFn: () =>
      listMaintenanceSchedule({
        q: search || undefined,
        categoryId: scheduleCategoryId,
        status: scheduleStatus,
        page,
        pageSize: 50
      }),
    enabled: scheduleActive
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
  const hasListItems = visibleReports.length || visibleStandalone.length;

  return (
    <Shell>
      <TopBar
        title="Manutenção e produção"
        subtitle={tabLabels[tab]}
        showLogo
        actions={
          <>
            <button
              className="topbar-chip"
              type="button"
              onClick={() =>
                navigate('/conta', { state: accountPageStateFromPath(location) })
              }
            >
              Conta
            </button>
            <button
              className="topbar-chip"
              type="button"
              onClick={async () => {
                await logout();
                navigate('/login', { replace: true });
              }}
            >
              Sair
            </button>
          </>
        }
      />

      <main className="page-scroll operational-module-page">
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
            <section className="page-card operational-module-toolbar">
              <div>
                <div className="section-title">Histórico de manutenção</div>
                <p className="placeholder-copy">
                  Todas as manutenções de equipamentos já aprovadas.
                </p>
              </div>
              <SearchBar
                id="maintenance-history-search"
                value={search}
                onChange={(value) => updateParams({ q: value, page: null })}
                placeholder="Buscar TAG, nome ou categoria"
              />
            </section>
            <MaintenanceHistoryTable
              search={search}
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
            <section className="page-card operational-module-toolbar">
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
            </section>

            <section className="page-card operational-schedule-filters">
              <SearchBar
                id="maintenance-schedule-search"
                value={search}
                onChange={(value) => updateParams({ q: value, page: null })}
                placeholder="Buscar TAG, nome ou categoria"
              />
              <div className="field-group">
                <label htmlFor="maintenance-schedule-category">Categoria</label>
                <select
                  id="maintenance-schedule-category"
                  value={scheduleCategoryId || ''}
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
                </select>
              </div>
              <div className="field-group">
                <label htmlFor="maintenance-schedule-status">Situação</label>
                <select
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
                </select>
              </div>
            </section>

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
            <section className="page-card operational-module-toolbar">
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
            </section>

            <section className="page-card operational-module-filters">
              <SearchBar
                id="operational-report-search"
                value={search}
                onChange={(value) => updateParams({ q: value })}
                placeholder="Buscar no histórico"
              />
              <div className="field-group">
                <label htmlFor="operational-report-status">Status</label>
                <select
                  id="operational-report-status"
                  value={status || ''}
                  onChange={(event) => updateParams({ status: event.target.value })}
                >
                  <option value="">Todos</option>
                  <option value="PENDING">Pendente</option>
                  <option value="RETURNED">Devolvido</option>
                  <option value="APPROVED">Aprovado</option>
                </select>
              </div>
            </section>

            {isListLoading ? <section className="page-card">Carregando relatórios…</section> : null}
            {isListError ? <div className="inline-error">Não foi possível carregar os relatórios.</div> : null}
            {!isListLoading && !isListError ? (
              <div className="report-type-list operational-module-report-list">
                {visibleReports.map((report) => (
                  <OperationalReportSummaryCard
                    key={report.id}
                    report={report}
                    onOpen={() => navigate(operationalReportEditorPath(
                      report.kind === 'MAINTENANCE' ? 'manutencao' : 'producao',
                      report.id,
                      report.kind === 'MAINTENANCE'
                        ? Boolean(contextQuery.data?.canReviewMaintenance)
                        : Boolean(contextQuery.data?.canReviewProduction)
                    ))}
                  />
                ))}
                {maintenanceActive
                  ? visibleStandalone.map((record) => (
                      <StandaloneMaintenanceSummaryCard
                        key={record.id}
                        record={record}
                        onOpen={() => navigate(operationalReportEditorPath(
                          'manutencao-avulsa',
                          record.id,
                          Boolean(contextQuery.data?.canReviewMaintenance)
                        ))}
                      />
                    ))
                  : null}
              </div>
            ) : null}
            {!isListLoading && !isListError && !hasListItems ? (
              <section className="page-card placeholder-copy">
                Nenhum relatório encontrado.
              </section>
            ) : null}
          </>
        )}
      </main>
      <OperationalReportsNovelty user={user} eligible />
    </Shell>
  );
}
