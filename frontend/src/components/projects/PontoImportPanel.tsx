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
  type PontoMaisPending
} from '../../api/acompanhamentoPonto';
import { useAuth } from '../../auth/AuthContext';
import { useUrlParamState } from '../../hooks/useUrlParamState';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useToast } from '../ui/ToastContext';
import { acompanhamentoRefreshQueryOptions } from './acompanhamentoRefresh';
import { PontoMaisSyncNovelty } from './PontoMaisSyncNovelty';
import { UnallocatedDaysPanel } from './UnallocatedDaysPanel';

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

type PontoDetailTab = 'sync' | 'unallocated' | 'missing-projects' | 'employees';

function parsePontoDetailTab(value: string | null): PontoDetailTab {
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

  const { data: imports } = useQuery({
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
  const { data: syncRuns } = useQuery({
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
      <div className="page-card" data-pontomais-panel>
        <div className="sec">Ponto (jornada)</div>
        <p className="placeholder-copy ponto-panel-copy">
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
          <div className="acp-seg ponto-detail-tabs" role="tablist" aria-label="Detalhes da integração do Ponto Mais">
            <button
              type="button"
              role="tab"
              aria-selected={detailTab === 'sync'}
              className={`acp-seg-btn${detailTab === 'sync' ? ' active' : ''}`}
              onClick={() => setDetailTab('sync')}
            >
              Sincronização e pendências
              <span className="acp-seg-count">{actionablePendingCount}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={detailTab === 'unallocated'}
              className={`acp-seg-btn${detailTab === 'unallocated' ? ' active' : ''}`}
              onClick={() => setDetailTab('unallocated')}
              data-pontomais-unallocated-tab
            >
              Dias sem alocação
              <span className="acp-seg-count">{pendencyCounts?.unallocatedDays ?? 0}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={detailTab === 'missing-projects'}
              className={`acp-seg-btn${detailTab === 'missing-projects' ? ' active' : ''}`}
              onClick={() => setDetailTab('missing-projects')}
              data-pontomais-missing-projects-tab
            >
              Projetos não encontrados
              <span className="acp-seg-count">{missingProjectsCount}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={detailTab === 'employees'}
              className={`acp-seg-btn${detailTab === 'employees' ? ' active' : ''}`}
              onClick={() => setDetailTab('employees')}
              data-pontomais-employees-tab
            >
              Colaboradores encontrados
              <span className="acp-seg-count">{externalEmployees?.length ?? 0}</span>
            </button>
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
              <div className="field-group">
                <label htmlFor="ponto-sync-start">De</label>
                <input
                  id="ponto-sync-start"
                  type="date"
                  value={syncStart}
                  onChange={event => setSyncStart(event.target.value)}
                />
              </div>
              <div className="field-group">
                <label htmlFor="ponto-sync-end">Até</label>
                <input
                  id="ponto-sync-end"
                  type="date"
                  value={syncEnd}
                  min={syncStart || undefined}
                  onChange={event => setSyncEnd(event.target.value)}
                />
              </div>
              <Button
                variant="mini"
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
              const fieldId = `pontomais-employee-${encodeURIComponent(item.externalEmployeeId)}`;
              return (
                <div key={item.externalEmployeeId} className="field-row ponto-link-row">
                  <div className="ponto-link-copy">
                    <strong>{item.externalName}</strong>
                    <span>{item.registrationNumber ? `Matrícula ${item.registrationNumber}` : 'Sem matrícula conciliada'}</span>
                  </div>
                  <div className="field-group ponto-link-field">
                    <label htmlFor={fieldId}>Vincular ao colaborador</label>
                    <select
                      id={fieldId}
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
                    </select>
                  </div>
                  <div className="ponto-pending-actions">
                    <Button
                      variant="mini"
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
                      variant="mini"
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
                <div className="field-group ponto-link-field">
                  <label htmlFor={`ponto-link-${item.normalizedName}`}>Vincular ao colaborador</label>
                  <select
                    id={`ponto-link-${item.normalizedName}`}
                    value={links[item.normalizedName] ?? ''}
                    onChange={event => setLinks(previous => ({ ...previous, [item.normalizedName]: event.target.value }))}
                  >
                    <option value="">Selecione o colaborador…</option>
                    {(linkCollaborators ?? []).map(collaborator => (
                      <option key={collaborator.id} value={collaborator.id}>{collaboratorOptionLabel(collaborator)}</option>
                    ))}
                  </select>
                </div>
                <Button
                  variant="mini"
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

        {isManager && syncRuns?.length ? (
          <>
            <div id="ponto-sync-history-title" className="sec ponto-history-title">Histórico de sincronizações</div>
            <div
              className="acp-table-wrap ponto-history-table"
              role="region"
              aria-labelledby="ponto-sync-history-title"
              tabIndex={0}
            >
              <table className="acp-table">
                <thead>
                  <tr><th>Status</th><th>Origem</th><th>Período</th><th>Registros</th><th>Vínculos</th><th>Concluída</th></tr>
                </thead>
                <tbody>
                  {syncRuns.map(run => (
                    <tr key={run.id}>
                      <td data-label="Status"><strong>{run.status === 'SUCCEEDED' ? 'Concluída' : run.status === 'FAILED' ? 'Falhou' : 'Em andamento'}</strong>{run.errorMessage ? <span className="ponto-history-file">{run.errorMessage}</span> : null}</td>
                      <td data-label="Origem">{pontoMaisSyncTriggerLabel(run.trigger)}</td>
                      <td data-label="Período">{fmtDate(run.periodStart)} – {fmtDate(run.periodEnd)}</td>
                      <td data-label="Registros">{run.workDaysRead} jornadas · {run.timeCardsRead} batidas</td>
                      <td data-label="Vínculos">{run.collaboratorsMatched} vinculados · {run.pendingCount} pendência(s)</td>
                      <td data-label="Concluída">{fmtDateTime(run.completedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        <div id="ponto-current-data-history-title" className="sec ponto-history-title">Histórico de dados vigentes</div>
        <div className="ponto-filter-row">
          <div className="field-group">
            <label htmlFor="ponto-import-source">Origem</label>
            <select
              id="ponto-import-source"
              value={importSource}
              onChange={event => setImportSource(event.target.value as PontoImportSourceFilter)}
            >
              <option value="ALL">Todas (mais recentes)</option>
              <option value="XLSX">Somente planilhas</option>
              <option value="PONTOMAIS_API">Somente API</option>
            </select>
          </div>
          {importSource === 'ALL' ? (
            <span className="placeholder-copy">
              A lista mostra os mais recentes. Para achar planilhas antigas — e poder excluí-las —
              troque para “Somente planilhas”.
            </span>
          ) : null}
        </div>
        {imports?.length ? (
          <div
            className="acp-table-wrap ponto-history-table"
            role="region"
            aria-labelledby="ponto-current-data-history-title"
            tabIndex={0}
          >
            <table className="acp-table">
              <thead>
                <tr><th>Origem</th><th>Período</th><th>Colab.</th><th>Linhas</th><th>Atualizado</th>{isManager ? <th /> : null}</tr>
              </thead>
              <tbody>
                {imports.map(item => {
                  const canDelete = isManager && item.source !== 'PONTOMAIS_API';
                  return (
                    <tr key={item.id}>
                      <td data-label="Origem"><strong>{importSourceLabel(item)}</strong><span className="ponto-history-file">{item.fileName}</span></td>
                      <td data-label="Período">{fmtDate(item.periodStart)} – {fmtDate(item.periodEnd)}</td>
                      <td data-label="Colab.">{item.collaboratorsMatched}/{item.collaboratorsTotal}</td>
                      <td data-label="Linhas">{item.rowsRead}</td>
                      <td data-label="Atualizado">{fmtDate(item.createdAt)}</td>
                      {isManager ? (
                        <td data-label="Ações" className="ponto-history-actions">
                          {canDelete ? <Button variant="danger" onClick={() => setDeleteTarget(item)}>Excluir</Button> : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="placeholder-copy">Nenhuma atualização ainda.</p>}
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
                const fieldId = `pontomais-missing-tag-${encodeURIComponent(item.normalizedTag)}`;
                return (
                  <div key={item.normalizedTag} className="field-row ponto-link-row">
                    <div className="ponto-link-copy">
                      <strong>{item.rawTag}</strong>
                      <span>Etiqueta de projeto não reconhecida</span>
                    </div>
                    <div className="field-group ponto-link-field">
                      <label htmlFor={fieldId}>Vincular ao projeto</label>
                      <select
                        id={fieldId}
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
                      </select>
                    </div>
                    <div className="ponto-pending-actions">
                      <Button
                        variant="mini"
                        disabled={!projectTagLinks[item.normalizedTag] || projectTagLinkMutation.isPending}
                        onClick={() => projectTagLinkMutation.mutate({
                          rawTag: item.rawTag,
                          projectId: projectTagLinks[item.normalizedTag]
                        })}
                      >
                        Vincular
                      </Button>
                      <Button
                        variant="mini"
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
                        variant="mini"
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
                    variant={employee.ignored ? 'secondary' : 'mini'}
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
      </div>

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
