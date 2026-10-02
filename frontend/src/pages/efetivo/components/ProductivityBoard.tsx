import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

import { getEfetivoProductivity } from '../../../api/efetivo';
import { Badge, Button, Card, EmptyState, Field, MetricCard, Select, Skeleton } from '../../../components/ui/ds';
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

  if (query.isLoading) return <Card data-efetivo-productivity><Skeleton variant="card" /></Card>;
  if (query.isError || !query.data) {
    return <Card data-efetivo-productivity><EmptyState variant="error" title="Não foi possível carregar a produtividade." action={{ label: 'Tentar novamente', onClick: () => void query.refetch() }} /></Card>;
  }

  const data = query.data;
  const maxEvolution = Math.max(
    data.referenciaMensalHH,
    ...data.evolucaoMensal.map(item => item.mediaHH || 0)
  );

  return (
    <div className="efetivo-board efetivo-productivity-ds" data-efetivo-productivity>
      <Card className="efetivo-productivity-filters" aria-label="Filtros de produtividade" data-efetivo-filters padding="sm">
        <Field id="efetivo-year" label="Ano" optionalText="">
          <Select size="sm" value={period.year} onChange={event => updatePeriod({ year: Number(event.target.value) })}>
            {years.map(year => <option key={year} value={year}>{year}</option>)}
          </Select>
        </Field>
        <Field id="efetivo-cutoff" label="Mês de corte" optionalText="">
          <Select size="sm" value={period.cutoffMonth} onChange={event => updatePeriod({ cutoffMonth: Number(event.target.value) })}>
            {PRODUCTIVITY_MONTH_OPTIONS.map(month => <option key={month.value} value={month.value}>{month.label}</option>)}
          </Select>
        </Field>
        <div className="efetivo-filter-note">
          O mês corrente fica fora do cálculo, mesmo quando incluído no corte.
        </div>
      </Card>

      <section className="efetivo-productivity-kpis" aria-label="Resumo de produtividade" data-efetivo-kpis>
        <MetricCard label="HH produtivas acumuladas" value={hours(data.resumo.hhAcumuladas)} description="Horas extras excluídas" />
        <MetricCard label="Média mensal da equipe" value={hours(data.resumo.mediaMensalEquipe)} description="Por mês equivalente analisado" />
        <MetricCard label="Taxa Geral de Improdutividade" value={percent(data.resumo.taxaGeral)} description="Média simples das taxas válidas" tone="brand" />
        <MetricCard label="Pendências" value={data.resumo.pendencias} description="Não entram na taxa oficial" tone={data.resumo.pendencias ? 'warning' : 'neutral'} />
      </section>

      <Card className="efetivo-productivity-reference">
        <div>
          <span className="efetivo-eyebrow">Referência vigente</span>
          <strong>{hours(data.referenciaMensalHH)} / mês</strong>
          <p>Origem: 176 × 11 ÷ 12. Férias já estão anualizadas e não são descontadas novamente.</p>
          <p>HE70, HE100 e extras genéricas não entram nas HH produtivas.</p>
        </div>
        {canManage ? <Button variant="secondary" size="sm" onClick={() => setReferenceOpen(true)}>Editar referência</Button> : null}
      </Card>

      <Card className="efetivo-productivity-section">
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
                  {item.instavel ? <Badge tone="warning">Pode mudar</Badge> : null}
                  {item.temFerias ? <Badge tone="info">Férias</Badge> : null}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="efetivo-productivity-section" data-efetivo-results>
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
                    <td data-label="Colaborador"><Button type="button" variant="link" size="sm" className="efetivo-productivity-person-link">{collaborator.nome}</Button></td>
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
                      <Badge tone={collaborator.situacao === 'CONSOLIDADO' ? 'success' : 'warning'} title={collaborator.situacao === 'PODE_MUDAR' ? `Meses ainda na janela de reprocessamento: ${collaborator.mesesInstaveis.map(monthLabel).join(', ')}` : collaborator.situacao === 'SEM_BASE' ? 'Sem meses analisáveis no período; não entra na taxa oficial.' : 'Todos os meses analisados já saíram da janela de reprocessamento.'}>{statusLabel[collaborator.situacao]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="Nenhum colaborador elegível no período." />}
      </Card>

      <ProductivityPendingList items={data.pendentes} />

      <Card className="efetivo-productivity-data-note">
        <strong>Validade dos dados</strong>
        <p>Última sincronização: {dateTime(data.sincronizacao.ultimaSincronizacao)}.</p>
        <p>Alcance: {dateTime(data.sincronizacao.inicioHistorico)} até {dateTime(data.sincronizacao.fimHistorico)}.</p>
        <p>Meses dentro da janela de reprocessamento de 31 dias aparecem como “Pode mudar”.</p>
      </Card>

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
