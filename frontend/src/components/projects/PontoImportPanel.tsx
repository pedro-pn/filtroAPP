import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  deletePontoImport,
  getPontoColaboradores,
  getPontoImports,
  getPontoMaisIgnoredProjectTags,
  getPontoLinkCollaborators,
  getPontoMaisExternalEmployees,
  getPontoMaisIntegrationStatus,
  getPontoMaisPending,
  getPontoMaisReconciliationProjects,
  getPontoMaisSyncRuns,
  getPontoPendencyCounts,
  linkPontoMaisExternalEmployee,
  linkPontoMaisProjectTag,
  linkPontoName,
  pontoMaisBootstrapStatusLabel,
  pontoMaisSyncTriggerLabel,
  setPontoMaisExternalEmployeeIgnored,
  setPontoMaisProjectTagIgnored,
  syncPontoMaisRange,
  pontoMaisSyncWindows,
  type PontoImportRow,
  type PontoImportSourceFilter,
  type PontoMaisSyncRun,
  type PontoMaisPending
} from '../../api/acompanhamentoPonto';
import { useAuth } from '../../auth/AuthContext';
import { useUrlParamState } from '../../hooks/useUrlParamState';
import { Badge, Button, Card, DataTable, EmptyState, Field, Input, Select } from '../ui/ds';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useToast } from '../ui/ToastContext';
import { acompanhamentoRefreshQueryOptions } from './acompanhamentoRefresh';
import { PontoMaisSyncNovelty } from './PontoMaisSyncNovelty';
import { UnallocatedDaysPanel } from './UnallocatedDaysPanel';
import { RdoSimulationExclusionsPanel } from './RdoSimulationExclusionsPanel';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime())
    ? fmtDate(iso)
    : parsed.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

// Mesmo critério do backend (normalizeName): sem acento, minúsculo, espaços colapsados.
function normalizeForMatch(value: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function collaboratorOptionLabel(collaborator: { name: string; role: string | null; isActive?: boolean }) {
  const label = `${collaborator.name}${collaborator.role ? ` — ${collaborator.role}` : ''}`;
  return collaborator.isActive === false ? `${label} (inativo)` : label;
}

function importSourceLabel(item: PontoImportRow) {
  return item.source === 'PONTOMAIS_API' ? 'API Ponto Mais' : 'Planilha XLSX';
}

function syncRunStatus(run: PontoMaisSyncRun) {
  return run.status === 'SUCCEEDED' ? 'Concluída' : run.status === 'FAILED' ? 'Falhou' : 'Em andamento';
}

function syncRunTone(run: PontoMaisSyncRun): 'success' | 'danger' | 'neutral' {
  return run.status === 'SUCCEEDED' ? 'success' : run.status === 'FAILED' ? 'danger' : 'neutral';
}

export function PontoSyncHistoryTable({ runs, loading = false }: { runs: PontoMaisSyncRun[]; loading?: boolean }) {
  return (
    <DataTable
      ariaLabel="Histórico de sincronizações do ponto"
      mobileBreakpoint="lg"
      rows={runs}
      getRowId={run => run.id}
      loading={loading}
      columns={[
        { key: 'status', header: 'Status', render: run => (
          <div className="acp-cost-ds__history-status">
            <Badge tone={syncRunTone(run)}>{syncRunStatus(run)}</Badge>
            {run.errorMessage ? <span>{run.errorMessage}</span> : null}
          </div>
        ) },
        { key: 'trigger', header: 'Origem', render: run => pontoMaisSyncTriggerLabel(run.trigger) },
        { key: 'period', header: 'Período', render: run => `${fmtDate(run.periodStart)} – ${fmtDate(run.periodEnd)}` },
        { key: 'records', header: 'Registros', render: run => `${run.workDaysRead} jornadas · ${run.timeCardsRead} batidas` },
        { key: 'links', header: 'Vínculos', render: run => `${run.collaboratorsMatched} vinculados · ${run.pendingCount} pendência(s)` },
        { key: 'completed', header: 'Concluída', render: run => fmtDateTime(run.completedAt) }
      ]}
      mobile={{ renderItem: run => ({
        title: `${fmtDate(run.periodStart)} – ${fmtDate(run.periodEnd)}`,
        subtitle: pontoMaisSyncTriggerLabel(run.trigger),
        status: <Badge tone={syncRunTone(run)}>{syncRunStatus(run)}</Badge>,
        metadata: [
          { label: 'Jornadas / batidas', value: `${run.workDaysRead} / ${run.timeCardsRead}` },
          { label: 'Vínculos', value: `${run.collaboratorsMatched} vinculados · ${run.pendingCount} pendência(s)` },
          { label: 'Concluída', value: fmtDateTime(run.completedAt) }
        ],
        details: run.errorMessage ? <p className="acp-cost-ds__history-error">{run.errorMessage}</p> : undefined
      }) }}
      emptyState={<EmptyState title="Nenhuma sincronização registrada" />}
    />
  );
}

export function PontoCurrentDataHistoryTable({
  imports, isManager, onDelete, loading = false
}: {
  imports: PontoImportRow[];
  isManager: boolean;
  onDelete: (item: PontoImportRow) => void;
  loading?: boolean;
}) {
  return (
    <DataTable
      ariaLabel="Histórico de dados vigentes do ponto"
      mobileBreakpoint="lg"
      rows={imports}
      getRowId={item => item.id}
      loading={loading}
      columns={[
        { key: 'source', header: 'Origem', render: item => (
          <div className="acp-cost-ds__history-source">
            <strong>{importSourceLabel(item)}</strong>
            <span>{item.fileName}</span>
          </div>
        ) },
        { key: 'period', header: 'Período', render: item => `${fmtDate(item.periodStart)} – ${fmtDate(item.periodEnd)}` },
        { key: 'people', header: 'Colab.', render: item => `${item.collaboratorsMatched}/${item.collaboratorsTotal}` },
        { key: 'rows', header: 'Linhas', render: item => item.rowsRead },
        { key: 'updated', header: 'Atualizado', render: item => fmtDate(item.createdAt) }
      ]}
      rowActions={isManager ? item => item.source !== 'PONTOMAIS_API' ? (
        <Button variant="danger" size="sm" onClick={() => onDelete(item)} aria-label={`Excluir importação ${item.fileName}`}>
          Excluir
        </Button>
      ) : null : undefined}
      mobile={{ renderItem: item => ({
        title: importSourceLabel(item),
        subtitle: item.fileName,
        metadata: [
          { label: 'Período', value: `${fmtDate(item.periodStart)} – ${fmtDate(item.periodEnd)}` },
          { label: 'Colaboradores', value: `${item.collaboratorsMatched}/${item.collaboratorsTotal}` },
          { label: 'Linhas', value: item.rowsRead },
          { label: 'Atualizado', value: fmtDate(item.createdAt) }
        ]
      }) }}
      emptyState={<EmptyState title="Nenhuma atualização ainda" />}
    />
  );
}

type PontoDetailTab = 'sync' | 'unallocated' | 'missing-projects' | 'employees' | 'rdo-simulation';

function parsePontoDetailTab(value: string | null): PontoDetailTab {
  if (value === 'rdo-simulation') return 'rdo-simulation';
  if (value === 'missing-projects') return 'missing-projects';
  if (value === 'unallocated') return 'unallocated';
  return value === 'employees' ? 'employees' : 'sync';
}

export function PontoImportPanel() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const { user } = useAuth();
  const isManager = user?.accountType === 'ADMIN' || Boolean(user?.moduleRoles?.includes('acompanhamento:manager'));
  const [detailTab, setDetailTab] = useUrlParamState<PontoDetailTab>({
    param: 'pontoDetalhe',
    defaultValue: 'sync',
    parse: parsePontoDetailTab
  });
  const [links, setLinks] = useState<Record<string, string>>({});
  const [externalEmployeeLinks, setExternalEmployeeLinks] = useState<Record<string, string>>({});
  const [projectTagLinks, setProjectTagLinks] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<PontoImportRow | null>(null);
  const [importSource, setImportSource] = useState<PontoImportSourceFilter>('ALL');
  const [syncStart, setSyncStart] = useState('');
  const [syncEnd, setSyncEnd] = useState('');
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number } | null>(null);

  const { data: imports, isLoading: importsLoading } = useQuery({
    queryKey: ['ponto-imports', importSource],
    queryFn: () => getPontoImports(importSource),
    ...acompanhamentoRefreshQueryOptions
  });
  const { data: integrationStatus } = useQuery({
    queryKey: ['ponto-integration-status'],
    queryFn: getPontoMaisIntegrationStatus,
    ...acompanhamentoRefreshQueryOptions
  });
  const { data: colaboradores } = useQuery({
    queryKey: ['ponto-colaboradores'],
    queryFn: getPontoColaboradores,
    ...acompanhamentoRefreshQueryOptions
  });
  const { data: linkCollaborators } = useQuery({
    queryKey: ['ponto-collaborators-link'],
    queryFn: getPontoLinkCollaborators,
    enabled: isManager
  });
  const { data: pending } = useQuery({
    queryKey: ['ponto-pontomais-pending'],
    queryFn: getPontoMaisPending,
    enabled: isManager
  });
  const { data: syncRuns, isLoading: syncRunsLoading } = useQuery({
    queryKey: ['ponto-pontomais-sync-runs'],
    queryFn: () => getPontoMaisSyncRuns(20),
    enabled: isManager,
    ...acompanhamentoRefreshQueryOptions
  });
  const { data: projects } = useQuery({
    queryKey: ['ponto-projects-link'],
    queryFn: getPontoMaisReconciliationProjects,
    enabled: isManager
  });
  const { data: ignoredProjectTags } = useQuery({
    queryKey: ['ponto-ignored-project-tags'],
    queryFn: getPontoMaisIgnoredProjectTags,
    enabled: isManager
  });
  const { data: pendencyCounts } = useQuery({
    queryKey: ['ponto-pendencias-contagem'],
    queryFn: getPontoPendencyCounts,
    enabled: isManager,
    ...acompanhamentoRefreshQueryOptions
  });
  const { data: externalEmployees } = useQuery({
    queryKey: ['ponto-external-employees'],
    queryFn: getPontoMaisExternalEmployees,
    enabled: isManager,
    ...acompanhamentoRefreshQueryOptions
  });

  const syncMutation = useMutation({
    mutationFn: (range: { startDate: string; endDate: string }) => syncPontoMaisRange(
      range.startDate,
      range.endDate,
      (done, total) => setSyncProgress({ done, total })
    ),
    onSuccess: result => {
      showToast(
        result.created === 0
          ? `Período já estava atualizado — nada foi substituído (${result.windows} janela(s)).`
          : `${result.created} janela(s) sincronizada(s), ${result.skipped} já estavam atualizadas.`,
        'success'
      );
      invalidate();
    },
    onError: (error: { response?: { data?: { error?: string } } }) => {
      // Cada janela concluída já ficou gravada: dá para retomar a partir de onde parou.
      const at = syncProgress ? ` Parou na janela ${syncProgress.done + 1} de ${syncProgress.total}.` : '';
      showToast((error?.response?.data?.error || 'Não foi possível sincronizar o período.') + at, 'error');
    },
    // Limpa o progresso em qualquer desfecho: se ficasse só no onSuccess/onError, um caminho novo
    // deixaria o contador preso mostrando a última janela.
    onSettled: () => setSyncProgress(null)
  });

  const projectTagIgnoreMutation = useMutation({
    mutationFn: setPontoMaisProjectTagIgnored,
    onSuccess: (_data, variables) => {
      showToast(variables.ignored ? 'Etiqueta ignorada.' : 'Etiqueta reativada.', 'success');
      queryClient.invalidateQueries({ queryKey: ['ponto-ignored-project-tags'] });
      queryClient.invalidateQueries({ queryKey: ['ponto-pontomais-pending'] });
      queryClient.invalidateQueries({ queryKey: ['ponto-pendencias-contagem'] });
      queryClient.invalidateQueries({ queryKey: ['ponto-dias-sem-alocacao'] });
    },
    onError: (error: { response?: { data?: { error?: string } } }) => {
      showToast(error?.response?.data?.error || 'Não foi possível atualizar a etiqueta.', 'error');
    }
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['ponto-imports'] });
    queryClient.invalidateQueries({ queryKey: ['ponto-integration-status'] });
    queryClient.invalidateQueries({ queryKey: ['ponto-colaboradores'] });
    queryClient.invalidateQueries({ queryKey: ['ponto-pontomais-pending'] });
    queryClient.invalidateQueries({ queryKey: ['ponto-pontomais-sync-runs'] });
    queryClient.invalidateQueries({ queryKey: ['ponto-external-employees'] });
    queryClient.invalidateQueries({ queryKey: ['project-cards'] });
    queryClient.invalidateQueries({ queryKey: ['project-detail'] });
    queryClient.invalidateQueries({ queryKey: ['mission-group-detail'] });
    queryClient.invalidateQueries({ queryKey: ['commercial-dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['sede-costs'] });
    queryClient.invalidateQueries({ queryKey: ['ponto-pendencias-contagem'] });
    queryClient.invalidateQueries({ queryKey: ['ponto-dias-sem-alocacao'] });
    queryClient.invalidateQueries({ queryKey: ['ponto-auditoria-alocacao'] });
  };

  const linkMutation = useMutation({
    mutationFn: (payload: { normalizedName: string; collaboratorId: string }) => linkPontoName(payload),
    onSuccess: () => { showToast('Nome vinculado.'); invalidate(); },
    onError: () => showToast('Não foi possível vincular o nome.')
  });
  const externalEmployeeLinkMutation = useMutation({
    mutationFn: linkPontoMaisExternalEmployee,
    onSuccess: result => {
      queryClient.setQueryData<PontoMaisPending>(['ponto-pontomais-pending'], current => (
        current
          ? {
              ...current,
              employees: current.employees.filter(item => item.externalEmployeeId !== result.externalEmployeeId)
            }
          : current
      ));
      setExternalEmployeeLinks(previous => {
        const next = { ...previous };
        delete next[result.externalEmployeeId];
        return next;
      });
      showToast(`Colaborador vinculado em ${result.relinked} resumo(s) de jornada.`);
      invalidate();
    },
    onError: () => showToast('Não foi possível vincular o colaborador do Ponto Mais.')
  });
  const projectTagLinkMutation = useMutation({
    mutationFn: linkPontoMaisProjectTag,
    onSuccess: () => {
      showToast('Etiqueta vinculada ao projeto.');
      invalidate();
    },
    onError: () => showToast('Não foi possível vincular a etiqueta ao projeto.')
  });
  const ignoreExternalEmployeeMutation = useMutation({
    mutationFn: setPontoMaisExternalEmployeeIgnored,
    onSuccess: employee => {
      showToast(employee.ignored
        ? 'Colaborador ignorado na jornada e no cálculo de custo.'
        : 'Colaborador voltou a ser considerado na jornada e no cálculo de custo.');
      invalidate();
    },
    onError: () => showToast('Não foi possível atualizar o colaborador do Ponto Mais.')
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePontoImport(id),
    onSuccess: () => { setDeleteTarget(null); showToast('Importação excluída.'); invalidate(); },
    onError: () => showToast('Não foi possível excluir a importação.')
  });

  const unmatched = colaboradores?.unmatched ?? [];
  const integrationConfigured = integrationStatus?.configured === true;
  /*
   * As duas listas de "sem vínculo" mostravam a mesma gente por caminhos diferentes: a da API
   * (por id externo) e a das planilhas (por nome, porque o XLSX não traz o id). Ficou uma seção só;
   * o nome de planilha só aparece quando a lista da API ainda não cobre aquela pessoa.
   */
  const apiUnlinkedNames = new Set((pending?.employees ?? []).map(item => normalizeForMatch(item.externalName)));
  const xlsxOnlyUnmatched = unmatched.filter(item => !apiUnlinkedNames.has(normalizeForMatch(item.rawName)));
  const unlinkedTotal = (pending?.employees.length ?? 0) + xlsxOnlyUnmatched.length;
  // Conflitos saíram desta aba (vivem em "Dias sem alocação"), então não entram mais na contagem.
  const actionablePendingCount = unlinkedTotal;
  const missingProjectsCount = pending
    ? pending.missingProjects.projectTags.length + pending.missingProjects.ambiguousDays.length
    : 0;

  return (
    <>
      <Card className="acp-cost-ds__panel" title="Ponto (jornada)" data-pontomais-panel>
        <p className="acp-cost-ds__copy">
          {integrationConfigured
            ? 'A jornada é sincronizada automaticamente pelo backend. A primeira carga percorre continuamente todo o histórico até hoje e, depois, os 31 dias anteriores são atualizados diariamente para incorporar correções.'
            : 'A integração automática com o VR Ponto Mais ainda não está configurada neste ambiente. Configure PONTOMAIS_API_TOKEN no backend para iniciar a carga histórica; não é necessário enviar planilhas.'}
        </p>

        {isManager && pendencyCounts ? (
          <p className="placeholder-copy ponto-section-copy">
            Pendências abertas: <strong>{pendencyCounts.unallocatedDays}</strong> dia(s) sem alocação
            {' · '}<strong>{pendencyCounts.ambiguousDays}</strong> conflito(s) de projeto
            {' · '}<strong>{pendencyCounts.unlinkedEmployees}</strong> colaborador(es) do Ponto Mais sem vínculo.
            {pendencyCounts.unlinkedEmployees > 0 && pendencyCounts.ambiguousDays === 0 && pendencyCounts.unallocatedDays === 0
              ? ' Só há colaboradores sem vínculo: vincule ou marque como ignorado na aba "Colaboradores encontrados".'
              : ''}
          </p>
        ) : null}

        {isManager ? (
          <div className="acp-cost-ds__tabs acp-cost-ds__tabs--detail" role="tablist" aria-label="Detalhes da integração do Ponto Mais">
            <Button
              role="tab"
              aria-selected={detailTab === 'sync'}
              variant={detailTab === 'sync' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setDetailTab('sync')}
            >
              Sincronização e pendências
              <span className="acp-cost-ds__tab-count">{actionablePendingCount}</span>
            </Button>
            <Button
              role="tab"
              aria-selected={detailTab === 'unallocated'}
              variant={detailTab === 'unallocated' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setDetailTab('unallocated')}
              data-pontomais-unallocated-tab
            >
              Dias sem alocação
              <span className="acp-cost-ds__tab-count">{pendencyCounts?.unallocatedDays ?? 0}</span>
            </Button>
            <Button
              role="tab"
              aria-selected={detailTab === 'missing-projects'}
              variant={detailTab === 'missing-projects' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setDetailTab('missing-projects')}
              data-pontomais-missing-projects-tab
            >
              Projetos não encontrados
              <span className="acp-cost-ds__tab-count">{missingProjectsCount}</span>
            </Button>
            <Button
              role="tab"
              aria-selected={detailTab === 'employees'}
              variant={detailTab === 'employees' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setDetailTab('employees')}
              data-pontomais-employees-tab
            >
              Colaboradores encontrados
              <span className="acp-cost-ds__tab-count">{externalEmployees?.length ?? 0}</span>
            </Button>
            <Button
              role="tab"
              aria-selected={detailTab === 'rdo-simulation'}
              variant={detailTab === 'rdo-simulation' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setDetailTab('rdo-simulation')}
            >
              Simulação por RDO
            </Button>
          </div>
        ) : null}

        {!isManager || detailTab === 'sync' ? (
          <>

        {integrationConfigured && integrationStatus?.automation ? (
          <div className="ponto-sync-status" data-pontomais-automation-status>
            <strong>
              {pontoMaisBootstrapStatusLabel(
                integrationStatus.automation.bootstrapStatus,
                integrationStatus.running
              )}
            </strong>
            <span>
              Cobertura: {fmtDate(integrationStatus.automation.historyStart)} a {fmtDate(integrationStatus.automation.historyThrough)}
              {integrationStatus.automation.nextPeriodStart
                ? integrationStatus.automation.bootstrapStatus === 'FAILED'
                  ? ` · retomada automática a partir de ${fmtDate(integrationStatus.automation.nextPeriodStart)}`
                  : ` · processamento contínuo a partir de ${fmtDate(integrationStatus.automation.nextPeriodStart)}`
                : ''}
            </span>
            <span>
              Atualização diária às {integrationStatus.automation.scheduledTime} ({integrationStatus.automation.timeZone})
              {integrationStatus.automation.lastDailySyncDate
                ? ` · dados revisados até ${fmtDate(integrationStatus.automation.lastDailySyncDate)}`
                : ''}
            </span>
            {integrationStatus.automation.lastSuccessfulAt ? (
              <span>Último lote concluído em {fmtDateTime(integrationStatus.automation.lastSuccessfulAt)}</span>
            ) : null}
            {integrationStatus.automation.lastErrorMessage ? (
              <span className="field-error">{integrationStatus.automation.lastErrorMessage} A rotina tentará novamente.</span>
            ) : null}
          </div>
        ) : null}

        {isManager ? (
          <div className="det-section">
            <div className="sec ponto-subtitle">Sincronizar um período</div>
            <p className="placeholder-copy ponto-section-copy">
              Busca o período de novo no Ponto Mais. Use para cobrir faixas antigas que a carga
              histórica não alcançou. Períodos longos são fatiados em janelas de 31 dias
              automaticamente — o limite é do relatório do Ponto Mais, não seu. Se nada mudou no Ponto Mais, o snapshot é reconhecido pelo
              conteúdo e <strong>nada é substituído</strong>. Conflitos que você já resolveu à mão
              são preservados em qualquer caso — a seleção é por colaborador e data, não pertence ao
              snapshot.
            </p>
            {!integrationConfigured ? (
              <p className="field-error">
                Indisponível: o backend está sem PONTOMAIS_API_TOKEN. Defina a variável e reinicie o
                container do backend — ela é lida na inicialização do processo.
              </p>
            ) : null}
            <div className="ponto-filter-row">
              <Field label="De" optionalText="">
                <Input
                  type="date"
                  value={syncStart}
                  onChange={event => setSyncStart(event.target.value)}
                />
              </Field>
              <Field label="Até" optionalText="">
                <Input
                  type="date"
                  value={syncEnd}
                  min={syncStart || undefined}
                  onChange={event => setSyncEnd(event.target.value)}
                />
              </Field>
              <Button
                variant="primary"
                size="sm"
                disabled={
                  !integrationConfigured || !syncStart || !syncEnd || syncStart > syncEnd || syncMutation.isPending
                }
                onClick={() => syncMutation.mutate({ startDate: syncStart, endDate: syncEnd })}
              >
                {syncMutation.isPending
                  ? `Sincronizando${syncProgress ? ` ${Math.min(syncProgress.done + 1, syncProgress.total)}/${syncProgress.total}` : ''}…`
                  : 'Sincronizar período'}
              </Button>
              {syncStart && syncEnd && syncStart <= syncEnd ? (
                <span className="placeholder-copy">
                  {syncMutation.isPending && syncProgress
                    ? `Janela ${Math.min(syncProgress.done + 1, syncProgress.total)} de ${syncProgress.total}…`
                    : `${pontoMaisSyncWindows(syncStart, syncEnd).length} janela(s) de até 31 dias.`}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {integrationStatus?.lastSuccessfulRun ? (
          <p className="placeholder-copy ponto-section-copy">
            Última sincronização: {fmtDate(integrationStatus.lastSuccessfulRun.completedAt)} · período {fmtDate(integrationStatus.lastSuccessfulRun.periodStart)} a {fmtDate(integrationStatus.lastSuccessfulRun.periodEnd)}
            {integrationStatus.lastSuccessfulRun.pendingCount ? ` · ${integrationStatus.lastSuccessfulRun.pendingCount} pendência(s)` : ' · sem pendências'}
          </p>
        ) : null}

        {isManager && pending ? (
          <div className="det-section ponto-pending-section">
            <div className="sec ponto-subtitle">
              Colaboradores do ponto sem vínculo ({actionablePendingCount})
            </div>
            {actionablePendingCount > 0 ? (
              <p className="placeholder-copy ponto-section-copy">
                Enquanto ficarem aqui, as horas dessas pessoas não entram no custo de projeto nenhum.
                Vincule ao colaborador correspondente ou use “Ignorar” para tirar da fila quem não é
                da operação — dá para reverter na aba “Colaboradores encontrados”.
              </p>
            ) : null}
            {actionablePendingCount === 0 ? (
              <p className="placeholder-copy">
                Nenhum colaborador do ponto sem vínculo. Os dias de ponto que não chegaram a projeto
                nenhum ficam na aba “Dias sem alocação”.
              </p>
            ) : null}
            <div
              className="ponto-local-scroll"
              role="region"
              aria-label="Lista de pendências da integração"
              tabIndex={0}
            >

            {pending.employees.map(item => {
              return (
                <div key={item.externalEmployeeId} className="field-row ponto-link-row">
                  <div className="ponto-link-copy">
                    <strong>{item.externalName}</strong>
                    <span>{item.registrationNumber ? `Matrícula ${item.registrationNumber}` : 'Sem matrícula conciliada'}</span>
                  </div>
                  <Field className="ponto-link-field" label="Vincular ao colaborador" optionalText="">
                    <Select
                      value={externalEmployeeLinks[item.externalEmployeeId] ?? ''}
                      onChange={event => setExternalEmployeeLinks(previous => ({
                        ...previous,
                        [item.externalEmployeeId]: event.target.value
                      }))}
                    >
                      <option value="">Selecione o colaborador…</option>
                      {(linkCollaborators ?? []).map(collaborator => (
                        <option key={collaborator.id} value={collaborator.id}>{collaboratorOptionLabel(collaborator)}</option>
                      ))}
                    </Select>
                  </Field>
                  <div className="ponto-pending-actions">
                    <Button
                      variant="secondary" size="sm"
                      disabled={!externalEmployeeLinks[item.externalEmployeeId] || externalEmployeeLinkMutation.isPending}
                      onClick={() => externalEmployeeLinkMutation.mutate({
                        externalEmployeeId: item.externalEmployeeId,
                        collaboratorId: externalEmployeeLinks[item.externalEmployeeId]
                      })}
                    >
                      Vincular
                    </Button>
                    {/* Mesmo efeito do botão da aba "Colaboradores encontrados": evita ter de sair
                        daqui e caçar a pessoa lá para tirá-la da fila. */}
                    <Button
                      variant="secondary" size="sm"
                      disabled={ignoreExternalEmployeeMutation.isPending}
                      onClick={() => ignoreExternalEmployeeMutation.mutate({
                        externalEmployeeId: item.externalEmployeeId,
                        ignored: true
                      })}
                    >
                      Ignorar
                    </Button>
                  </div>
                </div>
              );
            })}

            {/* Os conflitos de projeto (etiqueta contra RDO, vários RDOs, janelas sobrepostas)
                 vivem na aba "Dias sem alocação": lá eles aparecem junto dos demais dias sem
                 projeto, com os mesmos candidatos e resolução em bloco. Listá-los aqui também
                 duplicava a fila e fazia o contador somar o mesmo dia duas vezes. */}

            {xlsxOnlyUnmatched.map(item => (
              <div key={item.normalizedName} className="field-row ponto-link-row">
                <div className="ponto-link-copy">
                  <strong>{item.rawName}</strong>
                  <span>Só aparece em planilha importada — vincule pelo nome.</span>
                </div>
                <Field className="ponto-link-field" label="Vincular ao colaborador" optionalText="">
                  <Select
                    value={links[item.normalizedName] ?? ''}
                    onChange={event => setLinks(previous => ({ ...previous, [item.normalizedName]: event.target.value }))}
                  >
                    <option value="">Selecione o colaborador…</option>
                    {(linkCollaborators ?? []).map(collaborator => (
                      <option key={collaborator.id} value={collaborator.id}>{collaboratorOptionLabel(collaborator)}</option>
                    ))}
                  </Select>
                </Field>
                <Button
                  variant="secondary" size="sm"
                  disabled={!links[item.normalizedName] || linkMutation.isPending}
                  onClick={() => linkMutation.mutate({
                    normalizedName: item.normalizedName,
                    collaboratorId: links[item.normalizedName]
                  })}
                >
                  Vincular
                </Button>
              </div>
            ))}

            {!unlinkedTotal ? (
              <p className="placeholder-copy ponto-section-copy">Nenhum colaborador do ponto sem vínculo.</p>
            ) : null}
            </div>
          </div>
        ) : null}

        {isManager ? (
          <section className="acp-cost-ds__history-section" aria-labelledby="ponto-sync-history-title">
            <h3 id="ponto-sync-history-title">Histórico de sincronizações</h3>
            <PontoSyncHistoryTable runs={syncRuns ?? []} loading={syncRunsLoading} />
          </section>
        ) : null}

        <h3 id="ponto-current-data-history-title" className="acp-cost-ds__section-title">Histórico de dados vigentes</h3>
        <div className="ponto-filter-row">
          <Field label="Origem" optionalText="">
            <Select
              value={importSource}
              onChange={event => setImportSource(event.target.value as PontoImportSourceFilter)}
            >
              <option value="ALL">Todas (mais recentes)</option>
              <option value="XLSX">Somente planilhas</option>
              <option value="PONTOMAIS_API">Somente API</option>
            </Select>
          </Field>
          {importSource === 'ALL' ? (
            <span className="placeholder-copy">
              A lista mostra os mais recentes. Para achar planilhas antigas — e poder excluí-las —
              troque para “Somente planilhas”.
            </span>
          ) : null}
        </div>
        <PontoCurrentDataHistoryTable imports={imports ?? []} isManager={isManager} onDelete={setDeleteTarget} loading={importsLoading} />
          </>
        ) : null}

        {detailTab === 'unallocated' && isManager ? (
          <UnallocatedDaysPanel projects={projects ?? []} enabled={isManager} />
        ) : null}

        {detailTab === 'missing-projects' && isManager && pending ? (
          <section className="det-section ponto-employee-section" aria-labelledby="ponto-missing-projects-title">
            <div id="ponto-missing-projects-title" className="sec ponto-subtitle">
              Projetos não encontrados ({missingProjectsCount})
            </div>
            <p className="placeholder-copy ponto-section-copy">
              Estes códigos e etiquetas vieram do Ponto Mais, mas não existem no cadastro do app. Eles podem ser de missões antigas e ficam separados das pendências operacionais. Vincule somente quando houver um projeto correspondente.
            </p>
            <div
              className="ponto-local-scroll"
              role="region"
              aria-labelledby="ponto-missing-projects-title"
              tabIndex={0}
            >
              {pending.missingProjects.projectTags.map(item => {
                return (
                  <div key={item.normalizedTag} className="field-row ponto-link-row">
                    <div className="ponto-link-copy">
                      <strong>{item.rawTag}</strong>
                      <span>Etiqueta de projeto não reconhecida</span>
                    </div>
                    <Field className="ponto-link-field" label="Vincular ao projeto" optionalText="">
                      <Select
                        value={projectTagLinks[item.normalizedTag] ?? ''}
                        onChange={event => setProjectTagLinks(previous => ({
                          ...previous,
                          [item.normalizedTag]: event.target.value
                        }))}
                      >
                        <option value="">Selecione o projeto…</option>
                        {(projects ?? []).map(project => (
                          <option key={project.id} value={project.id}>
                            {project.code} — {project.name}
                            {project.historical ? ' (histórico)' : project.isActive ? '' : ' (inativo)'}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <div className="ponto-pending-actions">
                      <Button
                        variant="secondary" size="sm"
                        disabled={!projectTagLinks[item.normalizedTag] || projectTagLinkMutation.isPending}
                        onClick={() => projectTagLinkMutation.mutate({
                          rawTag: item.rawTag,
                          projectId: projectTagLinks[item.normalizedTag]
                        })}
                      >
                        Vincular
                      </Button>
                      <Button
                        variant="secondary" size="sm"
                        disabled={projectTagIgnoreMutation.isPending}
                        onClick={() => projectTagIgnoreMutation.mutate({ rawTag: item.rawTag, ignored: true })}
                      >
                        Ignorar
                      </Button>
                    </div>
                  </div>
                );
              })}

              {ignoredProjectTags?.length ? (
                <div className="ponto-ignored-tags">
                  <strong>Etiquetas ignoradas ({ignoredProjectTags.length})</strong>
                  <span>Não entram nas pendências nem na contagem. Reative se a missão for cadastrada.</span>
                  {ignoredProjectTags.map(item => (
                    <div key={item.normalizedTag} className="ponto-ignored-tag-row">
                      <span>{item.rawTag}</span>
                      <Button
                        variant="secondary" size="sm"
                        disabled={projectTagIgnoreMutation.isPending}
                        onClick={() => projectTagIgnoreMutation.mutate({ rawTag: item.rawTag, ignored: false })}
                      >
                        Reativar
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}

              {pending.missingProjects.ambiguousDays.map(item => {
                const pendingKey = `${item.externalEmployeeId}:${item.date}`;
                return (
                  <div key={pendingKey} className="field-row ponto-link-row ponto-missing-project-day-row">
                    <div className="ponto-link-copy">
                      <strong>{item.externalName} · {fmtDate(item.date)}</strong>
                      <span>
                        Projetos candidatos sem cadastro: {item.projectCodes.join(', ')}. As horas permanecem em sede enquanto nenhum desses projetos existir no app.
                      </span>
                    </div>
                  </div>
                );
              })}

              {!missingProjectsCount ? (
                <p className="placeholder-copy ponto-section-copy">Nenhum projeto não encontrado.</p>
              ) : null}
            </div>
          </section>
        ) : null}

        {detailTab === 'rdo-simulation' && isManager ? <RdoSimulationExclusionsPanel /> : null}

        {detailTab === 'employees' && isManager ? (
          <section className="det-section ponto-employee-section" aria-labelledby="ponto-employees-title">
            <div id="ponto-employees-title" className="sec ponto-subtitle">
              Colaboradores encontrados ({externalEmployees?.length ?? 0})
            </div>
            <p className="placeholder-copy ponto-section-copy">
              Ignore pessoas fora da operação. A preferência é reversível e também retira seus dados históricos do cálculo vigente.
            </p>
            <div
              className="ponto-local-scroll ponto-employee-directory"
              role="region"
              aria-labelledby="ponto-employees-title"
              tabIndex={0}
            >
              {(externalEmployees ?? []).map(employee => (
                <div
                  key={employee.externalEmployeeId}
                  className={`ponto-employee-row${employee.ignored ? ' is-ignored' : ''}`}
                >
                  <div className="ponto-link-copy">
                    <strong>{employee.externalName}</strong>
                    <span>
                      {employee.registrationNumber ? `Matrícula ${employee.registrationNumber}` : 'Sem matrícula'}
                      {' · '}
                      {employee.isActive === true ? 'Ativo no Ponto Mais' : employee.isActive === false ? 'Inativo no Ponto Mais' : 'Situação não informada'}
                      {employee.ignored ? ' · ignorado no acompanhamento' : ''}
                    </span>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={ignoreExternalEmployeeMutation.isPending}
                    onClick={() => ignoreExternalEmployeeMutation.mutate({
                      externalEmployeeId: employee.externalEmployeeId,
                      ignored: !employee.ignored
                    })}
                  >
                    {employee.ignored ? 'Voltar a considerar' : 'Ignorar'}
                  </Button>
                </div>
              ))}
              {!externalEmployees?.length ? (
                <p className="placeholder-copy">Nenhum colaborador foi encontrado ainda.</p>
              ) : null}
            </div>
          </section>
        ) : null}
      </Card>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Excluir importação de contingência?"
        description="Os dados de ponto desse envio manual serão removidos. Sincronizações da API não podem ser excluídas por esta tela."
        highlight={deleteTarget?.fileName}
        confirmLabel={deleteMutation.isPending ? 'Excluindo…' : 'Excluir importação'}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => { if (deleteTarget) deleteMutation.mutate(deleteTarget.id); }}
      />
      <PontoMaisSyncNovelty
        user={user}
        enabled={isManager && integrationConfigured}
      />
    </>
  );
}
