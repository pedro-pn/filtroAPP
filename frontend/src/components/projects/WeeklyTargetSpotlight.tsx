import { useState } from 'react';
import { Target } from 'lucide-react';

import { corporateToday, currentWeeklyProgressComparison, type WeeklyProgressComparison, type WeeklyServiceHistoryPoint } from '../../../../shared/modules/mission-weekly-progress.js';
import type { ProgressHistoryPoint } from '../../api/acompanhamentoComercial';
import type { WeeklyTargetOwner } from '../../api/weeklyProgressTargets';
import { formatDateOnly } from '../../utils/dateOnly';
import { AppIcon } from '../icons/AppIcon';
import { Alert, Badge, Button, Card, Skeleton } from '../ui/ds';
import type { SemanticTone } from '../ui/ds';
import { WeeklyTargetDialog, type WeeklyTargetRequest } from './WeeklyTargetDialog';
import { useWeeklyTargets } from './useWeeklyTargets';
import { weeklyGoalLabel, weeklyValueLabel } from './weeklyTargetPresentation';
import './weekly-target-spotlight.css';

const fmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const short = (date: string) => formatDateOnly(date).slice(0, 5);
const period = (row: WeeklyProgressComparison) => `${short(row.periodStartDate)} a ${short(row.periodEndDate)}`;
const reached = (row: WeeklyProgressComparison) => row.status === 'ON_TARGET' || row.status === 'ABOVE';
const perDay = (row: WeeklyProgressComparison) => row.goals.length === 1 && row.basis === 'PER_PRODUCTIVE_DAY';

function spotlightStatus(row: WeeklyProgressComparison): { label: string; tone: SemanticTone } {
  if (!row.target) return { label: 'Sem meta definida', tone: 'neutral' };
  if (row.status === 'PLANNED') return { label: 'Aguardando início', tone: 'neutral' };
  if (row.status === 'NO_DATA') return { label: row.inProgress ? 'Aguardando RDOs' : 'Sem dados suficientes', tone: 'neutral' };
  if (row.status === 'NO_RULE') return { label: 'Sem cenário aplicável', tone: 'neutral' };
  if (!row.inProgress) return reached(row) ? { label: 'Meta atingida', tone: 'success' }
    : row.status === 'PARTIAL' ? { label: 'Meta parcial', tone: 'warning' } : { label: 'Meta não atingida', tone: 'danger' };
  // Metas por colaborador/dia crescem com os RDOs: o parcial já é comparável.
  const comparable = perDay(row) || row.goals.length > 1;
  if (reached(row)) return comparable ? { label: 'Dentro da meta até agora', tone: 'success' } : { label: 'Meta atingida', tone: 'success' };
  if (row.status === 'PARTIAL') return { label: 'Meta parcial até agora', tone: 'warning' };
  return comparable ? { label: 'Abaixo da meta até agora', tone: 'warning' } : { label: 'Em andamento', tone: 'info' };
}

// Soma o realizado por dia; com vários serviços, a equipe do RDO conta uma vez
// para calcular a meta diária.
function dailyBreakdown(history: WeeklyServiceHistoryPoint[], row: WeeklyProgressComparison, today: string) {
  const goal = row.goals[0];
  if (goal.metric !== 'M' && goal.metric !== 'L' && goal.metric !== 'UN') return [];
  const byDate = new Map<string, { collaborators: number; actualValue: number }>();
  for (const point of history) {
    if (point.date < row.periodStartDate || point.date > row.periodEndDate || point.date > today) continue;
    if (goal.serviceType && point.serviceType !== goal.serviceType) continue;
    const day = byDate.get(point.date) ?? { collaborators: 0, actualValue: 0 };
    day.actualValue += point.quantities[goal.metric] ?? 0;
    if (typeof point.productivePersonDays === 'number' && point.productivePersonDays > 0) {
      day.collaborators = Math.max(day.collaborators, point.productivePersonDays);
    }
    byDate.set(point.date, day);
  }
  return [...byDate].filter(([, day]) => day.collaborators > 0).sort(([a], [b]) => a.localeCompare(b))
    .map(([date, day]) => ({ date, collaborators: day.collaborators,
      actualValue: Math.round(day.actualValue * 100) / 100,
      plannedValue: Math.round(day.collaborators * goal.value * 100) / 100 }));
}

function SingleResult({ row, history, today }: { row: WeeklyProgressComparison; history: WeeklyServiceHistoryPoint[]; today: string }) {
  const status = spotlightStatus(row);
  const goal = row.goals[0];
  const pct = row.plannedValue ? Math.min(100, Math.max(0, (row.actualValue ?? 0) / row.plannedValue * 100)) : 0;
  const days = perDay(row) && goal ? dailyBreakdown(history, row, today) : [];
  const diff = row.differenceValue == null ? '' : ` · diferença ${weeklyValueLabel(row.differenceValue, row.metric, true)}`;
  let caption: React.ReactNode = row.inProgress ? 'Semana em andamento.' : `Semana encerrada${diff}.`;
  if (row.status === 'NO_DATA' && perDay(row) && goal) caption = `A meta é ${weeklyValueLabel(goal.value, goal.metric)} por colaborador em cada dia com RDO e começa a contar no primeiro RDO do período.`;
  else if (row.status === 'NO_DATA') caption = row.inProgress ? 'Nenhum RDO com serviço neste período ainda.' : 'Sem RDOs suficientes para avaliar o período.';
  else if (perDay(row) && goal?.personDays != null) caption = <>{row.inProgress ? 'Até agora: ' : 'Meta: '}{weeklyValueLabel(goal.value, goal.metric)} × <strong>{fmt.format(goal.personDays)} colaboradores-dia</strong> (equipe dos RDOs){diff}</>;
  else if (row.inProgress && row.plannedValue != null && row.actualValue != null && row.actualValue < row.plannedValue) {
    caption = <>Faltam <strong>{weeklyValueLabel(row.plannedValue - row.actualValue, row.metric)}</strong> até {formatDateOnly(row.periodEndDate)}.</>;
  }
  return <div className="wts-now">
    <div className="wts-figure">
      <strong>{row.plannedValue == null ? weeklyValueLabel(row.actualValue ?? 0, row.metric) : fmt.format(row.actualValue ?? 0)}</strong>
      <span>{row.plannedValue == null ? row.status === 'NO_DATA' ? 'nenhum dia trabalhado ainda' : 'meta a calcular' : `de ${weeklyValueLabel(row.plannedValue, row.metric)}`}</span>
      <Badge tone={status.tone}>{status.label}</Badge>
    </div>
    <div className="wts-track" role="progressbar" aria-label="Realizado da meta" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <i className={`wts-fill tone-${status.tone}`} style={{ width: `${pct}%` }} />
    </div>
    <p className="wts-caption">{caption}</p>
    {days.length ? <>
      <p className="wts-caption">Feito / meta por dia</p>
      <ul className="wts-days" aria-label="Feito e meta por dia com RDO">{days.map(({ date, collaborators, actualValue, plannedValue }) => <li key={date}>
        <span>{short(date)}</span><strong>{weeklyValueLabel(actualValue, goal.metric)} / {weeklyValueLabel(plannedValue, goal.metric)}</strong>
        <small>{plannedValue > 0 ? `${fmt.format(actualValue / plannedValue * 100)}% da meta` : '—'}</small>
        <small>{collaborators} {collaborators === 1 ? 'colaborador' : 'colaboradores'}</small>
      </li>)}</ul>
    </> : null}
  </div>;
}

function MultiResult({ row }: { row: WeeklyProgressComparison }) {
  const status = spotlightStatus(row);
  const met = row.goals.filter(goal => goal.outcome === 'MET').length;
  return <div className="wts-now">
    <div className="wts-figure">
      <strong>{met} de {row.goals.length}</strong>
      <span>metas cumpridas</span>
      <Badge tone={status.tone}>{status.label}</Badge>
    </div>
    <p className="wts-caption">{row.logic === 'ANY' ? 'Basta uma ser cumprida (OU).' : 'Todas precisam ser cumpridas (E).'}</p>
    <ul className="wts-goals">{row.goals.map((goal, index) => {
      const done = goal.outcome === 'MET';
      const pending = row.inProgress && goal.outcome === 'BELOW';
      const tone = done ? 'success' : goal.outcome === 'BELOW' ? pending ? 'warning' : 'danger' : 'neutral';
      const pct = goal.plannedValue ? Math.min(100, Math.max(0, (goal.actualValue ?? 0) / goal.plannedValue * 100)) : done ? 100 : 0;
      const outcome = done ? 'Cumprida' : goal.outcome === 'NO_DATA' ? 'Sem dados' : goal.outcome === 'PLANNED' ? 'Futura'
        : pending ? goal.executed === false ? 'Pendente' : 'Abaixo até agora' : 'Não cumprida';
      return <li key={index} className={`tone-${tone}`}>
        <div className="wts-goal-head">
          <strong>{weeklyGoalLabel(goal)}</strong>
          <span>{weeklyValueLabel(goal.actualValue, goal.metric)}{goal.plannedValue != null ? ` de ${weeklyValueLabel(goal.plannedValue, goal.metric)}` : ''}</span>
          <em>{outcome}</em>
        </div>
        <div className="wts-track wts-track--thin" aria-hidden="true"><i className={`wts-fill tone-${tone}`} style={{ width: `${pct}%` }} /></div>
        {goal.kind === 'SERVICE' && goal.executed === false ? <small>Sem RDO deste serviço no período.</small>
          : goal.basis === 'PER_PRODUCTIVE_DAY' && goal.personDays != null ? <small>{weeklyValueLabel(goal.value, goal.metric)} por colaborador × {fmt.format(goal.personDays)} colaboradores-dia</small> : null}
      </li>;
    })}</ul>
  </div>;
}

function HistoryBars({ rows, selected }: { rows: WeeklyProgressComparison[]; selected: string }) {
  // Uma meta: barras na unidade dela. Várias: % da meta (pior na regra E, melhor na OU).
  const withTarget = rows.filter(row => row.target && row.goals.length);
  const percent = withTarget.some(row => row.goals.length > 1) || new Set(withTarget.map(row => row.metric)).size > 1;
  const value = (row: WeeklyProgressComparison) => percent ? row.achievementPct : row.actualValue;
  const target = (row: WeeklyProgressComparison) => percent ? (row.target ? 100 : null) : row.plannedValue;
  const max = Math.max(1, ...rows.map(row => Math.max(value(row) ?? 0, target(row) ?? 0))) * 1.12;
  return <ol className="wts-bars" aria-label="Resultado das últimas semanas">
    {rows.map(row => {
      const state = row.inProgress ? 'is-current' : reached(row) ? 'is-hit' : row.status === 'PARTIAL' ? 'is-partial' : row.status === 'BELOW' ? 'is-miss' : 'is-empty';
      const shown = value(row), goal = target(row);
      return <li key={row.weekStartDate} className={`${state}${row.weekStartDate === selected ? ' is-selected' : ''}`}
        aria-label={`${period(row)}: ${spotlightStatus(row).label}`}>
        <span className="wts-bar-value">{shown == null ? '—' : `${fmt.format(shown)}${percent ? '%' : ''}`}</span>
        <span className="wts-bar-track">
          <i className="wts-bar-fill" style={{ height: `${Math.max(0, shown ?? 0) / max * 100}%` }} />
          {goal != null ? <i className="wts-bar-target" style={{ bottom: `${goal / max * 100}%` }} /> : null}
        </span>
        <small>{row.inProgress ? 'Atual' : short(row.periodStartDate)}</small>
      </li>;
    })}
  </ol>;
}

/**
 * Meta semanal no topo do dashboard. Abre na última semana fechada (a da reunião
 * de sexta) e alterna para a semana em andamento.
 */
export function WeeklyTargetSpotlight({ owner, progressHistory, canManage = false, onOpenHistory }: {
  owner: WeeklyTargetOwner; progressHistory?: ProgressHistoryPoint[]; canManage?: boolean; onOpenHistory: () => void;
}) {
  const [view, setView] = useState<'closed' | 'current'>('closed');
  const [request, setRequest] = useState<WeeklyTargetRequest | null>(null);
  const { query, targets, rows, serviceHistory, workdays } = useWeeklyTargets(owner, progressHistory);
  const today = corporateToday();
  const current = currentWeeklyProgressComparison(rows, today);
  const closed = rows.filter(row => row.periodEndDate < today);
  const previous = closed[0];
  const dialog = canManage ? <WeeklyTargetDialog owner={owner} request={request} targets={targets} workdays={workdays} onClose={() => setRequest(null)} /> : null;
  const head = (subtitle: React.ReactNode, actions?: React.ReactNode) => <header className="wts-head">
    <span className="wts-icon" aria-hidden="true"><AppIcon icon={Target} size="sm" /></span>
    <div><h2>Meta da semana</h2><p>{subtitle}</p></div>
    {actions ? <div className="wts-actions">{actions}</div> : null}
  </header>;

  if (query.isPending) return <Card padding="sm" className="wts" data-acp-weekly-spotlight>{head('Carregando a meta semanal…')}<Skeleton variant="text" lines={2} label="Carregando meta semanal" /></Card>;
  if (query.isError) return <Card padding="sm" className="wts" data-acp-weekly-spotlight>{head('Meta semanal')}
    <Alert tone="warning" title="Não foi possível carregar a meta semanal." action={<Button size="sm" variant="secondary" onClick={() => void query.refetch()}>Tentar novamente</Button>} /></Card>;
  if (!current) return null;
  // Sem meta na semana fechada nem na atual: só quem pode cadastrar vê o convite.
  if (!previous?.target && !current.target) {
    if (!canManage) return null;
    return <Card padding="sm" className="wts wts--empty" data-acp-weekly-spotlight>
      {head(`Nenhuma meta cadastrada para ${period(current)}.`, <>
        <Button size="sm" variant="secondary" onClick={() => setRequest({ weekStartDate: current.weekStartDate, referenceDate: today })}>Definir meta</Button>
        <Button size="sm" variant="ghost" onClick={onOpenHistory}>Histórico</Button>
      </>)}
      {dialog}
    </Card>;
  }
  const shown = view === 'closed' && previous ? previous : current;
  const evaluated = closed.filter(row => row.target && ['ON_TARGET', 'ABOVE', 'BELOW', 'PARTIAL'].includes(row.status));
  const history = [...evaluated.slice(0, 5).reverse(), current];
  const definition = shown.target?.definition;

  return <Card padding="sm" className="wts" data-acp-weekly-spotlight>
    {head(<>{formatDateOnly(shown.periodStartDate)} a {formatDateOnly(shown.periodEndDate)}
      {shown.goals.length === 1 ? ` · ${weeklyGoalLabel(shown.goals[0])}` : shown.goals.length > 1 ? ` · ${shown.goals.length} metas` : ''}
      {definition?.repeatWeekly || shown.target?.repeatedFromWeekStartDate ? ' · repete toda semana' : ''}</>, <>
      {previous ? <div className="wts-switch" role="group" aria-label="Semana exibida">
        <button type="button" aria-pressed={shown === previous} onClick={() => setView('closed')}>Fechada <span>{period(previous)}</span></button>
        <button type="button" aria-pressed={shown === current} onClick={() => setView('current')}>Atual <span>{period(current)}</span></button>
      </div> : null}
      {canManage ? <Button size="sm" variant="secondary" onClick={() => setRequest({ weekStartDate: current.weekStartDate, referenceDate: today })}>{current.target ? 'Editar meta' : 'Definir meta'}</Button> : null}
      <Button size="sm" variant="ghost" onClick={onOpenHistory}>Histórico</Button>
    </>)}
    <div className="wts-body">
      {shown.target ? shown.goals.length > 1 ? <MultiResult row={shown} /> : <SingleResult row={shown} history={serviceHistory} today={today} />
        : <div className="wts-now wts-now--empty"><p>Nenhuma meta valia para {period(shown)}.</p></div>}
      <div className="wts-history">
        <div className="wts-history-head"><span>Últimas semanas <em className="wts-legend"><i />meta</em></span>
          <strong>{evaluated.filter(reached).length} de {evaluated.length} atingidas</strong></div>
        <HistoryBars rows={history} selected={shown.weekStartDate} />
      </div>
    </div>
    {dialog}
  </Card>;
}
