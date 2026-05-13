import { useEffect, useMemo, useState } from 'react';

const assetsBaseUrl = (import.meta.env.VITE_ASSETS_BASE_URL || '').replace(/\/$/, '');
const headerLogoUrl = `${assetsBaseUrl}/assets/Logo/LOGO_HEADER.png`;

import type {
  SurveyDashboardMonth,
  SurveyDashboardNpsDistribution,
  SurveyDashboardQuestionAvg,
  SurveyDashboardSurveyItem,
} from '../../api/surveys';
import { useSurveyDashboard, useSurveyMutations } from '../../hooks/useSurveys';

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];
const MONTH_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const QUARTER_LABELS = ['1º Tri', '2º Tri', '3º Tri', '4º Tri'];
const NPS_BENCHMARK_MIN = 20;
const NPS_BENCHMARK_MAX = 45;

// ─── Period filter type ────────────────────────────────────────────────────────

type PeriodFilter =
  | { type: 'year' }
  | { type: 'month'; value: number }
  | { type: 'quarter'; value: number };

function quarterMonths(q: number) {
  return [(q - 1) * 3 + 1, (q - 1) * 3 + 2, q * 3];
}

function getFilteredMonths(months: SurveyDashboardMonth[], period: PeriodFilter) {
  if (period.type === 'year') return months;
  if (period.type === 'month') return months.filter(m => m.month === period.value);
  const qm = quarterMonths(period.value);
  return months.filter(m => qm.includes(m.month));
}

function getPreviousMonths(months: SurveyDashboardMonth[], period: PeriodFilter) {
  if (period.type === 'month') return months.filter(m => m.month === period.value - 1);
  if (period.type !== 'quarter') return [];
  const previousQuarter = period.value - 1;
  return previousQuarter > 0 ? months.filter(m => quarterMonths(previousQuarter).includes(m.month)) : [];
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

interface Aggregated {
  sent: number;
  responded: number;
  expired: number;
  surveys: SurveyDashboardSurveyItem[];
  questionAverages: SurveyDashboardQuestionAvg[];
  nps: SurveyDashboardNpsDistribution;
}

function aggregateMonths(months: SurveyDashboardMonth[]): Aggregated {
  const sent = months.reduce((a, m) => a + m.sent, 0);
  const responded = months.reduce((a, m) => a + m.responded, 0);
  const surveys = months.flatMap(m => m.surveys);
  const now = Date.now();
  const expired = surveys.filter(s => !s.respondedAt && new Date(s.expiresAt).getTime() <= now).length;

  const npsTotal = months.reduce((a, m) => a + m.npsDistribution.total, 0);
  const npsPromoters = months.reduce((a, m) => a + m.npsDistribution.promoters, 0);
  const npsDetractors = months.reduce((a, m) => a + m.npsDistribution.detractors, 0);
  const npsCounts: Record<string, number> = {};
  for (let i = 0; i <= 10; i++) npsCounts[String(i)] = 0;
  for (const m of months) {
    for (const [k, v] of Object.entries(m.npsDistribution.counts)) {
      npsCounts[k] = (npsCounts[k] ?? 0) + (v as number);
    }
  }

  const qSums: Record<string, { sum: number; count: number; label: string; order: number; type: string }> = {};
  for (const m of months) {
    for (const qa of m.questionAverages) {
      if (!qSums[qa.id]) qSums[qa.id] = { sum: 0, count: 0, label: qa.label, order: qa.order, type: qa.type };
      qSums[qa.id].sum += qa.avg * qa.count;
      qSums[qa.id].count += qa.count;
    }
  }
  const questionAverages: SurveyDashboardQuestionAvg[] = Object.entries(qSums)
    .map(([id, { sum, count, label, order, type }]) => ({
      id, label, order, type, avg: count > 0 ? Math.round((sum / count) * 100) / 100 : 0, count,
    }))
    .sort((a, b) => a.order - b.order);

  return {
    sent, responded, expired, surveys, questionAverages,
    nps: {
      promoters: npsPromoters,
      neutrals: npsTotal - npsPromoters - npsDetractors,
      detractors: npsDetractors,
      total: npsTotal,
      score: npsTotal > 0 ? Math.round(((npsPromoters - npsDetractors) / npsTotal) * 100) : null,
      counts: npsCounts,
    },
  };
}

// ─── NPS helpers ──────────────────────────────────────────────────────────────

function npsZone(score: number): { label: string; color: string } {
  if (score >= 75) return { label: 'Excelente', color: 'var(--g)' };
  if (score >= 50) return { label: 'Muito bom', color: 'var(--gl)' };
  if (score >= 30) return { label: 'Bom', color: 'var(--bl)' };
  if (score >= 0)  return { label: 'Razoável', color: '#d97706' };
  if (score >= -25) return { label: 'Ruim', color: '#e05c00' };
  return { label: 'Crítico', color: 'var(--rd)' };
}

function pct(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function qaProgressPct(qa: SurveyDashboardQuestionAvg) {
  if (qa.type === 'NPS') return (qa.avg / 10) * 100;
  if (qa.type === 'SCALE') return ((qa.avg - 1) / 4) * 100;
  return 0;
}

function qaMaxLabel(qa: SurveyDashboardQuestionAvg) {
  if (qa.type === 'NPS') return '/ 10';
  if (qa.type === 'SCALE') return '/ 5';
  return '';
}

function csvCell(value: unknown) {
  const text = value === undefined || value === null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map(row => row.map(csvCell).join(';')).join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PeriodFilter({
  year, years, period, months,
  onYearChange, onPeriodChange,
}: {
  year: number;
  years: number[];
  period: PeriodFilter;
  months: SurveyDashboardMonth[];
  onYearChange: (y: number) => void;
  onPeriodChange: (p: PeriodFilter) => void;
}) {
  const hasDataMonth = (m: number) => (months.find(mo => mo.month === m)?.sent ?? 0) > 0;
  const hasDataQuarter = (q: number) => quarterMonths(q).some(m => hasDataMonth(m));

  function toggleMonth(m: number) {
    if (period.type === 'month' && period.value === m) onPeriodChange({ type: 'year' });
    else onPeriodChange({ type: 'month', value: m });
  }

  function toggleQuarter(q: number) {
    if (period.type === 'quarter' && period.value === q) onPeriodChange({ type: 'year' });
    else onPeriodChange({ type: 'quarter', value: q });
  }

  return (
    <div className="survey-dash-filter-wrap">
      <div className="survey-dash-filter-top">
        <select
          className="survey-dash-year-select"
          value={year}
          onChange={e => onYearChange(Number(e.target.value))}
          aria-label="Ano"
        >
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <button
          className={`survey-dash-period-btn${period.type === 'year' ? ' active' : ''}`}
          type="button"
          onClick={() => onPeriodChange({ type: 'year' })}
        >
          Ano todo
        </button>
      </div>
      <div className="survey-dash-period-grid">
        {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
          <button
            key={m}
            className={`survey-dash-period-btn survey-dash-period-month${period.type === 'month' && period.value === m ? ' active' : ''}${hasDataMonth(m) ? ' has-data' : ''}`}
            type="button"
            onClick={() => toggleMonth(m)}
            title={MONTH_NAMES[m - 1]}
          >
            {MONTH_SHORT[m - 1]}
          </button>
        ))}
        {[1, 2, 3, 4].map(q => (
          <button
            key={q}
            className={`survey-dash-period-btn survey-dash-period-quarter${period.type === 'quarter' && period.value === q ? ' active' : ''}${hasDataQuarter(q) ? ' has-data' : ''}`}
            type="button"
            onClick={() => toggleQuarter(q)}
          >
            {QUARTER_LABELS[q - 1]}
          </button>
        ))}
      </div>
    </div>
  );
}

function NpsScorePanel({ nps }: { nps: SurveyDashboardNpsDistribution }) {
  if (nps.total === 0) return null;
  const score = nps.score ?? 0;
  const zone = npsZone(score);
  const pPct = pct(nps.promoters, nps.total);
  const nPct = pct(nps.neutrals, nps.total);
  const dPct = 100 - pPct - nPct;

  return (
    <div className="survey-dash-card survey-dash-nps-card">
      <div className="survey-dash-nps-top">
        <div className="survey-dash-nps-score-wrap">
          <span className="survey-dash-nps-score" style={{ color: zone.color }}>
            {score > 0 ? `+${score}` : score}
          </span>
          <span className="survey-dash-nps-zone" style={{ color: zone.color }}>{zone.label}</span>
          <span className="survey-dash-nps-total">{nps.total} resposta{nps.total !== 1 ? 's' : ''}</span>
        </div>
        <div className="survey-dash-nps-segs">
          <div className="survey-dash-nps-seg survey-dash-nps-promoter">
            <span className="survey-dash-nps-seg-count">{nps.promoters}</span>
            <span className="survey-dash-nps-seg-label">Promotores</span>
            <span className="survey-dash-nps-seg-pct">{pPct}%</span>
            <span className="survey-dash-nps-seg-note">notas 9–10</span>
          </div>
          <div className="survey-dash-nps-seg survey-dash-nps-neutral">
            <span className="survey-dash-nps-seg-count">{nps.neutrals}</span>
            <span className="survey-dash-nps-seg-label">Neutros</span>
            <span className="survey-dash-nps-seg-pct">{nPct}%</span>
            <span className="survey-dash-nps-seg-note">notas 7–8</span>
          </div>
          <div className="survey-dash-nps-seg survey-dash-nps-detractor">
            <span className="survey-dash-nps-seg-count">{nps.detractors}</span>
            <span className="survey-dash-nps-seg-label">Detratores</span>
            <span className="survey-dash-nps-seg-pct">{dPct}%</span>
            <span className="survey-dash-nps-seg-note">notas 0–6</span>
          </div>
        </div>
      </div>
      <div className="survey-dash-seg-bar" title={`Detratores ${dPct}% · Neutros ${nPct}% · Promotores ${pPct}%`}>
        {dPct > 0 && <div className="survey-dash-seg-detractor" style={{ width: `${dPct}%` }} />}
        {nPct > 0 && <div className="survey-dash-seg-neutral" style={{ width: `${nPct}%` }} />}
        {pPct > 0 && <div className="survey-dash-seg-promoter" style={{ width: `${pPct}%` }} />}
      </div>
      <div className="survey-dash-benchmark">
        Referência de serviços industriais: NPS {NPS_BENCHMARK_MIN} a {NPS_BENCHMARK_MAX}.
      </div>
    </div>
  );
}

function DropAlertPanel({ current, previous }: { current: number | null; previous: number | null }) {
  if (current === null || previous === null) return null;
  const delta = current - previous;
  if (delta > -15) return null;
  return (
    <div className="survey-dash-alert">
      <strong>Alerta de queda:</strong> NPS caiu {Math.abs(delta)} pontos em relação ao período anterior ({previous} → {current}).
    </div>
  );
}

function NpsDistributionChart({ counts }: { counts: Record<string, number> }) {
  const maxCount = Math.max(...Object.values(counts).map(Number), 1);
  const total = Object.values(counts).reduce((a, v) => a + (v as number), 0);
  if (total === 0) return null;

  return (
    <div className="survey-dash-card">
      <div className="survey-dash-card-title">Distribuição das notas NPS</div>
      <div className="survey-dash-dist">
        {Array.from({ length: 11 }, (_, i) => 10 - i).map(score => {
          const count = (counts[String(score)] as number) || 0;
          const barPct = Math.round((count / maxCount) * 100);
          const cls = score >= 9 ? 'promoter' : score >= 7 ? 'neutral' : 'detractor';
          return (
            <div className="survey-dash-dist-row" key={score}>
              <span className={`survey-dash-dist-score survey-dash-dist-${cls}`}>{score}</span>
              <div className="survey-dash-dist-track">
                <div className={`survey-dash-dist-bar survey-dash-dist-${cls}`} style={{ width: `${barPct}%` }} />
              </div>
              <span className="survey-dash-dist-count">{count > 0 ? count : ''}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const TREND_HALF = 54;

function NpsTrendChart({ months }: { months: SurveyDashboardMonth[] }) {
  const withData = months.filter(m => m.npsDistribution.total > 0);
  if (withData.length < 2) return null;

  return (
    <div className="survey-dash-card">
      <div className="survey-dash-card-title">Evolução NPS por período</div>
      <div className="survey-dash-trend">
        {months.map(m => {
          const score = m.npsDistribution.score;
          const hasData = score !== null;
          const barH = hasData ? Math.max(Math.round((Math.abs(score) / 100) * TREND_HALF), 3) : 0;
          const isPos = hasData && score >= 0;
          const color = hasData ? npsZone(score).color : 'transparent';
          return (
            <div className="survey-dash-trend-col" key={m.month}>
              <div className="survey-dash-trend-upper">
                {isPos && <div className="survey-dash-trend-bar" style={{ height: barH, background: color }} />}
              </div>
              <div className="survey-dash-trend-baseline" />
              <div className="survey-dash-trend-lower">
                {!isPos && hasData && <div className="survey-dash-trend-bar" style={{ height: barH, background: color }} />}
              </div>
              {hasData && (
                <div className="survey-dash-trend-val" style={{ color }}>
                  {score > 0 ? `+${score}` : score}
                </div>
              )}
              <div className="survey-dash-trend-lbl">{MONTH_SHORT[m.month - 1]}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function QuestionAveragesPanel({ questionAverages }: { questionAverages: SurveyDashboardQuestionAvg[] }) {
  const scorable = questionAverages.filter(qa => qa.type === 'NPS' || qa.type === 'SCALE');
  if (!scorable.length) return null;

  return (
    <div className="survey-dash-card">
      <div className="survey-dash-card-title">Médias por pergunta</div>
      <div className="survey-dash-qa">
        {scorable.map(qa => {
          const fillPct = Math.min(Math.round(qaProgressPct(qa)), 100);
          return (
            <div className="survey-dash-qa-row" key={qa.id}>
              <span className="survey-dash-qa-label">{qa.label}</span>
              <div className="survey-dash-qa-track">
                <div className="survey-dash-qa-fill" style={{ width: `${fillPct}%` }} />
              </div>
              <span className="survey-dash-qa-val">
                <strong>{qa.avg.toFixed(1)}</strong> <span className="survey-dash-qa-max">{qaMaxLabel(qa)}</span>
              </span>
              <span className="survey-dash-qa-count">({qa.count})</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OperatorNpsPanel({ surveys }: { surveys: SurveyDashboardSurveyItem[] }) {
  const rows = Object.values(surveys.reduce<Record<string, { name: string; values: number[] }>>((acc, survey) => {
    if (survey.npsScore === null) return acc;
    const name = survey.operatorName || 'Sem responsável';
    if (!acc[name]) acc[name] = { name, values: [] };
    acc[name].values.push(survey.npsScore);
    return acc;
  }, {}))
    .map(row => {
      const promoters = row.values.filter(value => value >= 9).length;
      const detractors = row.values.filter(value => value <= 6).length;
      return {
        name: row.name,
        total: row.values.length,
        score: Math.round(((promoters - detractors) / row.values.length) * 100)
      };
    })
    .sort((a, b) => b.total - a.total || b.score - a.score);

  if (!rows.length) return null;

  return (
    <div className="survey-dash-card">
      <div className="survey-dash-card-title">NPS por responsável</div>
      <div className="survey-dash-compact-list">
        {rows.map(row => (
          <div className="survey-dash-compact-row" key={row.name}>
            <span>{row.name}</span>
            <strong style={{ color: npsZone(row.score).color }}>{row.score > 0 ? `+${row.score}` : row.score}</strong>
            <small>{row.total} resposta{row.total !== 1 ? 's' : ''}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function DriverCorrelationPanel({ surveys }: { surveys: SurveyDashboardSurveyItem[] }) {
  const rows = Object.values(surveys.reduce<Record<string, {
    id: string;
    label: string;
    promoters: number[];
    detractors: number[];
  }>>((acc, survey) => {
    if (survey.npsScore === null) return acc;
    const group = survey.npsScore >= 9 ? 'promoters' : survey.npsScore <= 6 ? 'detractors' : null;
    if (!group) return acc;
    for (const answer of survey.questionAnswers || []) {
      if (answer.type !== 'SCALE' || typeof answer.value !== 'number') continue;
      if (!acc[answer.id]) acc[answer.id] = { id: answer.id, label: answer.label, promoters: [], detractors: [] };
      acc[answer.id][group].push(answer.value);
    }
    return acc;
  }, {}))
    .map(row => {
      const promoterAvg = row.promoters.length ? row.promoters.reduce((a, b) => a + b, 0) / row.promoters.length : null;
      const detractorAvg = row.detractors.length ? row.detractors.reduce((a, b) => a + b, 0) / row.detractors.length : null;
      return {
        ...row,
        promoterAvg,
        detractorAvg,
        gap: promoterAvg !== null && detractorAvg !== null ? promoterAvg - detractorAvg : null
      };
    })
    .filter(row => row.gap !== null)
    .sort((a, b) => (b.gap || 0) - (a.gap || 0));

  if (!rows.length) return null;

  return (
    <div className="survey-dash-card">
      <div className="survey-dash-card-title">Drivers de satisfação</div>
      <div className="survey-dash-compact-list">
        {rows.map(row => (
          <div className="survey-dash-driver-row" key={row.id}>
            <span>{row.label}</span>
            <small>Promotores {row.promoterAvg?.toFixed(1)} · Detratores {row.detractorAvg?.toFixed(1)}</small>
            <strong>gap {row.gap?.toFixed(1)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function ClientTimelinePanel({ surveys }: { surveys: SurveyDashboardSurveyItem[] }) {
  const groups = Object.values(surveys.reduce<Record<string, SurveyDashboardSurveyItem[]>>((acc, survey) => {
    if (survey.npsScore === null) return acc;
    const key = survey.clientName || 'Cliente não informado';
    acc[key] = [...(acc[key] || []), survey];
    return acc;
  }, {}))
    .filter(group => group.length > 1)
    .map(group => group.sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime()))
    .sort((a, b) => b.length - a.length)
    .slice(0, 6);

  if (!groups.length) return null;

  return (
    <div className="survey-dash-card">
      <div className="survey-dash-card-title">Evolução por cliente</div>
      <div className="survey-dash-client-lines">
        {groups.map(group => (
          <div className="survey-dash-client-line" key={group[0].clientName || group[0].id}>
            <span>{group[0].clientName || 'Cliente não informado'}</span>
            <div>
              {group.map(item => (
                <strong key={item.id} style={{ color: npsZone(item.npsScore || 0).color }}>
                  {item.npsScore}
                </strong>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FollowUpPanel({ surveys }: { surveys: SurveyDashboardSurveyItem[] }) {
  const mutations = useSurveyMutations();
  const detractors = surveys.filter(survey => survey.npsScore !== null && survey.npsScore <= 6);
  if (!detractors.length) return null;

  return (
    <div className="survey-dash-card">
      <div className="survey-dash-card-title">Closed-loop com detratores</div>
      <div className="survey-dash-follow-list">
        {detractors.map(survey => {
          const title = [survey.projectCode, survey.projectName].filter(Boolean).join(' - ') || survey.clientName || 'Projeto';
          return (
            <div className="survey-dash-follow-row" key={survey.id}>
              <div>
                <strong>{title}</strong>
                <span>{survey.clientName || 'Cliente não informado'} · NPS {survey.npsScore}</span>
              </div>
              <select
                value={survey.followUpStatus || 'OPEN'}
                onChange={event => mutations.updateFollowUp.mutate({
                  surveyId: survey.id,
                  payload: { status: event.target.value as SurveyDashboardSurveyItem['followUpStatus'], notes: survey.followUpNotes || '' }
                })}
              >
                <option value="OPEN">Aberto</option>
                <option value="CONTACTED">Cliente contatado</option>
                <option value="RESOLVED">Resolvido</option>
                <option value="NOT_APPLICABLE">Não aplicável</option>
              </select>
              <input
                defaultValue={survey.followUpNotes || ''}
                placeholder="Resultado do contato"
                onBlur={event => mutations.updateFollowUp.mutate({
                  surveyId: survey.id,
                  payload: { status: survey.followUpStatus || 'OPEN', notes: event.target.value }
                })}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function surveyItemStatus(s: SurveyDashboardSurveyItem) {
  if (s.respondedAt) return { label: 'Respondida', cls: 'survey-dash-proj-ok' };
  if (new Date(s.expiresAt) <= new Date()) return { label: 'Expirada', cls: 'survey-dash-proj-expired' };
  return { label: 'Pendente', cls: 'survey-dash-proj-pending' };
}

function ProjectListSection({ surveys }: { surveys: SurveyDashboardSurveyItem[] }) {
  const [open, setOpen] = useState(false);
  if (!surveys.length) return null;

  return (
    <div className="survey-dash-card survey-dash-projects-card">
      <button className="survey-dash-projects-toggle" type="button" onClick={() => setOpen(v => !v)}>
        <span>{open ? '▾' : '▸'}</span>
        <span>{surveys.length} projeto{surveys.length !== 1 ? 's' : ''} neste período</span>
      </button>
      {open && (
        <div className="survey-dash-project-list">
          {surveys.map(s => {
            const status = surveyItemStatus(s);
            const name = [s.projectCode, s.projectName].filter(Boolean).join(' - ') || s.clientName || '—';
            return (
              <div className="survey-dash-proj-row" key={s.id}>
                <span className="survey-dash-proj-name">{name}</span>
                <span className={`survey-dash-proj-status ${status.cls}`}>{status.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SurveyDashboard() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [period, setPeriod] = useState<PeriodFilter>({ type: 'year' });
  const { data, isLoading } = useSurveyDashboard(year);

  function handleYearChange(y: number) {
    setYear(y);
    setPeriod({ type: 'year' });
  }

  const filteredMonths = useMemo(
    () => (data ? getFilteredMonths(data.months, period) : []),
    [data, period],
  );

  const previousMonths = useMemo(
    () => (data ? getPreviousMonths(data.months, period) : []),
    [data, period],
  );

  const agg = useMemo(() => aggregateMonths(filteredMonths), [filteredMonths]);
  const previousAgg = useMemo(() => aggregateMonths(previousMonths), [previousMonths]);

  const responseRate = agg.sent > 0 ? Math.round((agg.responded / agg.sent) * 100) : null;

  const periodLabel = period.type === 'year' ? `${year}`
    : period.type === 'month' ? `${MONTH_NAMES[period.value - 1]} ${year}`
    : `${QUARTER_LABELS[period.value - 1]} ${year}`;

  const showTrend = period.type !== 'month';

  function handleExportCsv() {
    const questionLabels = Array.from(new Set(agg.surveys.flatMap(survey => (
      (survey.questionAnswers || []).map(answer => answer.label)
    ))));
    const rows = [
      ['Projeto', 'Cliente', 'Responsável', 'Enviada em', 'Respondida em', 'Status', 'NPS', ...questionLabels]
    ];
    for (const survey of agg.surveys) {
      const answers = Object.fromEntries((survey.questionAnswers || []).map(answer => [answer.label, answer.value]));
      rows.push([
        [survey.projectCode, survey.projectName].filter(Boolean).join(' - '),
        survey.clientName,
        survey.operatorName,
        survey.sentAt,
        survey.respondedAt || '',
        surveyItemStatus(survey).label,
        survey.npsScore === null ? '' : String(survey.npsScore),
        ...questionLabels.map(label => answers[label] === null || answers[label] === undefined ? '' : String(answers[label]))
      ]);
    }
    downloadCsv(`pesquisas_nps_${periodLabel.replace(/\s+/g, '_').toLowerCase()}.csv`, rows);
  }

  return (
    <div className="survey-dashboard">
      <PeriodFilter
        year={year}
        years={data?.years ?? [currentYear]}
        period={period}
        months={data?.months ?? []}
        onYearChange={handleYearChange}
        onPeriodChange={setPeriod}
      />

      {isLoading ? (
        <p className="placeholder-copy">Carregando dados...</p>
      ) : (
        <>
          <div className="survey-dash-period-label">{periodLabel}</div>
          <div className="survey-dash-toolbar">
            <button className="mini-btn alt" type="button" onClick={handleExportCsv} disabled={!agg.surveys.length}>
              Exportar CSV
            </button>
          </div>

          <div className="survey-dash-kpis">
            <div className="stat-card-react">
              <div className="stat-number-react">{agg.sent}</div>
              <div className="stat-label-react">Pesquisas enviadas</div>
            </div>
            <div className="stat-card-react">
              <div className="stat-number-react">{agg.responded}</div>
              <div className="stat-label-react">Respondidas</div>
            </div>
            <div className="stat-card-react">
              <div className="stat-number-react">{agg.expired}</div>
              <div className="stat-label-react">Expiradas</div>
            </div>
            <div className="stat-card-react">
              <div className="stat-number-react">{responseRate !== null ? `${responseRate}%` : '—'}</div>
              <div className="stat-label-react">Taxa de resposta</div>
            </div>
            <div className="stat-card-react">
              <div
                className="stat-number-react"
                style={{ color: agg.nps.score !== null ? npsZone(agg.nps.score).color : undefined }}
              >
                {agg.nps.score !== null ? (agg.nps.score > 0 ? `+${agg.nps.score}` : agg.nps.score) : '—'}
              </div>
              <div className="stat-label-react">Nota NPS</div>
            </div>
          </div>

          <DropAlertPanel current={agg.nps.score} previous={previousAgg.nps.score} />
          <NpsScorePanel nps={agg.nps} />

          <div className="survey-dash-two-col">
            <NpsDistributionChart counts={agg.nps.counts} />
            {showTrend && <NpsTrendChart months={filteredMonths} />}
          </div>

          <QuestionAveragesPanel questionAverages={agg.questionAverages} />
          <div className="survey-dash-two-col">
            <OperatorNpsPanel surveys={agg.surveys} />
            <DriverCorrelationPanel surveys={agg.surveys} />
          </div>
          <ClientTimelinePanel surveys={agg.surveys} />
          <FollowUpPanel surveys={agg.surveys} />
          <ProjectListSection surveys={agg.surveys} />
        </>
      )}
    </div>
  );
}

// ─── Overlay ──────────────────────────────────────────────────────────────────

interface SurveyDashboardOverlayProps {
  onClose: () => void;
}

export function SurveyDashboardOverlay({ onClose }: SurveyDashboardOverlayProps) {
  useEffect(() => {
    const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [onClose]);

  return (
    <div className="survey-dash-overlay" role="dialog" aria-modal="true" aria-label="Dashboard NPS">
      <div className="survey-dash-overlay-topbar">
        <img className="survey-dash-overlay-logo" src={headerLogoUrl} alt="Filtrovali" />
        <span className="survey-dash-overlay-title">Dashboard NPS</span>
        <button className="survey-dash-overlay-back" type="button" onClick={onClose}>← Voltar</button>
      </div>
      <div className="survey-dash-overlay-scroll">
        <div className="survey-dash-overlay-content">
          <SurveyDashboard />
        </div>
      </div>
    </div>
  );
}
