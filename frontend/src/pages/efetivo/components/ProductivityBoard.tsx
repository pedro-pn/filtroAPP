import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

import { getEfetivoProductivity } from '../../../api/efetivo';
import { Button } from '../../../components/ui/Button';
import {
  parseProductivityPeriod,
  PRODUCTIVITY_MONTH_OPTIONS,
  productivityYearOptions,
  setProductivityPeriodParams
} from '../utils/productivityPeriods';
import { ReferenceSettingModal } from './ReferenceSettingModal';
import { ProductivityPendingList } from './ProductivityPendingList';
import { ProductivityCollaboratorDetail } from './ProductivityCollaboratorDetail';

interface Props {
  canManage: boolean;
}

function hours(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;
}

function percent(value: number | null | undefined) {
  if (value === null || value === undefined) return 'Indisponível';
  return value.toLocaleString('pt-BR', { style: 'percent', maximumFractionDigits: 1 });
}

function dateTime(value: string | null | undefined) {
  if (!value) return 'não informada';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'não informada' : date.toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  });
}

const statusLabel = { CONSOLIDADO: 'Consolidado', PODE_MUDAR: 'Pode mudar', SEM_BASE: 'Sem base' } as const;

function monthLabel(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(year, monthNumber - 1, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
}

export function ProductivityBoard({ canManage }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [referenceOpen, setReferenceOpen] = useState(false);
  const period = parseProductivityPeriod(searchParams);
  const collaboratorId = searchParams.get('colaborador');
  const years = useMemo(() => productivityYearOptions(), []);
  const query = useQuery({
    queryKey: ['efetivo', 'produtividade', period.year, period.cutoffMonth],
    queryFn: () => getEfetivoProductivity({ ano: period.year, ateMes: period.cutoffMonth }),
    placeholderData: keepPreviousData
  });

  function updatePeriod(next: Partial<typeof period>) {
    setSearchParams(current => setProductivityPeriodParams(current, { ...period, ...next }), { replace: true });
  }

  function openCollaborator(collaboratorId: string) {
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      next.set('colaborador', collaboratorId);
      return next;
    }, { replace: true });
  }

  function closeCollaborator() {
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      next.delete('colaborador');
      return next;
    }, { replace: true });
  }

  if (query.isLoading) return <div className="page-card placeholder-copy">Carregando produtividade…</div>;
  if (query.isError || !query.data) {
    return <div className="page-card placeholder-copy">Não foi possível carregar a produtividade.</div>;
  }

  const data = query.data;
  const maxEvolution = Math.max(
    data.referenciaMensalHH,
    ...data.evolucaoMensal.map(item => item.mediaHH || 0)
  );

  return (
    <div className="efetivo-board">
      <section className="page-card efetivo-filter-card" aria-label="Filtros de produtividade" data-efetivo-filters>
        <div className="field-group">
          <label htmlFor="efetivo-year">Ano</label>
          <select id="efetivo-year" value={period.year} onChange={event => updatePeriod({ year: Number(event.target.value) })}>
            {years.map(year => <option key={year} value={year}>{year}</option>)}
          </select>
        </div>
        <div className="field-group">
          <label htmlFor="efetivo-cutoff">Mês de corte</label>
          <select id="efetivo-cutoff" value={period.cutoffMonth} onChange={event => updatePeriod({ cutoffMonth: Number(event.target.value) })}>
            {PRODUCTIVITY_MONTH_OPTIONS.map(month => <option key={month.value} value={month.value}>{month.label}</option>)}
          </select>
        </div>
        <div className="efetivo-filter-note">
          O mês corrente fica fora do cálculo, mesmo quando incluído no corte.
        </div>
      </section>

      <section className="efetivo-kpis" aria-label="Resumo de produtividade" data-efetivo-kpis>
        <article className="efetivo-kpi">
          <span>HH produtivas acumuladas</span>
          <strong>{hours(data.resumo.hhAcumuladas)}</strong>
          <small>Horas extras excluídas</small>
        </article>
        <article className="efetivo-kpi">
          <span>Média mensal da equipe</span>
          <strong>{hours(data.resumo.mediaMensalEquipe)}</strong>
          <small>Por mês equivalente analisado</small>
        </article>
        <article className="efetivo-kpi efetivo-kpi-accent">
          <span>Taxa Geral de Improdutividade</span>
          <strong>{percent(data.resumo.taxaGeral)}</strong>
          <small>Média simples das taxas válidas</small>
        </article>
        <article className="efetivo-kpi">
          <span>Pendências</span>
          <strong>{data.resumo.pendencias}</strong>
          <small>Não entram na taxa oficial</small>
        </article>
      </section>

      <section className="page-card efetivo-reference-card">
        <div>
          <span className="efetivo-eyebrow">Referência vigente</span>
          <strong>{hours(data.referenciaMensalHH)} / mês</strong>
          <p>Origem: 176 × 11 ÷ 12. Férias já estão anualizadas e não são descontadas novamente.</p>
          <p>HE70, HE100 e extras genéricas não entram nas HH produtivas.</p>
        </div>
        {canManage ? <Button variant="secondary" onClick={() => setReferenceOpen(true)}>Editar referência</Button> : null}
      </section>

      <section className="page-card">
        <div className="efetivo-section-heading">
          <div>
            <h2>Evolução mensal</h2>
            <p>Média de HH produtivas por mês contra a referência vigente.</p>
          </div>
          <span className="efetivo-reference-badge">Meta {hours(data.referenciaMensalHH)}</span>
        </div>
        <div className="efetivo-evolution">
          {data.evolucaoMensal.map(item => {
            const width = item.mediaHH === null || !maxEvolution ? 0 : Math.min(100, (item.mediaHH / maxEvolution) * 100);
            return (
              <div className="efetivo-month" key={item.mes}>
                <span className="efetivo-month-label">{monthLabel(item.mes)}</span>
                <span className="efetivo-month-track" aria-hidden="true">
                  <span className="efetivo-month-bar" style={{ width: `${width}%` }} />
                  <span className="efetivo-month-reference" style={{ left: `${Math.min(100, (data.referenciaMensalHH / maxEvolution) * 100)}%` }} />
                </span>
                <span className="efetivo-month-value">{hours(item.mediaHH)}</span>
                <span className="efetivo-month-flags">
                  {item.instavel ? <span className="efetivo-badge warning">Pode mudar</span> : null}
                  {item.temFerias ? <span className="efetivo-badge">Férias</span> : null}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="page-card" data-efetivo-results>
        <div className="efetivo-section-heading">
          <div>
            <h2>Resultado por colaborador</h2>
            <p>A taxa oficial usa todas as taxas válidas; quem está como “Pode mudar” ainda tem mês na janela de reprocessamento. Selecione uma pessoa para consultar o detalhe mensal.</p>
          </div>
        </div>
        {data.colaboradores.length ? (
          <div className="efetivo-table-wrap">
            <table className="efetivo-table">
              <thead>
                <tr>
                  <th>Colaborador</th>
                  <th>Cargo</th>
                  <th>HH acumuladas</th>
                  <th>Média mensal</th>
                  <th>HE excluídas</th>
                  <th>Meses analisados</th>
                  <th>Improdutividade</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {data.colaboradores.map(collaborator => (
                  <tr key={collaborator.id} onClick={() => openCollaborator(collaborator.id)}>
                    <td data-label="Colaborador"><button type="button" className="efetivo-row-link">{collaborator.nome}</button></td>
                    <td data-label="Cargo">{collaborator.cargo}</td>
                    <td data-label="HH acumuladas">{hours(collaborator.hhAcumuladas)}</td>
                    <td data-label="Média mensal">{hours(collaborator.mediaMensal)}</td>
                    <td data-label="HE excluídas">{hours(collaborator.heExcluidas)}</td>
                    <td data-label="Meses analisados">{collaborator.mesesAnalisados.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                    <td data-label="Improdutividade">
                      <strong>{percent(collaborator.improdutividade)}</strong>
                      {collaborator.mesesComFerias.length ? <span className="efetivo-vacation-note">Férias: {collaborator.mesesComFerias.map(monthLabel).join(', ')}</span> : null}
                    </td>
                    <td data-label="Situação">
                      <span className={`efetivo-badge ${collaborator.situacao === 'CONSOLIDADO' ? '' : 'warning'}`} title={collaborator.situacao === 'PODE_MUDAR' ? `Meses ainda na janela de reprocessamento: ${collaborator.mesesInstaveis.map(monthLabel).join(', ')}` : collaborator.situacao === 'SEM_BASE' ? 'Sem meses analisáveis no período; não entra na taxa oficial.' : 'Todos os meses analisados já saíram da janela de reprocessamento.'}>{statusLabel[collaborator.situacao]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="placeholder-copy">Nenhum colaborador elegível no período.</p>}
      </section>

      <ProductivityPendingList items={data.pendentes} />

      <section className="page-card efetivo-data-note">
        <strong>Validade dos dados</strong>
        <p>Última sincronização: {dateTime(data.sincronizacao.ultimaSincronizacao)}.</p>
        <p>Alcance: {dateTime(data.sincronizacao.inicioHistorico)} até {dateTime(data.sincronizacao.fimHistorico)}.</p>
        <p>Meses dentro da janela de reprocessamento de 31 dias aparecem como “Pode mudar”.</p>
      </section>

      {canManage ? (
        <ReferenceSettingModal
          open={referenceOpen}
          reference={data.referenciaMensalHH}
          onClose={() => setReferenceOpen(false)}
        />
      ) : null}
      {collaboratorId ? (
        <ProductivityCollaboratorDetail
          collaboratorId={collaboratorId}
          period={{ ano: period.year, ateMes: period.cutoffMonth }}
          onClose={closeCollaborator}
        />
      ) : null}
    </div>
  );
}
