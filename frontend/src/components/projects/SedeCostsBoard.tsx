import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import { getSedeCosts, type SedeCostCard, type SedeMonthlyCost } from '../../api/acompanhamentoComercial';
import { SEDE_MONTH_OPTIONS, currentSedeDate, currentSedeMonth, formatSedeCustomRangeLabel, formatSedeMonthLabel, formatSedeQuarterLabel, formatSedeSemesterLabel, quarterFromMonth, sedeCustomDateRange, sedeMonthRangeFromParts, sedeQuarterRange, sedeSemesterRange, sedeYearRange, semesterFromMonth, type SedePeriodRange, type SedePeriodType, yearFromMonth } from '../../utils/sedePeriods';
import { SedeOperationalCards } from './SedeOperationalCards';

const ALL_PERIOD_MONTHS_LIMIT = 6;

const PERIOD_TYPES: Array<{ key: SedePeriodType; label: string }> = [
  { key: 'all', label: 'Tudo' },
  { key: 'month', label: 'Mês' },
  { key: 'quarter', label: 'Trim.' },
  { key: 'semester', label: 'Sem.' },
  { key: 'year', label: 'Ano' },
  { key: 'custom', label: 'Personalizado' }
];

function brl(value?: number | null) {
  return value === null || value === undefined
    ? '—'
    : value.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
}

function formatDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}

function maxMonthlyValue(monthly: SedeMonthlyCost[]) {
  return monthly.reduce((max, month) => Math.max(max, month.total), 0);
}

function MonthRow({ month, maxValue }: { month: SedeMonthlyCost; maxValue: number }) {
  const width = maxValue ? Math.max(3, (month.total / maxValue) * 100) : 0;
  return (
    <div className="acp-sede-month">
      <span className="acp-sede-month-label">{month.label}</span>
      <span className="acp-bar-track">
        <span className="acp-bar-fill" style={{ width: `${width}%` }} />
      </span>
      <span className="acp-sede-month-value">{brl(month.total)}</span>
    </div>
  );
}

function SedeCard({ card, monthTitle, monthlyLimit }: { card: SedeCostCard; monthTitle: string; monthlyLimit?: number }) {
  const visibleMonthly = monthlyLimit ? card.monthly.slice(0, monthlyLimit) : card.monthly;
  const maxValue = maxMonthlyValue(visibleMonthly);
  return (
    <article className="acp-pcard acp-sede-card">
      <div className="acp-pcard-head">
        <strong>{card.code}</strong>
        <span className="acp-pcard-name">{card.label}</span>
      </div>
      <div className="acp-pcard-client">
        {card.count} lançamento{card.count === 1 ? '' : 's'} no Omie
      </div>

      <div className="acp-sede-total">{brl(card.total)}</div>

      <div className="acp-pcard-row">
        <span>Pago</span>
        <span className="acp-pcard-strong">{brl(card.paidTotal)}</span>
      </div>
      <div className="acp-pcard-row">
        <span>Em aberto</span>
        <span className="acp-pcard-strong">{brl(card.openTotal)}</span>
      </div>
      <div className="acp-pcard-row">
        <span>Último lançamento</span>
        <span className="acp-pcard-strong">{formatDate(card.lastPurchaseDate)}</span>
      </div>

      <div className="acp-sede-block">
        <div className="acp-sede-block-title">{monthTitle}</div>
        {visibleMonthly.length ? (
          <div className="acp-sede-months">
            {visibleMonthly.map(month => (
              <MonthRow key={month.month} month={month} maxValue={maxValue} />
            ))}
          </div>
        ) : (
          <div className="placeholder-copy">Sem custos lançados.</div>
        )}
      </div>

      <div className="acp-sede-block">
        <div className="acp-sede-block-title">Categorias principais</div>
        {card.topCategories.length ? (
          <div className="acp-sede-cats">
            {card.topCategories.map(category => (
              <div className="acp-pcard-row acp-sede-cat" key={category.categoria}>
                <span>{category.categoria}</span>
                <span>{brl(category.total)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="placeholder-copy">Sem categorias.</div>
        )}
      </div>
    </article>
  );
}

export function SedeCostsBoard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultDate = currentSedeDate();
  const defaultMonth = currentSedeMonth();
  const defaultYear = yearFromMonth(defaultMonth);
  const defaultMonthNumber = defaultMonth.slice(5, 7);
  const initialPeriod = PERIOD_TYPES.some(item => item.key === searchParams.get('periodo')) ? (searchParams.get('periodo') as SedePeriodType) : 'all';
  const initialFrom = searchParams.get('de');
  const initialTo = searchParams.get('ate');
  const initialRange = initialFrom && initialTo && /^\d{4}-\d{2}$/.test(initialFrom) && /^\d{4}-\d{2}$/.test(initialTo) && initialFrom <= initialTo ? { from: initialFrom, to: initialTo } : null;
  const [periodType, setPeriodType] = useState<SedePeriodType>(initialPeriod);
  const [monthNumberValue, setMonthNumberValue] = useState(initialRange?.from.slice(5, 7) || defaultMonthNumber);
  const [monthYear, setMonthYear] = useState(initialRange?.from.slice(0, 4) || defaultYear);
  const [quarterValue, setQuarterValue] = useState(quarterFromMonth(defaultMonth));
  const [quarterYear, setQuarterYear] = useState(defaultYear);
  const [semesterValue, setSemesterValue] = useState(semesterFromMonth(defaultMonth));
  const [semesterYear, setSemesterYear] = useState(defaultYear);
  const [yearValue, setYearValue] = useState(defaultYear);
  const [customFrom, setCustomFrom] = useState(initialRange ? `${initialRange.from}-01` : defaultDate);
  const [customTo, setCustomTo] = useState(initialRange ? `${initialRange.to}-28` : defaultDate);
  const [activeRange, setActiveRange] = useState<SedePeriodRange | null>(initialRange);
  const [activePeriodLabel, setActivePeriodLabel] = useState(initialRange ? formatSedeCustomRangeLabel(initialRange.from, initialRange.to) : 'Todo o período');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['sede-costs', activeRange?.from ?? null, activeRange?.to ?? null],
    queryFn: () => getSedeCosts(activeRange ?? undefined),
    placeholderData: keepPreviousData
  });
  const cards = data?.cards ?? [];
  const activeCards = cards.filter(card => card.count > 0).length;
  const customInvalid = periodType === 'custom' && Boolean(customFrom && customTo && customTo < customFrom);
  const monthTitle = activeRange ? 'Meses do período' : 'Meses recentes';
  const monthlyLimit = activeRange ? undefined : ALL_PERIOD_MONTHS_LIMIT;

  if (isLoading) return <div className="page-card placeholder-copy">Carregando custos da Sede…</div>;
  if (isError || !data) return <div className="page-card placeholder-copy">Não foi possível carregar os custos da Sede.</div>;

  function applyRange(range: SedePeriodRange | null, label: string) {
    setActiveRange(range);
    setActivePeriodLabel(label);
    const next = new URLSearchParams(searchParams);
    if (range) {
      next.set('de', range.from);
      next.set('ate', range.to);
    } else {
      next.delete('de');
      next.delete('ate');
    }
    setSearchParams(next, { replace: true });
  }

  function applyMonth(nextMonth: string, nextYear: string) {
    setMonthNumberValue(nextMonth);
    setMonthYear(nextYear);
    const range = sedeMonthRangeFromParts(nextYear, nextMonth);
    if (range) applyRange(range, formatSedeMonthLabel(range.from));
  }

  function applyQuarter(nextQuarter: string, nextYear: string) {
    setQuarterValue(nextQuarter);
    setQuarterYear(nextYear);
    const range = sedeQuarterRange(nextYear, nextQuarter);
    if (range) applyRange(range, formatSedeQuarterLabel(nextYear, nextQuarter));
  }

  function applySemester(nextSemester: string, nextYear: string) {
    setSemesterValue(nextSemester);
    setSemesterYear(nextYear);
    const range = sedeSemesterRange(nextYear, nextSemester);
    if (range) applyRange(range, formatSedeSemesterLabel(nextYear, nextSemester));
  }

  function applyYear(value: string) {
    setYearValue(value);
    const range = sedeYearRange(value);
    if (range) applyRange(range, value);
  }

  function applyCustom(from: string, to: string) {
    const range = sedeCustomDateRange(from, to);
    if (range) applyRange(range, formatSedeCustomRangeLabel(range.from, range.to));
  }

  function handlePeriodTypeChange(nextType: SedePeriodType) {
    setPeriodType(nextType);
    const next = new URLSearchParams(searchParams);
    next.set('periodo', nextType);
    setSearchParams(next, { replace: true });

    if (nextType === 'all') {
      applyRange(null, 'Todo o período');
      return;
    }

    if (nextType === 'month') {
      applyMonth(monthNumberValue || defaultMonthNumber, monthYear || defaultYear);
      return;
    }

    if (nextType === 'quarter') {
      const baseMonth = defaultMonth;
      applyQuarter(quarterValue || quarterFromMonth(baseMonth), quarterYear || yearFromMonth(baseMonth));
      return;
    }

    if (nextType === 'semester') {
      const baseMonth = defaultMonth;
      applySemester(semesterValue || semesterFromMonth(baseMonth), semesterYear || yearFromMonth(baseMonth));
      return;
    }

    if (nextType === 'year') {
      applyYear(yearValue || defaultYear);
      return;
    }

    const from = customFrom || defaultDate;
    const to = customTo || defaultDate;
    setCustomFrom(from);
    setCustomTo(to);
    applyCustom(from, to);
  }

  return (
    <div className="acp-dash acp-sede-wrap">
      <div className="page-card acp-filters" data-acp-sede-filters>
        <div className="field-group field-group-wide">
          <label>Período</label>
          <div className="acp-seg" role="group" aria-label="Período dos custos da Sede">
            {PERIOD_TYPES.map(type => (
              <button key={type.key} type="button" className={periodType === type.key ? 'acp-seg-btn active' : 'acp-seg-btn'} onClick={() => handlePeriodTypeChange(type.key)}>
                {type.label}
              </button>
            ))}
          </div>
        </div>

        {periodType === 'month' && (
          <>
            <div className="field-group">
              <label htmlFor="sede-month-select">Mês</label>
              <select id="sede-month-select" value={monthNumberValue} onChange={e => applyMonth(e.target.value, monthYear || defaultYear)}>
                {SEDE_MONTH_OPTIONS.map(month => (
                  <option key={month.value} value={month.value}>
                    {month.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-group">
              <label htmlFor="sede-month-year">Ano</label>
              <input id="sede-month-year" type="number" value={monthYear} onChange={e => applyMonth(monthNumberValue, e.target.value)} />
            </div>
          </>
        )}

        {periodType === 'quarter' && (
          <>
            <div className="field-group">
              <label htmlFor="sede-quarter">Trimestre</label>
              <select id="sede-quarter" value={quarterValue} onChange={e => applyQuarter(e.target.value, quarterYear || defaultYear)}>
                <option value="1">1º trimestre</option>
                <option value="2">2º trimestre</option>
                <option value="3">3º trimestre</option>
                <option value="4">4º trimestre</option>
              </select>
            </div>
            <div className="field-group">
              <label htmlFor="sede-quarter-year">Ano</label>
              <input id="sede-quarter-year" type="number" value={quarterYear} onChange={e => applyQuarter(quarterValue, e.target.value)} />
            </div>
          </>
        )}

        {periodType === 'semester' && (
          <>
            <div className="field-group">
              <label htmlFor="sede-semester">Semestre</label>
              <select id="sede-semester" value={semesterValue} onChange={e => applySemester(e.target.value, semesterYear || defaultYear)}>
                <option value="1">1º semestre</option>
                <option value="2">2º semestre</option>
              </select>
            </div>
            <div className="field-group">
              <label htmlFor="sede-semester-year">Ano</label>
              <input id="sede-semester-year" type="number" value={semesterYear} onChange={e => applySemester(semesterValue, e.target.value)} />
            </div>
          </>
        )}

        {periodType === 'year' && (
          <div className="field-group">
            <label htmlFor="sede-year">Ano</label>
            <input id="sede-year" type="number" value={yearValue} onChange={e => applyYear(e.target.value)} />
          </div>
        )}

        {periodType === 'custom' && (
          <>
            <div className="field-group">
              <label htmlFor="sede-custom-from">De</label>
              <input
                id="sede-custom-from"
                type="date"
                value={customFrom}
                onChange={e => {
                  setCustomFrom(e.target.value);
                  applyCustom(e.target.value, customTo);
                }}
              />
            </div>
            <div className={customInvalid ? 'field-group field-invalid' : 'field-group'}>
              <label htmlFor="sede-custom-to">Até</label>
              <input
                id="sede-custom-to"
                type="date"
                value={customTo}
                onChange={e => {
                  setCustomTo(e.target.value);
                  applyCustom(customFrom, e.target.value);
                }}
              />
            </div>
            {customInvalid && (
              <div className="field-group">
                <span className="placeholder-copy" role="alert">
                  Mês final não pode ser anterior ao inicial.
                </span>
              </div>
            )}
          </>
        )}
      </div>

      <div className="acp-kpis">
        <div className="acp-kpi">
          <span className="acp-kpi-label">Centros</span>
          <span className="acp-kpi-value">
            {activeCards}/{cards.length}
          </span>
        </div>
        <div className="acp-kpi">
          <span className="acp-kpi-label">{activePeriodLabel}</span>
          <span className="acp-kpi-value">{brl(data.summary.total)}</span>
        </div>
        <div className="acp-kpi">
          <span className="acp-kpi-label">Pago</span>
          <span className="acp-kpi-value">{brl(data.summary.paidTotal)}</span>
        </div>
        <div className="acp-kpi acp-kpi-accent">
          <span className="acp-kpi-label">Em aberto</span>
          <span className="acp-kpi-value">{brl(data.summary.openTotal)}</span>
          <span className="acp-kpi-foot">
            {data.summary.count} lançamento{data.summary.count === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      <SedeOperationalCards data={data.operational} />

      <div className="acp-pcards-grid acp-sede-grid">
        {cards.map(card => (
          <SedeCard key={card.code} card={card} monthTitle={monthTitle} monthlyLimit={monthlyLimit} />
        ))}
      </div>
    </div>
  );
}
