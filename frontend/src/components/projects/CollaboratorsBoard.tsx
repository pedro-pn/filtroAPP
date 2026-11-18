import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import type { AcompanhamentoCollaborator, CollaboratorAllocationStatus } from '../../api/acompanhamentoColaboradores';
import { useAcompanhamentoColaboradores } from '../../hooks/useAcompanhamentoColaboradores';
import type { AuthUser } from '../../types/auth';
import { SearchBar } from '../ui/SearchBar';
import { useToast } from '../ui/ToastContext';
import { CollaboratorsNovelty } from './CollaboratorsNovelty';

const CURRENT_YEAR = new Date().getFullYear();
type ViewMode = 'mapa' | 'kanban';

function parseYear(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100 ? parsed : CURRENT_YEAR;
}

function parseView(value: string | null): ViewMode {
  return value === 'kanban' ? 'kanban' : 'mapa';
}

function yearOptions(selectedYear: number) {
  const years = new Set([selectedYear]);
  for (let year = CURRENT_YEAR + 1; year >= CURRENT_YEAR - 5; year -= 1) years.add(year);
  return [...years].sort((left, right) => right - left);
}

function formatHours(value: number | null) {
  if (value == null) return 'Sem dados';
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} HH`;
}

function formatPercent(value: number | null) {
  if (value == null) return 'Sem dados';
  return value.toLocaleString('pt-BR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function formatMonth(value: string) {
  const [year, month] = value.split('-').map(Number);
  if (!year || !month) return value;
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('pt-BR', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

function statusLabel(status: CollaboratorAllocationStatus) {
  if (status === 'alocado') return 'Alocado';
  if (status === 'sede') return 'Sede';
  return 'Folga';
}

function statusDescription(status: CollaboratorAllocationStatus) {
  if (status === 'alocado') return 'Em obra/projeto';
  if (status === 'sede') return 'Disponível na sede';
  return 'Sem ponto recente no ano';
}

function statusColumnTitle(status: CollaboratorAllocationStatus) {
  if (status === 'alocado') return 'Alocados';
  if (status === 'sede') return 'Disponíveis';
  return 'Sem alocação recente';
}

const KANBAN_STATUSES: CollaboratorAllocationStatus[] = ['alocado', 'sede', 'folga'];

function MonthStrip({ collaborator, refMensal }: { collaborator: AcompanhamentoCollaborator; refMensal: number }) {
  return (
    <span className="acp-colab-calendar" aria-label={`Calendário anual de ${collaborator.name}`}>
      {collaborator.porMes.map(month => {
        const hasHours = month.hhProdutivas > 0;
        const tone = !hasHours ? 'empty' : month.acimaDaRef ? 'ok' : 'below';
        return (
          <span
            key={month.mes}
            className={`acp-colab-month ${tone}`}
            title={`${formatMonth(month.mes)}: ${formatHours(month.hhProdutivas)} de ${formatHours(refMensal)}`}
          >
            <strong>{formatMonth(month.mes).slice(0, 3)}</strong>
            <small>{hasHours ? Math.round(month.hhProdutivas) : '-'}</small>
          </span>
        );
      })}
    </span>
  );
}

function BoardSkeleton() {
  return (
    <div className="acp-dash acp-colab-wrap" aria-busy="true">
      <div className="page-card acp-colab-skeleton">
        <span className="sr-only">Carregando colaboradores...</span>
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-row" />
      </div>
    </div>
  );
}

function AllocationPeriods({ collaborator }: { collaborator: AcompanhamentoCollaborator }) {
  const periods = collaborator.alocacao.periodos.slice(-3).reverse();
  if (!periods.length) return <span className="placeholder-copy">Sem períodos no ano.</span>;
  return (
    <span className="acp-colab-periods">
      {periods.map(period => (
        <span className={`acp-colab-period ${period.situacao}`} key={`${period.inicio}-${period.fim}-${period.projectId || period.situacao}`}>
          <strong>{period.projeto || statusLabel(period.situacao)}</strong>
          <small>{formatDate(period.inicio)} a {formatDate(period.fim)}</small>
        </span>
      ))}
    </span>
  );
}

function CollaboratorKanbanCard({ collaborator, refMensal, onOpen }: {
  collaborator: AcompanhamentoCollaborator;
  refMensal: number;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="acp-colab-kanban-card" onClick={onOpen}>
      <span className="acp-colab-card-head">
        <span className="acp-colab-card-title">
          <strong>{collaborator.name}</strong>
          <small>{collaborator.code} · {collaborator.role || 'Cargo não informado'}</small>
        </span>
        <span className={`acp-status-badge ${collaborator.alocacao.situacaoAtual}`}>
          {statusLabel(collaborator.alocacao.situacaoAtual)}
        </span>
      </span>

      <span className="acp-colab-card-metrics">
        <span>
          <small>Taxa</small>
          <strong>{formatPercent(collaborator.taxaIndividual)}</strong>
        </span>
        <span>
          <small>Média</small>
          <strong>{formatHours(collaborator.mediaMensal)}</strong>
        </span>
        <span>
          <small>Acumulado</small>
          <strong>{formatHours(collaborator.totalHHprodutivas)}</strong>
        </span>
      </span>

      <span className="acp-colab-card-current">
        <small>{statusDescription(collaborator.alocacao.situacaoAtual)}</small>
        <strong>{collaborator.alocacao.projetoAtual || (collaborator.alocacao.disponivel ? 'Sede' : 'Sem projeto atual')}</strong>
      </span>

      <MonthStrip collaborator={collaborator} refMensal={refMensal} />
      <AllocationPeriods collaborator={collaborator} />
    </button>
  );
}

function CollaboratorMapRow({ collaborator, refMensal, onOpen }: {
  collaborator: AcompanhamentoCollaborator;
  refMensal: number;
  onOpen: () => void;
}) {
  return (
    <button type="button" className={`acp-colab-map-row ${collaborator.alocacao.situacaoAtual}`} onClick={onOpen}>
      <span className="acp-colab-map-person">
        <strong>{collaborator.name}</strong>
        <small>{collaborator.code} · {collaborator.role || 'Cargo não informado'}</small>
      </span>
      <span className="acp-colab-map-status">
        <span className={`acp-status-badge ${collaborator.alocacao.situacaoAtual}`}>
          {statusLabel(collaborator.alocacao.situacaoAtual)}
        </span>
        <small>{collaborator.alocacao.projetoAtual || (collaborator.alocacao.disponivel ? 'Sede' : 'Sem projeto atual')}</small>
      </span>
      <span className="acp-colab-map-metrics">
        <span>
          <small>Taxa</small>
          <strong>{formatPercent(collaborator.taxaIndividual)}</strong>
        </span>
        <span>
          <small>Média</small>
          <strong>{formatHours(collaborator.mediaMensal)}</strong>
        </span>
        <span>
          <small>Total</small>
          <strong>{formatHours(collaborator.totalHHprodutivas)}</strong>
        </span>
      </span>
      <MonthStrip collaborator={collaborator} refMensal={refMensal} />
    </button>
  );
}

function CollaboratorMapView({ colaboradores, refMensal, onOpen }: {
  colaboradores: AcompanhamentoCollaborator[];
  refMensal: number;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="acp-colab-map" data-acp-colab-map>
      <div className="acp-colab-map-header" aria-hidden="true">
        <span>Colaborador</span>
        <span>Situação</span>
        <span>Indicadores</span>
        <span>Calendário</span>
      </div>
      <div className="acp-colab-map-list">
        {colaboradores.map(row => (
          <CollaboratorMapRow
            key={row.collaboratorId}
            collaborator={row}
            refMensal={refMensal}
            onOpen={() => onOpen(row.collaboratorId)}
          />
        ))}
      </div>
    </div>
  );
}

function CollaboratorDetail({ collaborator, refMensal, onBack }: {
  collaborator: AcompanhamentoCollaborator;
  refMensal: number;
  onBack: () => void;
}) {
  return (
    <div className="acp-colab-detail">
      <div className="acp-colab-actions">
        <button type="button" className="mini-btn alt" onClick={onBack}>Voltar à lista</button>
      </div>
      <div className="page-card acp-colab-detail-head">
        <div className="acp-colab-person">
          <span className="sec">Detalhe mensal</span>
          <strong>{collaborator.name}</strong>
          <small>{collaborator.code} · {collaborator.role || 'Cargo não informado'}</small>
        </div>
        <span className={`acp-status-badge ${collaborator.alocacao.situacaoAtual}`}>
          {statusLabel(collaborator.alocacao.situacaoAtual)}
        </span>
      </div>
      <div className="acp-kpis">
        <div className="acp-kpi">
          <span className="acp-kpi-label">HH acumulada</span>
          <span className="acp-kpi-value">{formatHours(collaborator.totalHHprodutivas)}</span>
        </div>
        <div className="acp-kpi">
          <span className="acp-kpi-label">Média mensal</span>
          <span className="acp-kpi-value">{formatHours(collaborator.mediaMensal)}</span>
          <span className="acp-kpi-foot">{collaborator.mesesAtivos} mês{collaborator.mesesAtivos === 1 ? '' : 'es'} ativo{collaborator.mesesAtivos === 1 ? '' : 's'}</span>
        </div>
        <div className="acp-kpi acp-kpi-accent">
          <span className="acp-kpi-label">Taxa individual</span>
          <span className="acp-kpi-value">{formatPercent(collaborator.taxaIndividual)}</span>
        </div>
        <div className="acp-kpi">
          <span className="acp-kpi-label">Referência</span>
          <span className="acp-kpi-value">{formatHours(refMensal)}</span>
        </div>
      </div>
      <div className="page-card">
        <div className="sec">Meses do ano</div>
        <MonthStrip collaborator={collaborator} refMensal={refMensal} />
        <div className="acp-table-wrap acp-colab-month-table">
          <table className="acp-table">
            <thead>
              <tr>
                <th>Mês</th>
                <th>HH produtivas</th>
                <th>Referência</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {collaborator.porMes.map(month => (
                <tr key={month.mes}>
                  <td data-label="Mês">{formatMonth(month.mes)}</td>
                  <td data-label="HH produtivas">{formatHours(month.hhProdutivas)}</td>
                  <td data-label="Referência">{formatHours(refMensal)}</td>
                  <td data-label="Situação">
                    <span className={`acp-colab-month-status ${month.acimaDaRef ? 'ok' : 'below'}`}>
                      {month.acimaDaRef ? 'Acima da referência' : 'Abaixo da referência'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function CollaboratorsBoard({ noveltyUser }: { noveltyUser?: Pick<AuthUser, 'id'> | null }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const showToast = useToast();
  const [noveltyActive, setNoveltyActive] = useState(true);
  const year = parseYear(searchParams.get('year'));
  const view = parseView(searchParams.get('view'));
  const q = searchParams.get('q') ?? '';
  const disponivel = searchParams.get('disponivel') === 'true';
  const selectedId = searchParams.get('colaborador');
  const queryParams = useMemo(() => ({
    year,
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(disponivel ? { disponivel: true } : {})
  }), [year, q, disponivel]);

  const { data, isLoading, isError } = useAcompanhamentoColaboradores(queryParams);
  const colaboradores = useMemo(() => data?.colaboradores ?? [], [data?.colaboradores]);
  const sortedColaboradores = useMemo(() => [...colaboradores].sort((left, right) => {
    const byStatus = KANBAN_STATUSES.indexOf(left.alocacao.situacaoAtual) - KANBAN_STATUSES.indexOf(right.alocacao.situacaoAtual);
    if (byStatus !== 0) return byStatus;
    return (right.taxaIndividual ?? -1) - (left.taxaIndividual ?? -1);
  }), [colaboradores]);
  const selected = colaboradores.find(row => row.collaboratorId === selectedId) ?? null;
  const columns = useMemo(() => KANBAN_STATUSES.map(status => ({
    status,
    rows: colaboradores.filter(row => row.alocacao.situacaoAtual === status)
  })), [colaboradores]);

  const updateParams = useCallback((values: Record<string, string | null>) => {
    setSearchParams(currentParams => {
      const nextParams = new URLSearchParams(currentParams);
      for (const [key, value] of Object.entries(values)) {
        if (value == null || value === '') nextParams.delete(key);
        else nextParams.set(key, value);
      }
      return nextParams;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    if (isError) showToast('Não foi possível carregar os colaboradores.', 'error');
  }, [isError, showToast]);

  useEffect(() => {
    if (!isLoading && data && selectedId && !selected) updateParams({ colaborador: null });
  }, [data, isLoading, selected, selectedId, updateParams]);

  if (isLoading) return <BoardSkeleton />;

  if (isError || !data) {
    return (
      <div className="acp-dash acp-colab-wrap">
        <div className="page-card placeholder-copy">Não foi possível carregar a aba Colaboradores.</div>
      </div>
    );
  }

  const filters = (
    <div className="page-card acp-filters acp-colab-filters">
      <div className="field-group" data-acp-colab-year>
        <label htmlFor="acp-colab-year">Ano</label>
        <select
          id="acp-colab-year"
          value={year}
          onChange={event => updateParams({ year: event.target.value, colaborador: null })}
        >
          {yearOptions(year).map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      </div>
      <div className="field-group field-group-wide">
        <label htmlFor="acp-colab-search">Buscar colaborador</label>
        <SearchBar
          id="acp-colab-search"
          value={q}
          onChange={value => updateParams({ q: value, colaborador: null })}
          placeholder="Nome, código ou cargo"
        />
      </div>
      <div className="field-group acp-colab-toggle-field" data-acp-colab-available>
        <label className="equip-toggle">
          <input
            type="checkbox"
            checked={disponivel}
            onChange={event => updateParams({ disponivel: event.target.checked ? 'true' : null, colaborador: null })}
          />
          Somente disponíveis
        </label>
      </div>
    </div>
  );

  if (selected) {
    return (
      <div className="acp-dash acp-colab-wrap">
        {filters}
        <CollaboratorDetail
          collaborator={selected}
          refMensal={data.refMensal}
          onBack={() => updateParams({ colaborador: null })}
        />
        <CollaboratorsNovelty
          user={noveltyUser}
          enabled={noveltyActive}
          onSeen={() => setNoveltyActive(false)}
        />
      </div>
    );
  }

  return (
    <div className="acp-dash acp-colab-wrap">
      {filters}
      <div className="acp-kpis">
        <div className="acp-kpi acp-kpi-accent" data-acp-colab-taxa-geral>
          <span className="acp-kpi-label">Taxa Geral</span>
          <span className="acp-kpi-value">{formatPercent(data.taxaGeral)}</span>
          <span className="acp-kpi-foot">Equipe operacional em {data.year}</span>
        </div>
        <div className="acp-kpi">
          <span className="acp-kpi-label">Colaboradores</span>
          <span className="acp-kpi-value">{colaboradores.length}</span>
        </div>
        <div className="acp-kpi">
          <span className="acp-kpi-label">Referência mensal</span>
          <span className="acp-kpi-value">{formatHours(data.refMensal)}</span>
        </div>
        <div className="acp-kpi">
          <span className="acp-kpi-label">Disponíveis</span>
          <span className="acp-kpi-value">{colaboradores.filter(row => row.alocacao.disponivel).length}</span>
        </div>
      </div>

      <div className="acp-colab-kanban-shell">
        <div className="acp-colab-board-head">
          <div className="sec">{view === 'mapa' ? 'Mapa de equipe' : 'Quadro de alocação'}</div>
          <div className="acp-seg acp-colab-view-toggle" role="group" aria-label="Visualização dos colaboradores">
            <button
              type="button"
              className={view === 'mapa' ? 'acp-seg-btn active' : 'acp-seg-btn'}
              onClick={() => updateParams({ view: null })}
            >
              Mapa
            </button>
            <button
              type="button"
              className={view === 'kanban' ? 'acp-seg-btn active' : 'acp-seg-btn'}
              onClick={() => updateParams({ view: 'kanban' })}
            >
              Kanban
            </button>
          </div>
        </div>
        {colaboradores.length === 0 ? (
          <div className="placeholder-copy acp-colab-empty">
            {q || disponivel ? 'Nenhum colaborador encontrado para os filtros atuais.' : 'Nenhum dado de ponto encontrado para este ano.'}
          </div>
        ) : view === 'mapa' ? (
          <CollaboratorMapView
            colaboradores={sortedColaboradores}
            refMensal={data.refMensal}
            onOpen={id => updateParams({ colaborador: id })}
          />
        ) : (
          <div className="acp-colab-kanban" data-acp-colab-kanban>
            {columns.map(column => (
              <section className={`acp-colab-column ${column.status}`} key={column.status}>
                <div className="acp-colab-column-head">
                  <div>
                    <strong>{statusColumnTitle(column.status)}</strong>
                    <small>{statusDescription(column.status)}</small>
                  </div>
                  <span>{column.rows.length}</span>
                </div>
                <div className="acp-colab-column-list">
                  {column.rows.length ? column.rows.map(row => (
                    <CollaboratorKanbanCard
                      key={row.collaboratorId}
                      collaborator={row}
                      refMensal={data.refMensal}
                      onOpen={() => updateParams({ colaborador: row.collaboratorId })}
                    />
                  )) : (
                    <div className="placeholder-copy acp-colab-column-empty">Nenhum colaborador nesta situação.</div>
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
      <CollaboratorsNovelty
        user={noveltyUser}
        enabled={noveltyActive}
        onSeen={() => setNoveltyActive(false)}
      />
    </div>
  );
}
