import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { getAllocationReviewMonth, type AllocationReviewMonthResponse, type ReviewMonthDay } from '../../../api/allocationReview';
import { BrandLoading } from '../../../components/brand/BrandLoading';
import { Alert, Badge, Button, EmptyState } from '../../../components/ui/ds';
import { AllocationReviewLegend, AllocationReviewViewToggle } from './AllocationReviewShared';
import {
  KIND_LABELS,
  addMonths,
  cellDisplay,
  formatDayMonth,
  isoWeekNumber,
  monthCellLabel,
  monthLabel,
  pendingText,
  projectShortLabel,
  rowMatchesSearch,
  valueText,
  type ReviewViewMode
} from './allocationReviewPresentation';
import './AllocationReviewBoard.css';

interface Props {
  yearMonth: string;
  search: string;
  onMonthChange: (yearMonth: string) => void;
  onViewChange: (view: ReviewViewMode) => void;
  onOpenWeek: (weekStart: string) => void;
}

type MonthRow = AllocationReviewMonthResponse['rows'][number];
const WEEKDAY_INITIALS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

function weekdayIndex(date: string) {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

export function AllocationReviewMonthView({ yearMonth, search, onMonthChange, onViewChange, onOpenWeek }: Props) {
  const month = useQuery({ queryKey: ['allocation-review-month', yearMonth], queryFn: () => getAllocationReviewMonth(yearMonth) });
  const data = month.data;
  const projectsById = useMemo(() => new Map((data?.projects || []).map(project => [project.id, project])), [data?.projects]);
  const rows = useMemo(() => (data?.rows || []).filter(row => rowMatchesSearch(row, search, projectsById)), [data?.rows, projectsById, search]);

  function totalLabel(total: MonthRow['totals'][number]) {
    const name = total.projectId ? projectShortLabel(projectsById.get(total.projectId), total.projectId) : KIND_LABELS[total.kind];
    return `${name} · ${String(total.days).replace('.', ',')} d`;
  }

  function cell(row: MonthRow, day: ReviewMonthDay, compact = false) {
    const display = cellDisplay(day.value, projectsById);
    const classes = [
      'allocation-review-mcell',
      `is-${day.eligible ? display.tone : 'ineligible'}`,
      day.pending && day.pendingReason !== 'NO_INFORMATION' ? 'is-pending' : '',
      day.confirmed ? 'is-confirmed' : '',
      compact ? 'is-compact' : ''
    ].filter(Boolean).join(' ');
    const label = `${row.collaborator.name}, ${formatDayMonth(day.date)}: ${day.eligible ? valueText(day.value, projectsById) : 'fora do vínculo'}${day.pending ? `, pendente (${pendingText(day)})` : ''}${day.confirmed ? ', conferido' : ''}. Abrir a semana.`;
    return (
      <button type="button" className={classes} title={label} aria-label={label} disabled={!day.eligible} onClick={() => onOpenWeek(day.weekStart)}>
        {day.eligible ? monthCellLabel(day.value, projectsById) : '–'}
      </button>
    );
  }

  const header = (
    <div className="allocation-review-header">
      <AllocationReviewViewToggle view="mes" onChange={onViewChange} />
      <div className="allocation-review-week" role="group" aria-label="Mês">
        <Button size="sm" variant="ghost" aria-label="Mês anterior" onClick={() => onMonthChange(addMonths(yearMonth, -1))}>‹</Button>
        <span className="allocation-review-week__label allocation-review-month__label">{monthLabel(yearMonth)}</span>
        <Button size="sm" variant="ghost" aria-label="Próximo mês" onClick={() => onMonthChange(addMonths(yearMonth, 1))}>›</Button>
      </div>
    </div>
  );

  if (month.isLoading) return <div className="efetivo-board allocation-review">{header}<p className="placeholder-copy"><BrandLoading label="Carregando o mês" inline size="sm" /></p></div>;
  if (month.isError || !data) return <div className="efetivo-board allocation-review">{header}<Alert tone="danger" title="Não foi possível carregar o mês">{(month.error as Error)?.message || 'Tente novamente.'}</Alert></div>;

  const firstWeekday = (weekdayIndex(data.month.first) + 6) % 7; // segunda = 0

  return (
    <div className="efetivo-board allocation-review" data-allocation-review-month>
      {header}
      <p className="allocation-review-note">Visão de leitura do mês. Clique num dia ou numa semana para abrir a conferência daquela semana.</p>

      <ol className="allocation-review-weeks" aria-label="Semanas do mês">
        {data.weeks.map(week => {
          const closed = week.status === 'CLOSED';
          const tone = closed ? 'success' : !week.ended ? 'neutral' : week.pendingDays ? 'warning' : 'info';
          const status = closed ? 'Fechada' : !week.ended ? 'Em andamento' : `${week.confirmedRows} de ${week.totalRows} conferidos`;
          return (
            <li key={week.weekStart}>
              <button type="button" className="allocation-review-week-chip" onClick={() => onOpenWeek(week.weekStart)}>
                <strong>Semana {isoWeekNumber(week.weekStart)}</strong>
                <span>{formatDayMonth(week.weekStart)} a {formatDayMonth(week.weekEnd)}</span>
                <Badge tone={tone}>{status}</Badge>
                {!closed && week.pendingDays ? <span className="allocation-review-week-chip__pending">{week.pendingDays} pendência{week.pendingDays > 1 ? 's' : ''}</span> : null}
              </button>
            </li>
          );
        })}
      </ol>

      <AllocationReviewLegend />

      {!rows.length ? (
        <EmptyState title="Nenhum colaborador com esse filtro." description="Ajuste a busca para ver outros colaboradores." />
      ) : (
        <>
          <div className="allocation-review-table-wrap">
            <table className="allocation-review-table allocation-review-month-table" aria-label="Alocação do mês por colaborador">
              <colgroup>
                <col className="allocation-review-table__col-who" />
                {data.days.map(day => <col key={day.date} className="allocation-review-month-table__col-day" />)}
                <col className="allocation-review-month-table__col-total" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" className="allocation-review-table__who">Colaborador</th>
                  {data.days.map(day => (
                    <th scope="col" key={day.date} className={day.isWeekend || day.isHoliday ? 'is-rest' : ''} title={day.holidayName || undefined}>
                      {WEEKDAY_INITIALS[weekdayIndex(day.date)]}<strong>{day.date.slice(8)}</strong>
                    </th>
                  ))}
                  <th scope="col" className="allocation-review-month-table__total">Total no mês</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.collaborator.id}>
                    <th scope="row" className="allocation-review-table__who">
                      <span className="allocation-review-who__name">{row.collaborator.name}</span>
                      {row.pendingCount ? <span className="allocation-review-row-status is-pending">{row.pendingCount} pendência{row.pendingCount > 1 ? 's' : ''}</span> : null}
                    </th>
                    {row.days.map(day => (
                      <td key={day.date} className={data.days.find(item => item.date === day.date)?.isWeekend ? 'is-rest' : ''}>{cell(row, day)}</td>
                    ))}
                    <td className="allocation-review-month-table__total">
                      <ul>{row.totals.slice(0, 4).map(total => <li key={`${total.kind}-${total.projectId}`}>{totalLabel(total)}</li>)}</ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="allocation-review-cards" aria-label="Alocação do mês por colaborador">
            {rows.map(row => (
              <article key={row.collaborator.id} className="allocation-review-card">
                <header>
                  <span className="allocation-review-who__name">{row.collaborator.name}</span>
                  {row.pendingCount ? <span className="allocation-review-row-status is-pending">{row.pendingCount} pendência{row.pendingCount > 1 ? 's' : ''}</span> : null}
                </header>
                <div className="allocation-review-month-calendar" role="group" aria-label={`Calendário de ${row.collaborator.name}`}>
                  {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((initial, index) => <span key={index} className="allocation-review-month-calendar__head" aria-hidden="true">{initial}</span>)}
                  {Array.from({ length: firstWeekday }, (_, index) => <span key={`blank-${index}`} aria-hidden="true" />)}
                  {row.days.map(day => <div key={day.date}>{cell(row, day, true)}</div>)}
                </div>
                <ul className="allocation-review-month-totals">{row.totals.map(total => <li key={`${total.kind}-${total.projectId}`}>{totalLabel(total)}</li>)}</ul>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
