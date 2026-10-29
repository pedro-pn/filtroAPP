import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

import { todayDateOnly } from '../../utils/dateOnly';
import { AppIcon } from '../icons/AppIcon';
import { Badge, Button } from '../ui/ds';
import { brl, clampPct, fmtDate, fmtPct } from './projectDetailModel';
import { dateGapDays, type MeetingKpiKey, type MeetingTone, type ProjectMeeting } from './projectMeetingModel';
import './ProjectMeetingSummary.css';

const KPI_LABELS: Record<MeetingKpiKey, string> = { cost: 'Gastos', scope: 'Avanço do escopo', rdo: 'Relatórios assinados', time: 'Prazo' };
const KPI_LINKS: Record<MeetingKpiKey, string> = { cost: 'Ver custo', scope: 'Ver avanço', rdo: 'Ver RDOs', time: 'Ver prazo' };
const DETAIL_HINTS: Record<MeetingKpiKey, string> = {
  cost: 'Origem, propostas e maiores gastos', scope: 'Histórico, serviços e metas',
  rdo: 'Assinaturas e últimos dias', time: 'Linha do tempo, horas e standby'
};

const number = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const signedPoints = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${number(Math.abs(value))} p.p.`;

function Meter({ value, tone, reference }: { value: number | null; tone: MeetingTone; reference?: { value: number; label: string } | null }) {
  return <span className="acp-meeting-meter" aria-hidden="true">
    <span className={`acp-meeting-meter__fill is-${tone}`} style={{ width: `${clampPct(value)}%` }} />
    {reference ? <span className={`acp-meeting-meter__ref${reference.value > 70 ? ' is-end' : ''}`} style={{ left: `${clampPct(reference.value)}%` }}>
      <span>{reference.label}</span>
    </span> : null}
  </span>;
}

function daysAgo(date: string | null) {
  const gap = date ? dateGapDays(todayDateOnly(), date.slice(0, 10)) : null;
  return gap == null || gap < 0 ? null : gap === 0 ? 'hoje' : gap === 1 ? 'há 1 dia' : `há ${gap} dias`;
}

/**
 * Resumo de reunião do dashboard do projeto: quatro indicadores, leitura e pontos de
 * atenção. Cada card abre o seu detalhe logo abaixo da fileira, um por vez.
 */
export function ProjectMeetingSummary({ meeting, scopeLabel, weekly, details, defaultOpen = null }: {
  meeting: ProjectMeeting;
  scopeLabel?: string;
  weekly?: ReactNode;
  details: Partial<Record<MeetingKpiKey, ReactNode>>;
  defaultOpen?: MeetingKpiKey | null;
}) {
  const [open, setOpen] = useState<MeetingKpiKey | null>(defaultOpen);
  const [scrollToDetail, setScrollToDetail] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const cardRefs = useRef<Partial<Record<MeetingKpiKey, HTMLButtonElement | null>>>({});
  const { cost, scope, reports, time } = meeting;

  useEffect(() => {
    if (!scrollToDetail || !open) return;
    panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setScrollToDetail(false);
  }, [open, scrollToDetail]);

  const close = () => {
    const key = open;
    setOpen(null);
    if (key) cardRefs.current[key]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Modais abertos a partir do detalhe ficam em portal fora deste bloco.
    if (event.key !== 'Escape' || !open || !(event.target instanceof Node) || !rootRef.current?.contains(event.target)) return;
    event.preventDefault();
    close();
  };

  const cards: Array<{ key: MeetingKpiKey; label?: string; tone: MeetingTone; status: string; value: string; unit?: string; sub: ReactNode; meter: ReactNode; extra?: ReactNode }> = [];
  cards.push({
    key: 'cost', tone: cost.status.tone, status: cost.status.label,
    value: cost.spentPct != null && !cost.presentation ? number(cost.spentPct) : brl(cost.actual),
    unit: cost.spentPct != null && !cost.presentation ? '%' : undefined,
    sub: cost.presentation ? 'Custo realizado do projeto'
      : cost.planned != null ? <><strong>{brl(cost.actual)}</strong> de {brl(cost.planned)} previstos</> : 'Custo previsto não informado',
    meter: cost.spentPct != null && !cost.presentation ? <Meter value={cost.spentPct} tone={cost.status.tone}
      reference={cost.progressPct != null ? { value: cost.progressPct, label: `avanço ${fmtPct(cost.progressPct)}` } : null} /> : null,
    extra: cost.projection?.showInCard ? <span className={`acp-meeting-kpi__note${cost.projection.factor > 1 ? ' is-over' : ''}`}>
      No ritmo atual: <strong>≈ {brl(cost.projection.amount)}</strong> <Badge tone="info">Estimativa</Badge>
    </span> : null
  });
  if (scope) cards.push({
    key: 'scope', label: scopeLabel ? `Avanço · ${scopeLabel}` : undefined, tone: scope.status.tone, status: scope.status.label,
    value: scope.progressPct != null ? number(scope.progressPct) : '—', unit: scope.progressPct != null ? '%' : undefined,
    sub: scope.gap != null ? <><strong>{signedPoints(scope.gap)}</strong> em relação ao prazo ({fmtPct(scope.timePct)})</>
      : scope.progressPct == null ? 'Aguardando medição do escopo' : 'Sem prazo para comparar',
    meter: <Meter value={scope.progressPct} tone={scope.status.tone}
      reference={scope.timePct != null ? { value: scope.timePct, label: `prazo ${fmtPct(scope.timePct)}` } : null} />,
    extra: weekly ? <span className="acp-meeting-kpi__weekly">{weekly}</span> : null
  });
  const ago = daysAgo(reports.lastRdoDate);
  cards.push({
    key: 'rdo', tone: reports.status.tone, status: reports.status.label,
    value: reports.signed != null ? String(reports.signed) : '—', unit: ` / ${reports.total ?? '—'}`,
    sub: <>Último RDO <strong>{fmtDate(reports.lastRdoDate)}</strong>{ago ? ` · ${ago}` : ''}</>,
    meter: reports.total ? <Meter value={(reports.signed ?? 0) / reports.total * 100} tone={reports.status.tone === 'success' ? 'success' : 'neutral'} /> : null
  });
  cards.push({
    key: 'time', label: time.rental ? 'Dias de locação' : undefined, tone: time.status.tone, status: time.status.label,
    value: time.elapsed != null ? String(time.elapsed) : '—', unit: ` / ${time.planned ?? '—'} dias`,
    sub: time.rental ? <>Fim <strong>{fmtDate(time.expectedEnd)}</strong>{time.remaining != null && time.remaining >= 0 ? ` · restam ${time.remaining}` : ''}</>
      : <>Término <strong>{fmtDate(time.expectedEnd)}</strong>{time.projectedEnd ? <> · projeção <strong>{fmtDate(time.projectedEnd)}</strong></> : null}</>,
    meter: <Meter value={time.pct} tone="neutral" />
  });

  const openFromAttention = (key: MeetingKpiKey) => {
    setOpen(key);
    setScrollToDetail(true);
  };

  return <div className="acp-meeting" ref={rootRef} onKeyDown={onKeyDown} data-acp-meeting-summary>
    <div className="acp-meeting-kpis" role="group" aria-label="Indicadores do projeto">
      {cards.map(card => <button key={card.key} type="button" ref={element => { cardRefs.current[card.key] = element; }}
        className={`acp-meeting-kpi is-${card.tone}`} aria-expanded={open === card.key} aria-controls={`acp-meeting-detail-${card.key}`}
        data-acp-meeting-kpi={card.key} onClick={() => setOpen(current => current === card.key ? null : card.key)}>
        <span className="acp-meeting-kpi__top">
          <span className="acp-meeting-kpi__label">{card.label ?? KPI_LABELS[card.key]}</span>
          <Badge tone={card.tone}>{card.status}</Badge>
        </span>
        <span className="acp-meeting-kpi__value">{card.value}{card.unit ? <small>{card.unit}</small> : null}</span>
        <span className="acp-meeting-kpi__sub">{card.sub}</span>
        {card.meter}
        {card.extra}
        <span className="acp-meeting-kpi__more">{DETAIL_HINTS[card.key]}<AppIcon icon={ChevronRight} size="sm" /></span>
      </button>)}
    </div>

    {open ? <section ref={panelRef} id={`acp-meeting-detail-${open}`} className="acp-meeting-detail" data-acp-meeting-detail={open}
      aria-labelledby={`acp-meeting-detail-title-${open}`}>
      <header className="acp-meeting-detail__head">
        <h2 id={`acp-meeting-detail-title-${open}`}>{open === 'time' && time.rental ? 'Dias de locação' : KPI_LABELS[open]}<span> · detalhe</span></h2>
        <Button type="button" size="sm" variant="secondary" onClick={close}>Fechar</Button>
      </header>
      {open === 'cost' && cost.projection ? <p className="acp-meeting-projection">
        <Badge tone="info">Estimativa</Badge>
        <span>No ritmo atual, o custo final fica em cerca de <strong>{brl(cost.projection.amount)}</strong> ({number(cost.projection.factor)}× o previsto).
          A conta divide o gasto pelo avanço e supõe que o restante custa o mesmo por ponto de avanço.</span>
      </p> : null}
      <div className="acp-meeting-detail__body">{details[open]}</div>
    </section> : null}

    {meeting.readout.length || meeting.attention.length ? <div className="acp-meeting-brief">
      {meeting.readout.length ? <section className="acp-meeting-readout" aria-labelledby="acp-meeting-readout-title">
        <h2 id="acp-meeting-readout-title">Leitura para a reunião</h2>
        <ul>{meeting.readout.map(sentence => <li key={sentence}>{sentence}</li>)}</ul>
      </section> : null}
      {meeting.attention.length ? <section className="acp-meeting-attention" aria-labelledby="acp-meeting-attention-title">
        <h2 id="acp-meeting-attention-title">Pontos de atenção</h2>
        <ul>{meeting.attention.map(item => <li key={item.label} className={`is-${item.tone}`}>
          <span>{item.label}</span>
          {item.kpi && details[item.kpi] ? <Button type="button" size="sm" variant="link" onClick={() => openFromAttention(item.kpi!)}>{KPI_LINKS[item.kpi]}</Button> : null}
        </li>)}</ul>
      </section> : null}
    </div> : null}
  </div>;
}
