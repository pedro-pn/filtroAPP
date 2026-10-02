import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import { getSedeCosts, type SedeCostCard } from '../../api/acompanhamentoComercial';
import { SEDE_MONTH_OPTIONS, currentSedeDate, currentSedeMonth, formatSedeCustomRangeLabel, formatSedeMonthLabel, formatSedeQuarterLabel, formatSedeSemesterLabel, quarterFromMonth, sedeCustomDateRange, sedeMonthRangeFromParts, sedeQuarterRange, sedeSemesterRange, sedeYearRange, semesterFromMonth, type SedePeriodRange, type SedePeriodType, yearFromMonth } from '../../utils/sedePeriods';
import { Alert, Badge, BarList, Button, Card, EmptyState, Field, Input, MetricCard, Select, Skeleton } from '../ui/ds';
import { SedeOperationalCards } from './SedeOperationalCards';
import './SedeCostsBoard.ds.css';

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

function SedeCard({ card, monthTitle, monthlyLimit }: { card: SedeCostCard; monthTitle: string; monthlyLimit?: number }) {
  const visibleMonthly = monthlyLimit ? card.monthly.slice(0, monthlyLimit) : card.monthly;
  const maxValue = visibleMonthly.reduce((max, month) => Math.max(max, month.total), 0);
  return (
    <Card variant="flat" className="acp-sede-ds__cost-card"
      title={<span className="acp-sede-ds__card-title"><strong>{card.code}</strong><span>{card.label}</span></span>}
      actions={<Badge tone="neutral">{card.count} lançamento{card.count === 1 ? '' : 's'}</Badge>}>
      <div className="acp-sede-ds__cost-total"><span>Total no período</span><strong>{brl(card.total)}</strong></div>
      <dl className="acp-sede-ds__facts">
        <div><dt>Pago</dt><dd>{brl(card.paidTotal)}</dd></div>
        <div><dt>Em aberto</dt><dd>{brl(card.openTotal)}</dd></div>
        <div><dt>Último lançamento</dt><dd>{formatDate(card.lastPurchaseDate)}</dd></div>
      </dl>
      <div className="acp-sede-ds__cost-section">
        <h3>{monthTitle}</h3>
        {visibleMonthly.length ? <BarList aria-label={`${monthTitle} de ${card.label}`} items={visibleMonthly.map(month => ({
          id: month.month, label: month.label, valueLabel: brl(month.total),
          percentage: maxValue ? month.total / maxValue * 100 : 0
        }))} /> : <p>Sem custos lançados.</p>}
      </div>
      <div className="acp-sede-ds__cost-section">
        <h3>Categorias principais</h3>
        {card.topCategories.length ? <dl className="acp-sede-ds__facts">
          {card.topCategories.map(category => <div key={category.categoria}>
            <dt>{category.categoria}</dt><dd>{brl(category.total)}</dd>
          </div>)}
        </dl> : <p>Sem categorias.</p>}
      </div>
    </Card>
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

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['sede-costs', activeRange?.from ?? null, activeRange?.to ?? null],
    queryFn: () => getSedeCosts(activeRange ?? undefined),
    placeholderData: keepPreviousData
  });
  const cards = data?.cards ?? [];
  const activeCards = cards.filter(card => card.count > 0).length;
  const customInvalid = periodType === 'custom' && Boolean(customFrom && customTo && customTo < customFrom);
  const monthTitle = activeRange ? 'Meses do período' : 'Meses recentes';
  const monthlyLimit = activeRange ? undefined : ALL_PERIOD_MONTHS_LIMIT;

  function applyRange(range: SedePeriodRange | null, label: string, type: SedePeriodType = periodType) {
    setActiveRange(range);
    setActivePeriodLabel(label);
    const next = new URLSearchParams(searchParams);
    next.set('periodo', type);
    if (range) {
      next.set('de', range.from);
      next.set('ate', range.to);
    } else {
      next.delete('de');
      next.delete('ate');
    }
    setSearchParams(next, { replace: true });
  }

  function applyMonth(nextMonth: string, nextYear: string, type: SedePeriodType = periodType) {
    setMonthNumberValue(nextMonth);
    setMonthYear(nextYear);
    const range = sedeMonthRangeFromParts(nextYear, nextMonth);
    if (range) applyRange(range, formatSedeMonthLabel(range.from), type);
  }

  function applyQuarter(nextQuarter: string, nextYear: string, type: SedePeriodType = periodType) {
    setQuarterValue(nextQuarter);
    setQuarterYear(nextYear);
    const range = sedeQuarterRange(nextYear, nextQuarter);
    if (range) applyRange(range, formatSedeQuarterLabel(nextYear, nextQuarter), type);
  }

  function applySemester(nextSemester: string, nextYear: string, type: SedePeriodType = periodType) {
    setSemesterValue(nextSemester);
    setSemesterYear(nextYear);
    const range = sedeSemesterRange(nextYear, nextSemester);
    if (range) applyRange(range, formatSedeSemesterLabel(nextYear, nextSemester), type);
  }

  function applyYear(value: string, type: SedePeriodType = periodType) {
    setYearValue(value);
    const range = sedeYearRange(value);
    if (range) applyRange(range, value, type);
  }

  function applyCustom(from: string, to: string, type: SedePeriodType = periodType) {
    const range = sedeCustomDateRange(from, to);
    if (range) applyRange(range, formatSedeCustomRangeLabel(range.from, range.to), type);
  }

  function handlePeriodTypeChange(nextType: SedePeriodType) {
    setPeriodType(nextType);

    if (nextType === 'all') {
      applyRange(null, 'Todo o período', nextType);
      return;
    }

    if (nextType === 'month') {
      applyMonth(monthNumberValue || defaultMonthNumber, monthYear || defaultYear, nextType);
      return;
    }

    if (nextType === 'quarter') {
      const baseMonth = defaultMonth;
      applyQuarter(quarterValue || quarterFromMonth(baseMonth), quarterYear || yearFromMonth(baseMonth), nextType);
      return;
    }

    if (nextType === 'semester') {
      const baseMonth = defaultMonth;
      applySemester(semesterValue || semesterFromMonth(baseMonth), semesterYear || yearFromMonth(baseMonth), nextType);
      return;
    }

    if (nextType === 'year') {
      applyYear(yearValue || defaultYear, nextType);
      return;
    }

    const from = customFrom || defaultDate;
    const to = customTo || defaultDate;
    setCustomFrom(from);
    setCustomTo(to);
    applyCustom(from, to, nextType);
  }

  return (
    <div className="fv-ds acp-sede-ds">
      <header className="acp-sede-ds__heading">
        <h1>Custos da Sede</h1>
        <p>Acompanhe os centros de custo do Omie e os indicadores operacionais.</p>
      </header>
      <Card variant="flat" title="Período dos custos" className="acp-sede-ds__filters" data-acp-sede-filters>
        <div className="acp-sede-ds__periods" role="group" aria-label="Período dos custos da Sede">
          {PERIOD_TYPES.map(type => <Button key={type.key} size="sm"
            variant={periodType === type.key ? 'primary' : 'secondary'}
            aria-pressed={periodType === type.key}
            onClick={() => handlePeriodTypeChange(type.key)}>{type.label}</Button>)}
        </div>

        {periodType === 'month' && (
          <div className="acp-sede-ds__period-fields">
            <Field id="sede-month-select" label="Mês" optionalText="">
              <Select size="sm" value={monthNumberValue} onChange={e => applyMonth(e.target.value, monthYear || defaultYear)}>
                {SEDE_MONTH_OPTIONS.map(month => <option key={month.value} value={month.value}>{month.label}</option>)}
              </Select>
            </Field>
            <Field id="sede-month-year" label="Ano" optionalText="">
              <Input size="sm" type="number" min="1900" max="2100" value={monthYear} onChange={e => applyMonth(monthNumberValue, e.target.value)} />
            </Field>
          </div>
        )}

        {periodType === 'quarter' && (
          <div className="acp-sede-ds__period-fields">
            <Field id="sede-quarter" label="Trimestre" optionalText="">
              <Select size="sm" value={quarterValue} onChange={e => applyQuarter(e.target.value, quarterYear || defaultYear)}>
                <option value="1">1º trimestre</option>
                <option value="2">2º trimestre</option>
                <option value="3">3º trimestre</option>
                <option value="4">4º trimestre</option>
              </Select>
            </Field>
            <Field id="sede-quarter-year" label="Ano" optionalText="">
              <Input size="sm" type="number" min="1900" max="2100" value={quarterYear} onChange={e => applyQuarter(quarterValue, e.target.value)} />
            </Field>
          </div>
        )}

        {periodType === 'semester' && (
          <div className="acp-sede-ds__period-fields">
            <Field id="sede-semester" label="Semestre" optionalText="">
              <Select size="sm" value={semesterValue} onChange={e => applySemester(e.target.value, semesterYear || defaultYear)}>
                <option value="1">1º semestre</option>
                <option value="2">2º semestre</option>
              </Select>
            </Field>
            <Field id="sede-semester-year" label="Ano" optionalText="">
              <Input size="sm" type="number" min="1900" max="2100" value={semesterYear} onChange={e => applySemester(semesterValue, e.target.value)} />
            </Field>
          </div>
        )}

        {periodType === 'year' && (
          <div className="acp-sede-ds__period-fields">
            <Field id="sede-year" label="Ano" optionalText="">
              <Input size="sm" type="number" min="1900" max="2100" value={yearValue} onChange={e => applyYear(e.target.value)} />
            </Field>
          </div>
        )}

        {periodType === 'custom' && (
          <div className="acp-sede-ds__period-fields">
            <Field id="sede-custom-from" label="De" optionalText="">
              <Input size="sm"
                type="date"
                value={customFrom}
                onChange={e => {
                  setCustomFrom(e.target.value);
                  applyCustom(e.target.value, customTo);
                }}
              />
            </Field>
            <Field id="sede-custom-to" label="Até" optionalText=""
              errorText={customInvalid ? 'A data final não pode ser anterior à inicial.' : undefined}>
              <Input size="sm"
                type="date"
                value={customTo}
                onChange={e => {
                  setCustomTo(e.target.value);
                  applyCustom(customFrom, e.target.value);
                }}
              />
            </Field>
          </div>
        )}
      </Card>

      {isError ? <Alert tone="warning" title="Não foi possível atualizar os custos da Sede"
        action={{ label: 'Tentar novamente', onClick: () => void refetch() }}>
        {data ? 'Os últimos valores carregados continuam visíveis.' : 'Confira a conexão e tente novamente.'}
      </Alert> : null}

      <div className="acp-sede-ds__results" aria-busy={isLoading || isFetching}>
        {data ? <>
          <div className="acp-sede-ds__metrics">
            <MetricCard label="Centros com lançamentos" value={`${activeCards}/${cards.length}`} />
            <MetricCard label="Total" value={brl(data.summary.total)} description={activePeriodLabel} />
            <MetricCard label="Pago" value={brl(data.summary.paidTotal)} />
            <MetricCard label="Em aberto" value={brl(data.summary.openTotal)} tone="warning"
              description={`${data.summary.count} lançamento${data.summary.count === 1 ? '' : 's'}`} />
          </div>

          <SedeOperationalCards data={data.operational} />

          <section className="acp-sede-ds__costs" aria-labelledby="acp-sede-centers-title">
            <div className="acp-sede-ds__section-heading"><h2 id="acp-sede-centers-title">Centros de custo</h2>
              <p>Compras e lançamentos do Omie no período selecionado.</p></div>
            {cards.length ? <div className="acp-sede-ds__cost-grid">
              {cards.map(card => <SedeCard key={card.code} card={card} monthTitle={monthTitle} monthlyLimit={monthlyLimit} />)}
            </div> : <EmptyState title="Nenhum centro de custo encontrado" description="Escolha outro período para consultar os lançamentos." />}
          </section>
        </> : isLoading ? <div className="acp-sede-ds__metrics" role="status" aria-label="Carregando custos da Sede">
          <Skeleton variant="card" decorative style={{ gridColumn: "1 / -1" }} />
        </div> : null}
      </div>
    </div>
  );
}
