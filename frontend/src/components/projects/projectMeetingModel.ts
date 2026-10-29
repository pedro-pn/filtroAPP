import type { ProjectDetail } from '../../api/acompanhamentoComercial';
import { brl } from './projectDetailModel';

// Resumo de reunião do dashboard do projeto: quatro indicadores, um selo de saúde
// ponderado, frases de leitura e pontos de atenção. Faixas e pesos aprovados pela
// gestão em 29/10/2026.

export type MeetingTone = 'success' | 'warning' | 'danger' | 'neutral';
export type MeetingKpiKey = 'cost' | 'scope' | 'rdo' | 'time';
export interface MeetingStatus { tone: MeetingTone; label: string }

export const MEETING_HEALTH_WEIGHTS: Record<MeetingKpiKey, number> = { cost: 0.35, time: 0.3, scope: 0.25, rdo: 0.1 };
/** A projeção de custo só aparece no card a partir deste avanço; no detalhe, sempre. */
export const COST_PROJECTION_CARD_MIN_PROGRESS = 20;
const COST_AHEAD_TOLERANCE = 5;
const SCOPE_ON_PACE_TOLERANCE = 5;
const SCOPE_LATE_TOLERANCE = 15;
const TIME_LATE_TOLERANCE_DAYS = 7;
const RDO_PENDING_DANGER_RATIO = 0.1;
const TONE_POINTS: Record<Exclude<MeetingTone, 'neutral'>, number> = { success: 0, warning: 1, danger: 2 };

const pct = (value: number) => `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const points = (value: number) => `${Math.abs(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p.`;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const finite = (value?: number | null): value is number => typeof value === 'number' && Number.isFinite(value);
/** Atrasos longos ficam legíveis na reunião: "cerca de 6 anos" no lugar de "2300 dias". */
export function durationLabel(days: number) {
  if (days >= 365) { const years = Math.round(days / 365); return `cerca de ${plural(years, 'ano', 'anos')}`; }
  if (days >= 60) return `cerca de ${Math.round(days / 30)} meses`;
  return plural(days, 'dia', 'dias');
}

export function dateGapDays(projected: string | null, expected: string | null) {
  if (!projected || !expected) return null;
  const projectedMs = new Date(projected).getTime();
  const expectedMs = new Date(expected).getTime();
  return Number.isFinite(projectedMs) && Number.isFinite(expectedMs)
    ? Math.round((projectedMs - expectedMs) / 86400000) : null;
}

export interface MeetingCost {
  status: MeetingStatus;
  presentation: boolean;
  actual: number;
  planned: number | null;
  spentPct: number | null;
  progressPct: number | null;
  /** Gasto ÷ avanço: estimativa linear do custo final. */
  projection: { amount: number; factor: number; showInCard: boolean } | null;
}

export function meetingCost(data: ProjectDetail): MeetingCost {
  const presentation = Boolean(data.presentation);
  const actual = data.consumo.gasto + (data.maoDeObra.custo ?? 0);
  const planned = finite(data.consumo.previsto) ? data.consumo.previsto : null;
  const spentPct = planned != null && planned > 0 ? actual / planned * 100 : null;
  // O custo é do projeto (ou da divisão) inteiro, então compara com o avanço total, não com o filtro.
  const progressPct = finite(data.avancoPct) ? data.avancoPct : null;
  const projection = !presentation && spentPct != null && progressPct != null && progressPct > 0 && progressPct < 100
    ? { amount: actual / (progressPct / 100), factor: spentPct / progressPct, showInCard: progressPct >= COST_PROJECTION_CARD_MIN_PROGRESS }
    : null;
  let status: MeetingStatus;
  if (presentation) status = { tone: 'neutral', label: 'Custo realizado' };
  else if (spentPct == null) status = { tone: 'neutral', label: 'Sem orçamento' };
  else if (spentPct > 100) status = { tone: 'danger', label: 'Acima do previsto' };
  else if (progressPct != null && spentPct - progressPct > COST_AHEAD_TOLERANCE) status = { tone: 'warning', label: 'À frente do avanço' };
  else status = { tone: 'success', label: progressPct != null ? 'Proporcional ao avanço' : 'Dentro do previsto' };
  return { status, presentation, actual, planned, spentPct, progressPct, projection };
}

export interface MeetingScope { status: MeetingStatus; progressPct: number | null; timePct: number | null; gap: number | null }

export function meetingScope(data: ProjectDetail, progressPct: number | null): MeetingScope {
  const progress = finite(progressPct) ? progressPct : null;
  const timePct = finite(data.diasCorridos.pct) ? data.diasCorridos.pct : null;
  const gap = progress != null && timePct != null ? progress - timePct : null;
  let status: MeetingStatus;
  if (progress == null) status = { tone: 'neutral', label: 'Aguardando medição' };
  else if (progress >= 100) status = { tone: 'success', label: 'Escopo concluído' };
  else if (gap == null) status = { tone: 'neutral', label: 'Sem prazo para comparar' };
  else if (gap >= -SCOPE_ON_PACE_TOLERANCE) status = { tone: 'success', label: 'No ritmo' };
  else if (gap >= -SCOPE_LATE_TOLERANCE) status = { tone: 'warning', label: 'Pouco atrás' };
  else status = { tone: 'danger', label: 'Atrás do prazo' };
  return { status, progressPct: progress, timePct, gap };
}

export interface MeetingReports { status: MeetingStatus; signed: number | null; total: number | null; pending: number | null; lastRdoDate: string | null }

export function meetingReports(data: ProjectDetail): MeetingReports {
  const signed = data.rdoSignatures?.signed ?? null;
  const total = data.rdoSignatures?.total ?? null;
  const pending = signed != null && total != null ? Math.max(0, total - signed) : null;
  let status: MeetingStatus;
  if (pending == null || !total) status = { tone: 'neutral', label: 'Sem RDOs' };
  else if (pending === 0) status = { tone: 'success', label: 'Todos assinados' };
  else status = { tone: pending / total > RDO_PENDING_DANGER_RATIO ? 'danger' : 'warning', label: plural(pending, 'pendente', 'pendentes') };
  return { status, signed, total, pending, lastRdoDate: data.header.lastRdoDate };
}

export interface MeetingTime {
  status: MeetingStatus;
  rental: boolean;
  elapsed: number | null;
  planned: number | null;
  pct: number | null;
  remaining: number | null;
  expectedEnd: string | null;
  projectedEnd: string | null;
  /** Dias entre a projeção pelo ritmo e o término previsto (positivo = atraso). */
  gap: number | null;
}

export function meetingTime(data: ProjectDetail): MeetingTime {
  if (data.rentalTracking) {
    const { elapsedDays: elapsed, plannedDays: planned, remainingDays: remaining, endDate } = data.rentalTracking;
    const status: MeetingStatus = remaining == null ? { tone: 'neutral', label: 'Sem período' }
      : remaining < 0 ? { tone: 'danger', label: 'Locação vencida' }
        : remaining <= 3 ? { tone: 'warning', label: remaining === 0 ? 'Termina hoje' : `Termina em ${plural(remaining, 'dia', 'dias')}` }
          : { tone: 'success', label: 'No período' };
    return { status, rental: true, elapsed, planned, pct: elapsed != null && planned ? elapsed / planned * 100 : null,
      remaining, expectedEnd: endDate, projectedEnd: null, gap: null };
  }
  const { elapsed, planned } = data.diasCorridos;
  const pctValue = finite(data.diasCorridos.pct) ? data.diasCorridos.pct : null;
  const gap = dateGapDays(data.footer.projectedEndByPace, data.footer.expectedEndDate);
  const done = finite(data.avancoPct) && data.avancoPct >= 100;
  let status: MeetingStatus;
  if (done) status = { tone: 'success', label: 'Escopo concluído' };
  else if (gap != null && gap > TIME_LATE_TOLERANCE_DAYS) status = { tone: 'danger', label: 'Projeção após o término' };
  else if (gap != null && gap > 0) status = { tone: 'warning', label: `${plural(gap, 'dia', 'dias')} após` };
  else if (pctValue != null && pctValue > 100) status = { tone: 'danger', label: 'Prazo estourado' };
  else if (gap != null) status = { tone: 'success', label: gap < 0 ? 'Antes do previsto' : 'Na data' };
  else status = { tone: 'neutral', label: 'Sem projeção' };
  return { status, rental: false, elapsed, planned, pct: pctValue,
    remaining: elapsed != null && planned != null ? planned - elapsed : null,
    expectedEnd: data.footer.expectedEndDate, projectedEnd: data.footer.projectedEndByPace, gap };
}

export interface MeetingHealth {
  status: MeetingStatus;
  score: number | null;
  /** Indicadores que somaram pontos, do maior para o menor peso na nota. */
  contributors: Array<{ key: MeetingKpiKey; points: number }>;
}

export function meetingHealth(statuses: Partial<Record<MeetingKpiKey, MeetingStatus>>): MeetingHealth {
  let weighted = 0;
  let weights = 0;
  const contributors: MeetingHealth['contributors'] = [];
  for (const key of Object.keys(MEETING_HEALTH_WEIGHTS) as MeetingKpiKey[]) {
    const tone = statuses[key]?.tone;
    if (!tone || tone === 'neutral') continue;
    const weight = MEETING_HEALTH_WEIGHTS[key];
    weighted += weight * TONE_POINTS[tone];
    weights += weight;
    if (TONE_POINTS[tone] > 0) contributors.push({ key, points: weight * TONE_POINTS[tone] });
  }
  if (!weights) return { status: { tone: 'neutral', label: 'Sem dados suficientes' }, score: null, contributors };
  // Sem algum indicador (locação, apresentação), os pesos restantes são redistribuídos.
  const score = Math.round(weighted / weights * 100) / 100;
  const status: MeetingStatus = score < 0.5 ? { tone: 'success', label: 'Em dia' }
    : score < 1.2 ? { tone: 'warning', label: 'Atenção' } : { tone: 'danger', label: 'Em risco' };
  return { status, score, contributors: contributors.sort((a, b) => b.points - a.points) };
}

export interface MeetingAttention { tone: 'warning' | 'danger'; label: string; kpi: MeetingKpiKey | null }

export interface ProjectMeeting {
  cost: MeetingCost;
  scope: MeetingScope | null;
  reports: MeetingReports;
  time: MeetingTime;
  health: MeetingHealth;
  readout: string[];
  attention: MeetingAttention[];
}

const ALERT_KPI: Record<string, MeetingKpiKey> = { PRAZO: 'time', PARADO: 'rdo', STANDBY: 'time' };

export function projectMeeting(data: ProjectDetail, scopeProgressPct: number | null): ProjectMeeting {
  const cost = meetingCost(data);
  const scope = data.rentalTracking ? null : meetingScope(data, scopeProgressPct);
  const reports = meetingReports(data);
  const time = meetingTime(data);
  const health = meetingHealth({ cost: cost.status, scope: scope?.status, rdo: reports.status, time: time.status });

  const readout: string[] = [];
  if (scope?.progressPct != null && scope.timePct != null && scope.gap != null && scope.progressPct < 100) {
    readout.push(Math.abs(scope.gap) <= SCOPE_ON_PACE_TOLERANCE
      ? `O avanço (${pct(scope.progressPct)}) acompanha o prazo decorrido (${pct(scope.timePct)}).`
      : `O avanço (${pct(scope.progressPct)}) está ${points(scope.gap)} ${scope.gap > 0 ? 'à frente' : 'atrás'} do prazo decorrido (${pct(scope.timePct)}).`);
  }
  if (cost.spentPct != null) {
    const delivered = cost.progressPct != null ? ` com ${pct(cost.progressPct)} do escopo entregue` : '';
    readout.push(cost.spentPct > 100
      ? `O gasto já passou do previsto (${pct(cost.spentPct)})${delivered}.`
      : `O gasto está em ${pct(cost.spentPct)} do previsto${delivered}.`);
    if (cost.projection?.showInCard) readout[readout.length - 1] += ` No ritmo atual, fecha em cerca de ${brl(cost.projection.amount)}.`;
  }
  if (time.gap != null && !time.rental && readout.length < 3) {
    readout.push(time.gap === 0 ? 'A projeção pelo ritmo termina na data prevista.'
      : `A projeção pelo ritmo termina ${durationLabel(Math.abs(time.gap))} ${time.gap > 0 ? 'depois' : 'antes'} do previsto.`);
  }
  if (reports.pending && reports.total && readout.length < 3) {
    readout.push(`${reports.pending} de ${reports.total} RDOs aguardam assinatura.`);
  }

  const attention: MeetingAttention[] = [];
  const flag = (status: MeetingStatus, label: string, kpi: MeetingKpiKey) => {
    if (status.tone === 'warning' || status.tone === 'danger') attention.push({ tone: status.tone, label, kpi });
  };
  if (scope?.gap != null) flag(scope.status, `Avanço ${points(scope.gap)} atrás do prazo`, 'scope');
  if (cost.spentPct != null && cost.planned != null) {
    flag(cost.status, cost.spentPct > 100 ? `Custo ${brl(cost.actual - cost.planned)} acima do previsto`
      : `Gasto à frente do avanço (${pct(cost.spentPct)} × ${pct(cost.progressPct ?? 0)})`, 'cost');
  }
  if (reports.pending) flag(reports.status, `${plural(reports.pending, 'RDO aguardando', 'RDOs aguardando')} assinatura`, 'rdo');
  if (time.rental) flag(time.status, time.status.label, 'time');
  else if (time.gap != null && time.gap > 0) flag(time.status, `Projeção de término ${durationLabel(time.gap)} após o previsto`, 'time');
  else if (time.status.label === 'Prazo estourado') flag(time.status, 'Prazo estourado', 'time');
  // Alertas do backend complementam os indicadores; custo já está no card Gastos.
  for (const alert of data.alerts) {
    if (alert.code === 'CUSTO' || attention.some(item => item.label === alert.label)) continue;
    attention.push({ tone: alert.level === 'danger' ? 'danger' : 'warning', label: alert.label, kpi: ALERT_KPI[alert.code] ?? null });
  }
  attention.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'danger' ? -1 : 1));

  return { cost, scope, reports, time, health, readout, attention };
}
