import type { ProjectDetail } from '../../api/acompanhamentoComercial';
import { Card } from '../ui/ds';
import { AppIcon } from '../icons/AppIcon';
import { CalendarClock, Clock3, Coins, FileText, HardHat, Hourglass, Wallet } from 'lucide-react';
import { brl, fmtDate, fmtHM, toNum } from './projectDetailModel';
import './ProjectDetailStory.css';

function dateGapDays(projected: string | null, expected: string | null) {
  if (!projected || !expected) return null;
  const projectedMs = new Date(projected).getTime();
  const expectedMs = new Date(expected).getTime();
  return Number.isFinite(projectedMs) && Number.isFinite(expectedMs)
    ? Math.round((projectedMs - expectedMs) / 86400000) : null;
}

function pct(value: number | null) {
  return value == null ? '—' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

export function ProjectTimelineCard({ data }: { data: ProjectDetail }) {
  const gap = dateGapDays(data.footer.projectedEndByPace, data.footer.expectedEndDate);
  const milestones = [
    { label: 'Mobilização', date: data.footer.mobilizationDate, icon: HardHat },
    { label: 'Início real', date: data.footer.startDate, icon: CalendarClock },
    { label: 'Projeção pelo ritmo', date: data.footer.projectedEndByPace, icon: Hourglass },
    { label: 'Término previsto', date: data.footer.expectedEndDate, icon: CalendarClock }
  ];
  return <Card padding="sm" className="acp-story-timeline" data-acp-timeline>
    <div className="acp-story-card-head"><div><p>Linha do tempo da missão</p><h3>O projeto em relação ao cronograma</h3></div>
      <span className={`acp-story-status ${gap == null ? 'is-neutral' : gap > 0 ? 'is-warning' : 'is-success'}`}>
        {gap == null ? 'Sem projeção comparável' : gap > 0 ? `${gap} ${gap === 1 ? 'dia' : 'dias'} após o previsto` : gap < 0 ? `${Math.abs(gap)} ${gap === -1 ? 'dia' : 'dias'} antes do previsto` : 'Na data prevista'}
      </span>
    </div>
    <ol className="acp-story-milestones">{milestones.map((milestone, index) => <li key={milestone.label} className={milestone.date ? index < 2 ? 'is-recorded' : index === 2 ? 'is-projected' : '' : ''}>
      <span className="acp-story-milestone-icon"><AppIcon icon={milestone.icon} size="sm" /></span>
      <span>{milestone.label}</span><strong>{fmtDate(milestone.date)}</strong>
    </li>)}</ol>
    <p className="acp-story-timeline-note">{gap == null ? 'A projeção aparece quando há dados suficientes de prazo e avanço.' : gap > 0 ? 'O ritmo acumulado projeta conclusão depois da data prevista.' : gap < 0 ? 'O ritmo acumulado projeta conclusão antes da data prevista.' : 'O ritmo acumulado projeta conclusão na data prevista.'}</p>
  </Card>;
}

export function ProjectTimeSnapshot({ data }: { data: ProjectDetail }) {
  const hours = data.workedHours;
  const items = [
    { label: 'Dias corridos', value: `${data.diasCorridos.elapsed ?? '—'} / ${data.diasCorridos.planned ?? '—'}`, sub: `${pct(data.diasCorridos.pct)} do prazo`, percent: data.diasCorridos.pct, icon: CalendarClock },
    { label: 'Dias trabalhados', value: `${data.diasTrabalhados.worked} / ${data.diasTrabalhados.planned ?? '—'}`, sub: `${pct(data.diasTrabalhados.pct)} do planejado`, percent: data.diasTrabalhados.pct, icon: HardHat },
    { label: 'Horas trabalhadas', value: `${hours?.totalWorkedHours?.toLocaleString('pt-BR') ?? '0'}h`, sub: hours?.plannedTotalHours != null ? `de ${hours.plannedTotalHours.toLocaleString('pt-BR')}h previstas` : 'Sem previsão de horas', percent: hours?.totalPct ?? null, icon: Clock3 },
    { label: 'Standby', value: `${data.standby.count} ${data.standby.count === 1 ? 'dia' : 'dias'}`, sub: `${fmtHM(data.standby.minutes)} paradas`, percent: null, icon: Hourglass }
  ];
  return <Card padding="sm" className="acp-story-time" data-acp-time-snapshot>
    <div className="acp-story-card-head"><div><p>Uso do tempo</p><h3>Execução registrada</h3></div><span className="acp-story-soft-label">RDO e ponto</span></div>
    <div className="acp-story-time-grid">{items.map(item => <div className="acp-story-time-item" key={item.label}>
      <span className="acp-story-time-icon"><AppIcon icon={item.icon} size="sm" /></span><span>{item.label}</span><strong>{item.value}</strong><small>{item.sub}</small>
      {item.percent != null ? <div className="acp-story-meter" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, item.percent))}%` }} /></div> : null}
    </div>)}</div>
    <p className="acp-story-caption">Horas extras registradas: <strong>{fmtHM(data.overtimeMinutes)}</strong></p>
  </Card>;
}

export function ProjectFinancialSnapshot({ data }: { data: ProjectDetail }) {
  const actual = data.consumo.gasto + (data.maoDeObra.custo ?? 0);
  const planned = data.consumo.previsto;
  const spentPct = planned != null && planned > 0 ? actual / planned * 100 : null;
  const remaining = planned == null ? null : planned - actual;
  const segments = [
    { label: 'Compras Omie', value: data.consumo.omie ?? 0, className: 'omie' },
    { label: 'Estoque', value: data.consumo.estoque ?? 0, className: 'stock' },
    { label: 'Custos manuais', value: data.consumo.manual ?? 0, className: 'manual' },
    { label: 'Mão de obra', value: data.maoDeObra.custo ?? 0, className: 'labor' }
  ];
  const segmentTotal = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  return <Card padding="sm" className="acp-story-financial" data-acp-financial-snapshot>
    <div className="acp-story-card-head"><div><p>Consumo de gastos</p><h3>Quanto do previsto já foi usado</h3></div>
      <span className={`acp-story-status ${spentPct == null ? 'is-neutral' : spentPct > 100 ? 'is-warning' : 'is-success'}`}>{spentPct == null ? 'Sem orçamento' : spentPct > 100 ? 'Acima do previsto' : 'Dentro do previsto'}</span>
    </div>
    <div className="acp-story-amount"><strong>{brl(actual)}</strong><span>de {brl(planned)} previstos{spentPct != null ? ` · ${pct(spentPct)}` : ''}</span></div>
    <div className={`acp-story-meter acp-story-meter--large${spentPct != null && spentPct > 100 ? ' is-over' : ''}`} aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, spentPct ?? 0))}%` }} /></div>
    <p className="acp-story-caption">{remaining == null ? 'Custo previsto não informado.' : remaining >= 0 ? `${brl(remaining)} ainda disponíveis no previsto` : `${brl(Math.abs(remaining))} acima do previsto`}</p>
    <div className="acp-story-divider" />
    <h4>De onde veio o custo</h4>
    <div className="acp-story-cost-stack" aria-label="Distribuição dos custos informados">{segments.filter(segment => segment.value > 0).map(segment =>
      <span key={segment.label} className={`is-${segment.className}`} style={{ width: `${segmentTotal > 0 ? segment.value / segmentTotal * 100 : 0}%` }} title={`${segment.label}: ${brl(segment.value)}`} />)}</div>
    <div className="acp-story-cost-legend">{segments.map(segment => <div key={segment.label}><span className={`is-${segment.className}`} />{segment.label}<strong>{brl(segment.value)}</strong></div>)}</div>
  </Card>;
}

export function ProjectBillingSnapshot({ data }: { data: ProjectDetail }) {
  const expected = toNum(data.faturamento.previsto);
  const invoiced = toNum(data.faturamento.realizado);
  const invoiceCount = data.faturamento.notas ?? 0;
  return <Card padding="sm" className="acp-story-billing" data-acp-billing-snapshot>
    <div className="acp-story-card-head"><div><p>Faturamento e impostos</p><h3>Venda e notas sincronizadas</h3></div><AppIcon icon={FileText} /></div>
    <div className="acp-story-billing-main"><span>Faturado no Omie</span><strong>{brl(invoiced)}</strong><small>de {brl(expected)} previstos</small></div>
    {expected != null && expected > 0 && invoiced != null ? <div className="acp-story-meter" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, invoiced / expected * 100))}%` }} /></div> : null}
    <div className="acp-story-billing-facts">
      <span><AppIcon icon={FileText} size="sm" /> Notas fiscais <strong>{invoiceCount}</strong></span>
      {data.presumedProfitTaxes ? <span><AppIcon icon={Coins} size="sm" /> Impostos estimados <strong>{brl(data.presumedProfitTaxes.totalTax)}</strong></span> : null}
      <span><AppIcon icon={Wallet} size="sm" /> Venda prevista <strong>{brl(expected)}</strong></span>
    </div>
    <p className="acp-story-caption">{invoiceCount ? 'Faturamento sincronizado no Omie; consulte as notas e o recebimento abaixo.' : 'Sem nota fiscal sincronizada para este projeto.'}</p>
  </Card>;
}
