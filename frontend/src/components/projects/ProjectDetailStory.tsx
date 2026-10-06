import type { ReactNode } from 'react';
import type { ProjectDetail } from '../../api/acompanhamentoComercial';
import { BarList, Button, Card } from '../ui/ds';
import { HelpTip } from '../ui/HelpTip';
import { PortalTip } from '../ui/PortalTip';
import { AppIcon } from '../icons/AppIcon';
import { CalendarClock, ClipboardList, Clock3, Coins, FileText, HardHat, Hourglass, Wallet } from 'lucide-react';
import { brl, DAY_META, fmtDate, fmtHM, fmtHours, toNum } from './projectDetailModel';
import { ProposalContributionDetails } from './ProjectDetailVisuals';
import { ProjectDetailSection } from './ProjectDetailSection';
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

export function ProjectTimeSnapshot({ data, onOpenStandbyHistory, reportsAction, progressPanel }: {
  data: ProjectDetail;
  onOpenStandbyHistory?: () => void;
  reportsAction?: ReactNode;
  progressPanel?: ReactNode;
}) {
  const hours = data.workedHours;
  const workedHoursPct = hours?.plannedTotalHours != null && hours.plannedTotalHours > 0
    ? hours.totalPct ?? Math.round((hours.totalWorkedHours / hours.plannedTotalHours) * 100)
    : null;
  const normalHours = Math.max(0, hours?.normalWorkedHours ?? 0);
  const overtimeHours = Math.max(0, hours?.overtimeWorkedHours ?? 0);
  const hoursScale = Math.max(hours?.plannedTotalHours ?? 0, normalHours + overtimeHours, 1);
  const normalWidth = Math.min(100, Math.round(normalHours / hoursScale * 1000) / 10);
  const overtimeWidth = Math.min(100 - normalWidth, Math.round(overtimeHours / hoursScale * 1000) / 10);
  const items = [
    { label: 'Dias corridos', value: `${data.diasCorridos.elapsed ?? '—'} / ${data.diasCorridos.planned ?? '—'}`, sub: `${pct(data.diasCorridos.pct)} do prazo`, percent: data.diasCorridos.pct, icon: CalendarClock, help: null },
    { label: 'Dias trabalhados', value: `${data.diasTrabalhados.worked} / ${data.diasTrabalhados.planned ?? '—'}`, sub: `${pct(data.diasTrabalhados.pct)} do planejado`, percent: data.diasTrabalhados.pct, icon: HardHat, help: null },
    { label: 'Horas trabalhadas', value: `${fmtHours(hours?.totalWorkedHours ?? 0)}${workedHoursPct != null ? ` · ${pct(workedHoursPct)}` : ''}`, sub: hours?.plannedTotalHours != null ? `de ${fmtHours(hours.plannedTotalHours)} previstas` : 'Sem previsão de horas', percent: null, icon: Clock3, help: 'Soma das horas-homem dos relatórios de execução, separando horas normais e horas extras. Cada turno é multiplicado pela quantidade de colaboradores daquele turno. O percentual compara o total trabalhado com as horas previstas.' },
    { label: 'Dias úteis', value: `${data.businessDays ?? '—'}`, sub: 'Dias úteis decorridos', percent: null, icon: CalendarClock, help: 'Dias de segunda a sexta decorridos desde o início, sem descontar feriados. Segue o mesmo período dos dias corridos.' },
    { label: 'Dias parados', value: data.stoppedDays == null ? '—' : `${data.stoppedDays} ${data.stoppedDays === 1 ? 'dia' : 'dias'}`, sub: `${fmtHM(data.standby.minutes)} de standby`, percent: null, icon: Hourglass, help: 'Datas distintas em que o standby cobriu a jornada completa. O tempo de standby inclui também as paradas parciais.' }
  ];
  return <Card padding="sm" className="acp-story-time" data-acp-time-snapshot>
    <ProjectDetailSection label="Evolução" header={<>
      <div className="acp-story-card-head"><div><h3>Evolução</h3><p className="acp-detail-section-subtitle">Execução registrada</p></div><span className="acp-story-soft-label">RDO e ponto</span></div>
    </>}>
      <div className="acp-story-time-grid">{items.map(item => <div className="acp-story-time-item" key={item.label}>
        <span className="acp-story-time-icon"><AppIcon icon={item.icon} size="sm" /></span><span>{item.help ? <HelpTip help={item.help}>{item.label}</HelpTip> : item.label}</span><strong>{item.value}</strong><small>{item.sub}</small>
        {item.label === 'Horas trabalhadas' ? <div className="acp-story-hours-breakdown" role="group" aria-label="Composição das horas trabalhadas">
          <div className="acp-story-hours-meter" aria-hidden="true">
            <span className="is-normal" style={{ width: `${normalWidth}%` }} />
            <span className="is-overtime" style={{ width: `${overtimeWidth}%` }} />
          </div>
          <div className="acp-story-hours-legend">
            <span><i className="is-normal" />Normais {fmtHours(normalHours)}</span>
            <span><i className="is-overtime" />HE {fmtHours(overtimeHours)}</span>
          </div>
        </div> : item.percent != null ? <div className="acp-story-meter" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, item.percent))}%` }} /></div> : null}
      </div>)}
        <Card padding="sm" className="acp-overview-kpi acp-detail-last-rdo" data-acp-detail-last-rdo>
          <div className="acp-overview-kpi-icon"><AppIcon icon={ClipboardList} /></div>
          <span>Último RDO</span><strong>{fmtDate(data.header.lastRdoDate)}</strong>
          <small>{data.header.lastRdoDate ? 'Último lançamento registrado' : 'Sem relatório registrado'}</small>
        </Card>
      </div>
      {progressPanel}
      <div className="acp-story-time-extras">
        <div className="acp-story-time-days">
          <ProjectDetailSection label="Últimos dias" header={<>
            <strong><HelpTip help="Status dos dias mais recentes com relatório de execução: verde = trabalhado, amarelo = trabalhado com standby, vermelho = totalmente parado. Passe o mouse para ver as horas.">Últimos dias</HelpTip></strong>
          </>}>
            {data.ultimosDias.length === 0 ? <span className="acp-story-time-empty">Sem relatórios de execução.</span>
              : <div className="acp-story-time-bar" role="group" aria-label="Situação dos últimos dias">
                {data.ultimosDias.map((day, index) => <PortalTip
                  key={`${day.date}-${index}`}
                  triggerClassName={`acp-story-time-segment ${DAY_META[day.status].cls}`}
                  ariaLabel={`${fmtDate(day.date)}: ${DAY_META[day.status].label}`}
                  content={<>
                    <div className="acp-detail-tip-date">{fmtDate(day.date)}</div>
                    <div className="acp-detail-tip-status"><span className={`acp-detail-tip-dot ${DAY_META[day.status].cls}`} />{DAY_META[day.status].label}</div>
                    <div className="acp-detail-tip-row"><span>Trabalhado</span><strong>{fmtHM(day.workedMinutes)}</strong></div>
                    <div className="acp-detail-tip-row"><span>Standby</span><strong>{fmtHM(day.standbyMinutes)}</strong></div>
                  </>}
                ><span aria-hidden="true" /></PortalTip>)}
              </div>}
          </ProjectDetailSection>

        </div>
      </div>
      {(onOpenStandbyHistory || reportsAction) ? <div className="acp-story-time-actions">
        {onOpenStandbyHistory ? <Button type="button" size="sm" variant="secondary" aria-haspopup="dialog" data-acp-standby-history-trigger onClick={onOpenStandbyHistory}>Ver histórico de standby</Button> : null}
        {reportsAction}
      </div> : null}
    </ProjectDetailSection>
  </Card>;
}

export function ProjectFinancialSnapshot({ data, children }: { data: ProjectDetail; children?: ReactNode }) {
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
    <ProjectDetailSection label="Consumo de gastos" header={<>
      <div className="acp-story-card-head"><div><h3>Consumo de gastos</h3><p className="acp-detail-section-subtitle">Quanto do previsto já foi usado</p></div>
        <span className={`acp-story-status ${spentPct == null ? 'is-neutral' : spentPct > 100 ? 'is-warning' : 'is-success'}`}>{spentPct == null ? 'Sem orçamento' : spentPct > 100 ? 'Acima do previsto' : 'Dentro do previsto'}</span>
      </div>
    </>}>
      <div className="acp-story-amount"><strong>{brl(actual)}</strong><span>de {brl(planned)} previstos{spentPct != null ? ` · ${pct(spentPct)}` : ''}</span></div>
      {!data.division && data.consumo.previstoIntegral != null && data.consumo.previstoIntegral !== planned ? (
        <p className="acp-story-caption">Previsto integral: {brl(data.consumo.previstoIntegral)} · Considerado{data.proposalPercentage != null ? ` (${data.proposalPercentage.toLocaleString('pt-BR')}%)` : ''}: {brl(planned)}</p>
      ) : null}
      <div className={`acp-story-meter acp-story-meter--large${spentPct != null && spentPct > 100 ? ' is-over' : ''}`} aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, spentPct ?? 0))}%` }} /></div>
      <p className="acp-story-caption">{remaining == null ? 'Custo previsto não informado.' : remaining >= 0 ? `${brl(remaining)} ainda disponíveis no previsto` : `${brl(Math.abs(remaining))} acima do previsto`}</p>
      <div className="acp-story-divider" />
      <ProjectDetailSection label="De onde veio o custo" header={<>
        <h4>De onde veio o custo</h4>
      </>}>
        <div className="acp-story-cost-stack" aria-label="Distribuição dos custos informados">{segments.filter(segment => segment.value > 0).map(segment =>
          <span key={segment.label} className={`is-${segment.className}`} style={{ width: `${segmentTotal > 0 ? segment.value / segmentTotal * 100 : 0}%` }} title={`${segment.label}: ${brl(segment.value)}`} />)}</div>
        <div className="acp-story-cost-legend">{segments.map(segment => <div key={segment.label}><span className={`is-${segment.className}`} />{segment.label}<strong>{brl(segment.value)}</strong></div>)}</div>
      </ProjectDetailSection>
      <ProposalContributionDetails original={data.budgetBreakdown?.original} additionals={data.budgetBreakdown?.additionals} />
      <div className="acp-story-divider" />
      <ProjectDetailSection label="Maiores gastos (Omie + estoque + manual)" header={<>
        <h4><HelpTip help="As 5 maiores categorias de despesa do projeto, somando Omie sem salários, consumo líquido de químicos/filtros do estoque e custos manuais.">Maiores gastos (Omie + estoque + manual)</HelpTip></h4>
      </>}>
        {data.maioresGastos.length === 0 ? <p className="acp-story-caption">Sem gastos registrados.</p> : <BarList
          aria-label="Maiores gastos por categoria"
          items={data.maioresGastos.map((spend, index) => ({
            id: String(index), label: spend.categoria, valueLabel: brl(spend.total),
            percentage: 100 * Math.max(0, spend.total) / Math.max(1, ...data.maioresGastos.map(item => item.total))
          }))}
        />}
      </ProjectDetailSection>
      {children}
    </ProjectDetailSection>
  </Card>;
}

export function ProjectBillingSnapshot({ data }: { data: ProjectDetail }) {
  const expected = toNum(data.faturamento.previsto);
  const invoiced = toNum(data.faturamento.realizado);
  const invoiceCount = data.faturamento.notas ?? 0;
  return <Card padding="sm" className="acp-story-billing" data-acp-billing-snapshot>
    <ProjectDetailSection label="Faturamento e impostos" header={<>
      <div className="acp-story-card-head"><div><h3>Faturamento e impostos</h3><p className="acp-detail-section-subtitle">Venda e notas sincronizadas</p></div><AppIcon icon={FileText} /></div>
    </>}>
      <div className="acp-story-billing-main"><span>Faturado no Omie</span><strong>{brl(invoiced)}</strong><small>de {brl(expected)} previstos</small></div>
      {expected != null && expected > 0 && invoiced != null ? <div className="acp-story-meter" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, invoiced / expected * 100))}%` }} /></div> : null}
      <div className="acp-story-billing-facts">
        <span><AppIcon icon={FileText} size="sm" /> Notas fiscais <strong>{invoiceCount}</strong></span>
        {data.presumedProfitTaxes ? <span><AppIcon icon={Coins} size="sm" /> Impostos estimados <strong>{brl(data.presumedProfitTaxes.totalTax)}</strong></span> : null}
        <span><AppIcon icon={Wallet} size="sm" /> Venda prevista <strong>{brl(expected)}</strong></span>
      </div>
      <p className="acp-story-caption">{invoiceCount ? 'Faturamento sincronizado no Omie; consulte as notas e o recebimento abaixo.' : 'Sem nota fiscal sincronizada para este projeto.'}</p>
    </ProjectDetailSection>
  </Card>;
}
