import { useEffect, useMemo, useState, type ReactNode } from 'react';

const assetsBaseUrl = (import.meta.env.VITE_ASSETS_BASE_URL || '').replace(/\/$/, '');
const headerLogoUrl = `${assetsBaseUrl}/assets/Logo/LOGO_HEADER.png`;

import type {
  SurveyDashboardMonth,
  SurveyDashboardNpsDistribution,
  SurveyDashboardQuestionAvg,
  SurveyDashboardSurveyItem,
} from '../../api/surveys';
import { BrandLogo } from '../brand/BrandLogo';
import { AppIcon } from '../icons/AppIcon';
import { useSurveyDashboard, useSurveyMutations } from '../../hooks/useSurveys';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  MetricCard,
  Select,
  Skeleton
} from '../ui/ds';
import { DS_ICONS } from '../ui/ds/icons';
import { Modal } from '../ui/Modal';
import './SurveyDashboard.ds.css';

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];
const MONTH_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const QUARTER_LABELS = ['1º Tri', '2º Tri', '3º Tri', '4º Tri'];
const NPS_BENCHMARK_MIN = 20;
const NPS_BENCHMARK_MAX = 45;

type SurveyDashboardAppearance = 'legacy' | 'design-system';

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

type NpsZoneKey =
  | 'excellent'
  | 'very-good'
  | 'good'
  | 'reasonable'
  | 'bad'
  | 'critical';

function npsZone(score: number): {
  label: string;
  key: NpsZoneKey;
  legacyColor: string;
} {
  if (score >= 75)
    return { label: 'Excelente', key: 'excellent', legacyColor: 'var(--g)' };
  if (score >= 50)
    return { label: 'Muito bom', key: 'very-good', legacyColor: 'var(--gl)' };
  if (score >= 30)
    return { label: 'Bom', key: 'good', legacyColor: 'var(--bl)' };
  if (score >= 0)
    return { label: 'Razoável', key: 'reasonable', legacyColor: '#d97706' };
  if (score >= -25)
    return { label: 'Ruim', key: 'bad', legacyColor: '#e05c00' };
  return { label: 'Crítico', key: 'critical', legacyColor: 'var(--rd)' };
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

function SurveyDashboardSection({
  appearance,
  title,
  description,
  className,
  children
}: {
  appearance: SurveyDashboardAppearance;
  title: string;
  description?: string;
  className?: string;
  children: ReactNode;
}) {
  if (appearance === 'design-system') {
    return (
      <Card
        className={['rdo-nps-dashboard__section', className]
          .filter(Boolean)
          .join(' ')}
        title={
          <div className="rdo-nps-dashboard__section-heading">
            <h2>{title}</h2>
            {description ? <span>{description}</span> : null}
          </div>
        }
        padding="md"
      >
        {children}
      </Card>
    );
  }

  return (
    <div className={['survey-dash-card', className].filter(Boolean).join(' ')}>
      <div className="survey-dash-card-title">{title}</div>
      {children}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PeriodFilter({
  year, years, period, months,
  onYearChange, onPeriodChange, appearance,
}: {
  year: number;
  years: number[];
  period: PeriodFilter;
  months: SurveyDashboardMonth[];
  onYearChange: (y: number) => void;
  onPeriodChange: (p: PeriodFilter) => void;
  appearance: SurveyDashboardAppearance;
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

  if (appearance === 'design-system') {
    const periodValue =
      period.type === 'year' ? 'year' : `${period.type}:${period.value}`;

    return (
      <div className="rdo-nps-dashboard__filter-grid">
        <Field label="Ano" optionalText={null}>
          <Select
            value={year}
            onChange={(event) => onYearChange(Number(event.target.value))}
          >
            {years.map((availableYear) => (
              <option key={availableYear} value={availableYear}>
                {availableYear}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Período" optionalText={null}>
          <Select
            value={periodValue}
            onChange={(event) => {
              const [type, rawValue] = event.target.value.split(':');
              if (type === 'year') {
                onPeriodChange({ type: 'year' });
                return;
              }
              onPeriodChange({
                type: type as 'month' | 'quarter',
                value: Number(rawValue)
              });
            }}
          >
            <option value="year">Ano inteiro</option>
            <optgroup label="Trimestres">
              {[1, 2, 3, 4].map((quarter) => (
                <option key={quarter} value={`quarter:${quarter}`}>
                  {QUARTER_LABELS[quarter - 1]}
                  {hasDataQuarter(quarter) ? '' : ' — sem envios'}
                </option>
              ))}
            </optgroup>
            <optgroup label="Meses">
              {MONTH_NAMES.map((monthName, index) => (
                <option key={monthName} value={`month:${index + 1}`}>
                  {monthName}
                  {hasDataMonth(index + 1) ? '' : ' — sem envios'}
                </option>
              ))}
            </optgroup>
          </Select>
        </Field>
      </div>
    );
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

function NpsScorePanel({
  nps,
  sent,
  responded,
  expired,
  responseRate,
  appearance
}: {
  nps: SurveyDashboardNpsDistribution;
  sent?: number;
  responded?: number;
  expired?: number;
  responseRate?: number | null;
  appearance: SurveyDashboardAppearance;
}) {
  const score = nps.score ?? 0;
  const zone = npsZone(score);
  const pPct = pct(nps.promoters, nps.total);
  const nPct = pct(nps.neutrals, nps.total);
  const dPct = nps.total > 0 ? 100 - pPct - nPct : 0;

  if (appearance === 'design-system') {
    const scoreLabel =
      nps.score === null ? 'Sem dados' : score > 0 ? `+${score}` : String(score);

    return (
      <Card
        className="rdo-nps-dashboard__overview"
        title={
          <div className="rdo-nps-dashboard__section-heading">
            <h2>Visão executiva</h2>
            <span>Resultado do período e qualidade da coleta.</span>
          </div>
        }
        padding="md"
      >
        <div className="rdo-nps-dashboard__overview-grid">
          <article
            className={`rdo-nps-dashboard__score rdo-nps-dashboard__zone--${zone.key}`}
            aria-label={
              nps.score === null
                ? 'NPS sem respostas no período'
                : `NPS ${scoreLabel}, classificação ${zone.label}`
            }
          >
            <span className="rdo-nps-dashboard__score-label">NPS</span>
            <strong>{scoreLabel}</strong>
            <span className="rdo-nps-dashboard__score-zone">
              {nps.score === null ? 'Aguardando respostas' : zone.label}
            </span>
            <small>
              {nps.total} resposta{nps.total !== 1 ? 's' : ''} válida
              {nps.total !== 1 ? 's' : ''}
            </small>
          </article>

          <div className="rdo-nps-dashboard__metrics">
            <MetricCard
              label="Pesquisas enviadas"
              value={sent ?? 0}
              description="No recorte atual"
              icon={<AppIcon icon={DS_ICONS.fileText} size="md" />}
            />
            <MetricCard
              label="Respondidas"
              value={responded ?? 0}
              description="Retornos recebidos"
              tone="success"
              icon={<AppIcon icon={DS_ICONS.alertSuccess} size="md" />}
            />
            <MetricCard
              label="Taxa de resposta"
              value={responseRate === null || responseRate === undefined ? '—' : `${responseRate}%`}
              description="Respondidas sobre enviadas"
              tone="info"
              icon={<AppIcon icon={DS_ICONS.users} size="md" />}
            />
            <MetricCard
              label="Expiradas"
              value={expired ?? 0}
              description="Sem resposta no prazo"
              tone="danger"
              icon={<AppIcon icon={DS_ICONS.alertDanger} size="md" />}
            />
          </div>
        </div>

        <div className="rdo-nps-dashboard__segments" aria-label="Distribuição por perfil NPS">
          {[
            {
              key: 'promoter',
              label: 'Promotores',
              note: 'Notas 9–10',
              count: nps.promoters,
              percentage: pPct
            },
            {
              key: 'neutral',
              label: 'Neutros',
              note: 'Notas 7–8',
              count: nps.neutrals,
              percentage: nPct
            },
            {
              key: 'detractor',
              label: 'Detratores',
              note: 'Notas 0–6',
              count: nps.detractors,
              percentage: dPct
            }
          ].map((segment) => (
            <article
              className={`rdo-nps-dashboard__segment rdo-nps-dashboard__segment--${segment.key}`}
              key={segment.key}
            >
              <span>{segment.label}</span>
              <strong>{segment.count}</strong>
              <small>{segment.percentage}% · {segment.note}</small>
            </article>
          ))}
        </div>

        {nps.total > 0 ? (
          <div
            className="survey-dash-seg-bar"
            aria-hidden="true"
          >
            {dPct > 0 && <div className="survey-dash-seg-detractor" style={{ width: `${dPct}%` }} />}
            {nPct > 0 && <div className="survey-dash-seg-neutral" style={{ width: `${nPct}%` }} />}
            {pPct > 0 && <div className="survey-dash-seg-promoter" style={{ width: `${pPct}%` }} />}
          </div>
        ) : null}

        <p className="rdo-nps-dashboard__benchmark">
          Referência de serviços industriais: NPS {NPS_BENCHMARK_MIN} a {NPS_BENCHMARK_MAX}.
        </p>
      </Card>
    );
  }

  if (nps.total === 0) return null;

  return (
    <div className="survey-dash-card survey-dash-nps-card">
      <div className="survey-dash-nps-top">
        <div className="survey-dash-nps-score-wrap">
          <span className="survey-dash-nps-score" style={{ color: zone.legacyColor }}>
            {score > 0 ? `+${score}` : score}
          </span>
          <span className="survey-dash-nps-zone" style={{ color: zone.legacyColor }}>{zone.label}</span>
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

function DropAlertPanel({
  current,
  previous,
  appearance
}: {
  current: number | null;
  previous: number | null;
  appearance: SurveyDashboardAppearance;
}) {
  if (current === null || previous === null) return null;
  const delta = current - previous;
  if (delta > -15) return null;
  if (appearance === 'design-system') {
    return (
      <Alert tone="danger" title="Queda relevante no NPS">
        O índice caiu {Math.abs(delta)} pontos em relação ao período anterior ({previous} → {current}).
      </Alert>
    );
  }
  return (
    <div className="survey-dash-alert">
      <strong>Alerta de queda:</strong> NPS caiu {Math.abs(delta)} pontos em relação ao período anterior ({previous} → {current}).
    </div>
  );
}

function NpsDistributionChart({
  counts,
  appearance
}: {
  counts: Record<string, number>;
  appearance: SurveyDashboardAppearance;
}) {
  const maxCount = Math.max(...Object.values(counts).map(Number), 1);
  const total = Object.values(counts).reduce((a, v) => a + (v as number), 0);
  if (total === 0) return null;

  return (
    <SurveyDashboardSection
      appearance={appearance}
      title="Distribuição das notas NPS"
      description="Quantidade de respostas por nota e classificação."
    >
      <div className="survey-dash-dist" role="list" aria-label="Notas de zero a dez">
        {Array.from({ length: 11 }, (_, i) => 10 - i).map(score => {
          const count = (counts[String(score)] as number) || 0;
          const barPct = Math.round((count / maxCount) * 100);
          const cls = score >= 9 ? 'promoter' : score >= 7 ? 'neutral' : 'detractor';
          return (
            <div
              className="survey-dash-dist-row"
              key={score}
              role="listitem"
              aria-label={`Nota ${score}: ${count} resposta${count !== 1 ? 's' : ''}`}
            >
              <span className={`survey-dash-dist-score survey-dash-dist-${cls}`}>{score}</span>
              <div className="survey-dash-dist-track" aria-hidden="true">
                <div className={`survey-dash-dist-bar survey-dash-dist-${cls}`} style={{ width: `${barPct}%` }} />
              </div>
              <span className="survey-dash-dist-count">{count > 0 ? count : ''}</span>
            </div>
          );
        })}
      </div>
    </SurveyDashboardSection>
  );
}

const TREND_HALF = 54;

function NpsTrendChart({
  months,
  appearance
}: {
  months: SurveyDashboardMonth[];
  appearance: SurveyDashboardAppearance;
}) {
  const withData = months.filter(m => m.npsDistribution.total > 0);
  if (withData.length < 2) return null;

  return (
    <SurveyDashboardSection
      appearance={appearance}
      title="Evolução NPS por período"
      description="Variação mensal do índice no recorte selecionado."
    >
      <div className="survey-dash-trend" role="list" aria-label="Evolução mensal do NPS">
        {months.map(m => {
          const score = m.npsDistribution.score;
          const hasData = score !== null;
          const barH = hasData ? Math.max(Math.round((Math.abs(score) / 100) * TREND_HALF), 3) : 0;
          const isPos = hasData && score >= 0;
          const zone = hasData ? npsZone(score) : null;
          const legacyColor = zone?.legacyColor ?? 'transparent';
          return (
            <div
              className={`survey-dash-trend-col${zone ? ` rdo-nps-dashboard__zone--${zone.key}` : ''}`}
              key={m.month}
              role="listitem"
              aria-label={`${MONTH_NAMES[m.month - 1]}: ${hasData ? `NPS ${score}` : 'sem respostas'}`}
            >
              <div className="survey-dash-trend-upper">
                {isPos && (
                  <div
                    className="survey-dash-trend-bar"
                    style={{
                      height: barH,
                      background:
                        appearance === 'legacy' ? legacyColor : undefined
                    }}
                  />
                )}
              </div>
              <div className="survey-dash-trend-baseline" />
              <div className="survey-dash-trend-lower">
                {!isPos && hasData && (
                  <div
                    className="survey-dash-trend-bar"
                    style={{
                      height: barH,
                      background:
                        appearance === 'legacy' ? legacyColor : undefined
                    }}
                  />
                )}
              </div>
              {hasData && (
                <div
                  className="survey-dash-trend-val"
                  style={{
                    color: appearance === 'legacy' ? legacyColor : undefined
                  }}
                >
                  {score > 0 ? `+${score}` : score}
                </div>
              )}
              <div className="survey-dash-trend-lbl">{MONTH_SHORT[m.month - 1]}</div>
            </div>
          );
        })}
      </div>
    </SurveyDashboardSection>
  );
}

function QuestionAveragesPanel({
  questionAverages,
  appearance
}: {
  questionAverages: SurveyDashboardQuestionAvg[];
  appearance: SurveyDashboardAppearance;
}) {
  const scorable = questionAverages.filter(qa => qa.type === 'NPS' || qa.type === 'SCALE');
  if (!scorable.length) return null;

  return (
    <SurveyDashboardSection
      appearance={appearance}
      title="Médias por pergunta"
      description="Resultado médio das perguntas avaliativas."
    >
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
    </SurveyDashboardSection>
  );
}

function OperatorNpsPanel({
  surveys,
  appearance
}: {
  surveys: SurveyDashboardSurveyItem[];
  appearance: SurveyDashboardAppearance;
}) {
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
    <SurveyDashboardSection
      appearance={appearance}
      title="NPS por responsável"
      description="Volume de respostas e índice por responsável."
    >
      <div className="survey-dash-compact-list">
        {rows.map(row => (
          <div className="survey-dash-compact-row" key={row.name}>
            <span>{row.name}</span>
            <strong
              className={`rdo-nps-dashboard__zone--${npsZone(row.score).key}`}
              style={{
                color:
                  appearance === 'legacy'
                    ? npsZone(row.score).legacyColor
                    : undefined
              }}
            >
              {row.score > 0 ? `+${row.score}` : row.score}
            </strong>
            <small>{row.total} resposta{row.total !== 1 ? 's' : ''}</small>
          </div>
        ))}
      </div>
    </SurveyDashboardSection>
  );
}

function DriverCorrelationPanel({
  surveys,
  appearance
}: {
  surveys: SurveyDashboardSurveyItem[];
  appearance: SurveyDashboardAppearance;
}) {
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
    <SurveyDashboardSection
      appearance={appearance}
      title="Drivers de satisfação"
      description="Diferença das médias entre promotores e detratores."
    >
      <div className="survey-dash-compact-list">
        {rows.map(row => (
          <div className="survey-dash-driver-row" key={row.id}>
            <span>{row.label}</span>
            <small>Promotores {row.promoterAvg?.toFixed(1)} · Detratores {row.detractorAvg?.toFixed(1)}</small>
            <strong>gap {row.gap?.toFixed(1)}</strong>
          </div>
        ))}
      </div>
    </SurveyDashboardSection>
  );
}

function ClientTimelinePanel({
  surveys,
  appearance
}: {
  surveys: SurveyDashboardSurveyItem[];
  appearance: SurveyDashboardAppearance;
}) {
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
    <SurveyDashboardSection
      appearance={appearance}
      title="Evolução por cliente"
      description="Histórico das notas para clientes com mais de uma resposta."
    >
      <div className="survey-dash-client-lines">
        {groups.map(group => (
          <div className="survey-dash-client-line" key={group[0].clientName || group[0].id}>
            <span>{group[0].clientName || 'Cliente não informado'}</span>
            <div>
              {group.map(item => (
                <strong
                  className={`rdo-nps-dashboard__zone--${npsZone(item.npsScore || 0).key}`}
                  key={item.id}
                  style={{
                    color:
                      appearance === 'legacy'
                        ? npsZone(item.npsScore || 0).legacyColor
                        : undefined
                  }}
                >
                  {item.npsScore}
                </strong>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SurveyDashboardSection>
  );
}

function FollowUpPanel({
  surveys,
  appearance
}: {
  surveys: SurveyDashboardSurveyItem[];
  appearance: SurveyDashboardAppearance;
}) {
  const mutations = useSurveyMutations();
  const detractors = surveys.filter(survey => survey.npsScore !== null && survey.npsScore <= 6);
  if (!detractors.length) return null;

  return (
    <SurveyDashboardSection
      appearance={appearance}
      title={appearance === 'design-system' ? 'Acompanhamento de detratores' : 'Closed-loop com detratores'}
      description={
        appearance === 'design-system'
          ? 'Registre o contato e acompanhe a recuperação de cada cliente.'
          : undefined
      }
      className="rdo-nps-dashboard__follow-up"
    >
      <div className="survey-dash-follow-list">
        {detractors.map(survey => {
          const title = [survey.projectCode, survey.projectName].filter(Boolean).join(' - ') || survey.clientName || 'Projeto';
          return (
            <div className="survey-dash-follow-row" key={survey.id}>
              <div className="survey-dash-follow-row__identity">
                <strong>{title}</strong>
                <span>{survey.clientName || 'Cliente não informado'} · NPS {survey.npsScore}</span>
              </div>
              {appearance === 'design-system' ? (
                <div className="rdo-nps-dashboard__follow-controls">
                  <Field id={`survey-follow-status-${survey.id}`} label="Status" optionalText={null}>
                    <Select
                      id={`survey-follow-status-${survey.id}-control`}
                      size="sm"
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
                    </Select>
                  </Field>
                  <Field id={`survey-follow-notes-${survey.id}`} label="Resultado do contato" optionalText={null}>
                    <Input
                      id={`survey-follow-notes-${survey.id}-control`}
                      size="sm"
                      defaultValue={survey.followUpNotes || ''}
                      placeholder="Adicione uma observação"
                      onBlur={event => mutations.updateFollowUp.mutate({
                        surveyId: survey.id,
                        payload: { status: survey.followUpStatus || 'OPEN', notes: event.target.value }
                      })}
                    />
                  </Field>
                </div>
              ) : (
                <>
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
                    aria-label={`Resultado do contato de ${title}`}
                    defaultValue={survey.followUpNotes || ''}
                    placeholder="Resultado do contato"
                    onBlur={event => mutations.updateFollowUp.mutate({
                      surveyId: survey.id,
                      payload: { status: survey.followUpStatus || 'OPEN', notes: event.target.value }
                    })}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>
    </SurveyDashboardSection>
  );
}

function surveyItemStatus(s: SurveyDashboardSurveyItem) {
  if (s.respondedAt) return { label: 'Respondida', cls: 'survey-dash-proj-ok' };
  if (new Date(s.expiresAt) <= new Date()) return { label: 'Expirada', cls: 'survey-dash-proj-expired' };
  return { label: 'Pendente', cls: 'survey-dash-proj-pending' };
}

function ProjectListSection({
  surveys,
  appearance
}: {
  surveys: SurveyDashboardSurveyItem[];
  appearance: SurveyDashboardAppearance;
}) {
  const [open, setOpen] = useState(false);
  if (!surveys.length) return null;

  if (appearance === 'design-system') {
    return (
      <details className="rdo-nps-dashboard__project-disclosure">
        <summary>
          <span>
            <strong>Projetos e pesquisas do período</strong>
            <small>Consulte o status de cada envio.</small>
          </span>
          <span>{surveys.length} item{surveys.length !== 1 ? 's' : ''}</span>
        </summary>
        <div className="survey-dash-project-list">
          {surveys.map((survey) => {
            const status = surveyItemStatus(survey);
            const name =
              [survey.projectCode, survey.projectName]
                .filter(Boolean)
                .join(' - ') || survey.clientName || '—';
            return (
              <div className="survey-dash-proj-row" key={survey.id}>
                <span className="survey-dash-proj-name">{name}</span>
                <span className={`survey-dash-proj-status ${status.cls}`}>
                  {status.label}
                </span>
              </div>
            );
          })}
        </div>
      </details>
    );
  }

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

export function SurveyDashboard({
  appearance = 'legacy'
}: {
  appearance?: SurveyDashboardAppearance;
} = {}) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [period, setPeriod] = useState<PeriodFilter>({ type: 'year' });
  const { data, isLoading, isError } = useSurveyDashboard(year);
  const isDesignSystem = appearance === 'design-system';

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
    <div
      className={`survey-dashboard${isDesignSystem ? ' rdo-nps-dashboard' : ''}`}
      data-appearance={isDesignSystem ? appearance : undefined}
    >
      {isDesignSystem ? (
        <Card
          className="rdo-nps-dashboard__filters"
          title={
            <div className="rdo-nps-dashboard__section-heading">
              <h2>Filtros da análise</h2>
              <span>Selecione o ano e o período para atualizar todos os indicadores.</span>
            </div>
          }
          actions={
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<AppIcon icon={DS_ICONS.fileText} size="sm" />}
              onClick={handleExportCsv}
              disabled={!agg.surveys.length}
            >
              Exportar CSV
            </Button>
          }
          padding="md"
        >
          <PeriodFilter
            year={year}
            years={data?.years ?? [currentYear]}
            period={period}
            months={data?.months ?? []}
            onYearChange={handleYearChange}
            onPeriodChange={setPeriod}
            appearance={appearance}
          />
          <div className="rdo-nps-dashboard__filter-scope" aria-live="polite">
            <span>Visualização atual</span>
            <strong>{periodLabel}</strong>
            <small>
              {agg.sent} pesquisa{agg.sent !== 1 ? 's' : ''} enviada
              {agg.sent !== 1 ? 's' : ''}
            </small>
          </div>
        </Card>
      ) : (
        <PeriodFilter
          year={year}
          years={data?.years ?? [currentYear]}
          period={period}
          months={data?.months ?? []}
          onYearChange={handleYearChange}
          onPeriodChange={setPeriod}
          appearance={appearance}
        />
      )}

      {isLoading ? (
        isDesignSystem ? (
          <Card className="rdo-nps-dashboard__state" padding="md">
            <div role="status" aria-label="Carregando dados do NPS">
              <Skeleton variant="card" />
              <Skeleton variant="table-rows" lines={4} />
            </div>
          </Card>
        ) : (
          <p className="placeholder-copy">Carregando dados...</p>
        )
      ) : isDesignSystem && isError ? (
        <Alert tone="danger" title="Não foi possível carregar o dashboard NPS.">
          Tente novamente em instantes.
        </Alert>
      ) : (
        <>
          {!isDesignSystem ? (
            <>
              <div className="survey-dash-period-label">{periodLabel}</div>
              <div className="survey-dash-toolbar">
                <button className="mini-btn alt" type="button" onClick={handleExportCsv} disabled={!agg.surveys.length}>
                  Exportar CSV
                </button>
              </div>
            </>
          ) : null}

          {!isDesignSystem ? (
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
                  style={{ color: agg.nps.score !== null ? npsZone(agg.nps.score).legacyColor : undefined }}
                >
                  {agg.nps.score !== null ? (agg.nps.score > 0 ? `+${agg.nps.score}` : agg.nps.score) : '—'}
                </div>
                <div className="stat-label-react">Nota NPS</div>
              </div>
            </div>
          ) : null}

          {!isDesignSystem ? (
            <DropAlertPanel
              current={agg.nps.score}
              previous={previousAgg.nps.score}
              appearance={appearance}
            />
          ) : null}
          <NpsScorePanel
            nps={agg.nps}
            sent={agg.sent}
            responded={agg.responded}
            expired={agg.expired}
            responseRate={responseRate}
            appearance={appearance}
          />
          {isDesignSystem ? (
            <DropAlertPanel
              current={agg.nps.score}
              previous={previousAgg.nps.score}
              appearance={appearance}
            />
          ) : null}

          {isDesignSystem && agg.sent === 0 ? (
            <EmptyState
              title="Nenhuma pesquisa neste período."
              description="Selecione outro período para consultar os resultados do NPS."
            />
          ) : null}

          <div className="survey-dash-two-col rdo-nps-dashboard__analysis-grid">
            <NpsDistributionChart counts={agg.nps.counts} appearance={appearance} />
            {showTrend && <NpsTrendChart months={filteredMonths} appearance={appearance} />}
          </div>

          <QuestionAveragesPanel
            questionAverages={agg.questionAverages}
            appearance={appearance}
          />
          <div className="survey-dash-two-col rdo-nps-dashboard__analysis-grid">
            <OperatorNpsPanel surveys={agg.surveys} appearance={appearance} />
            <DriverCorrelationPanel surveys={agg.surveys} appearance={appearance} />
          </div>
          <ClientTimelinePanel surveys={agg.surveys} appearance={appearance} />
          <FollowUpPanel surveys={agg.surveys} appearance={appearance} />
          <ProjectListSection surveys={agg.surveys} appearance={appearance} />
        </>
      )}
    </div>
  );
}

// ─── Overlay ──────────────────────────────────────────────────────────────────

interface SurveyDashboardOverlayProps {
  onClose: () => void;
  appearance?: SurveyDashboardAppearance;
}

export function SurveyDashboardOverlay({
  onClose,
  appearance = 'legacy'
}: SurveyDashboardOverlayProps) {
  useEffect(() => {
    if (appearance === 'design-system') return undefined;
    const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [appearance, onClose]);

  if (appearance === 'design-system') {
    return (
      <Modal
        open
        appearance="design-system"
        size="full"
        panelClassName="rdo-nps-dashboard-modal"
        title={
          <span className="rdo-nps-dashboard-modal__title">
            <BrandLogo
              className="rdo-nps-dashboard-modal__logo"
              variant="adaptive"
              decorative
            />
            <span className="rdo-nps-dashboard-modal__title-long">
              Dashboard NPS
            </span>
            <span className="rdo-nps-dashboard-modal__title-short">NPS</span>
          </span>
        }
        headerActions={
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<AppIcon icon={DS_ICONS.previous} size="sm" />}
            onClick={onClose}
          >
            Voltar
          </Button>
        }
        showCloseButton={false}
        ariaLabel="Dashboard NPS"
        onClose={onClose}
      >
        <SurveyDashboard appearance="design-system" />
      </Modal>
    );
  }

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
