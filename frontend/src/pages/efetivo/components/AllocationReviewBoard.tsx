import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';

import {
  closeAllocationReviewWeek,
  confirmAllocationReviewRows,
  discardAllocationReviewDays,
  getAllocationReviewWeek,
  reopenAllocationReviewWeek,
  saveAllocationReviewDays,
  unconfirmAllocationReviewRows,
  type AllocationReviewKind,
  type AllocationReviewWeekResponse,
  type ReviewDayView,
  type ReviewRowView,
  type SaveReviewDayItem
} from '../../../api/allocationReview';
import { ApiClientError } from '../../../api/client';
import { BrandLoading } from '../../../components/brand/BrandLoading';
import { Alert, Badge, Button, EmptyState, ProgressBar, SearchInput } from '../../../components/ui/ds';
import { useConfirmDialog } from '../../../components/ui/useConfirmDialog';
import { useToast } from '../../../components/ui/ToastContext';
import { AllocationReviewBulkBar } from './AllocationReviewBulkBar';
import { AllocationReviewDayPanel } from './AllocationReviewDayPanel';
import { AllocationReviewLegend, AllocationReviewViewToggle } from './AllocationReviewShared';
import { gridCellKey, useAllocationReviewGrid } from './useAllocationReviewGrid';
import {
  addWeeks,
  cellDisplay,
  dayCellKey,
  filterRows,
  formatDayMonth,
  groupRows,
  isoWeekNumber,
  pendingText,
  sourcesText,
  valueText,
  weekRangeLabel,
  type ReviewGroupMode,
  type ReviewShowFilter,
  type ReviewViewMode
} from './allocationReviewPresentation';
import './AllocationReviewBoard.css';

export const ALLOCATION_REVIEW_QUERY_KEY = 'allocation-review-week';

interface Props {
  weekStart: string;
  show: ReviewShowFilter;
  group: ReviewGroupMode;
  search: string;
  onWeekChange: (weekStart: string) => void;
  onShowChange: (value: ReviewShowFilter) => void;
  onGroupChange: (value: ReviewGroupMode) => void;
  onSearchChange: (value: string) => void;
  onViewChange: (view: ReviewViewMode) => void;
}

const SHOW_OPTIONS: Array<[ReviewShowFilter, string]> = [['all', 'Todos'], ['pend', 'Com pendência'], ['todo', 'Não conferidos']];
const GROUP_OPTIONS: Array<[ReviewGroupMode, string]> = [['name', 'Por nome'], ['proj', 'Por projeto']];
const SOURCE_ORDER = ['ponto', 'rdo', 'efetivo'] as const;

function SourceDots({ day }: { day: ReviewDayView }) {
  return (
    <span className="allocation-review-cell__dots" aria-hidden="true">
      {SOURCE_ORDER.map(source => <span key={source} className={`allocation-review-dot is-${day.sources[source].state}`} />)}
    </span>
  );
}

export function AllocationReviewBoard({ weekStart, show, group, search, onWeekChange, onShowChange, onGroupChange, onSearchChange, onViewChange }: Props) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirmDialog('design-system');
  const queryKey = useMemo(() => [ALLOCATION_REVIEW_QUERY_KEY, weekStart], [weekStart]);
  const week = useQuery({ queryKey, queryFn: () => getAllocationReviewWeek(weekStart) });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [panel, setPanel] = useState<{ collaboratorId: string; date: string } | null>(null);
  const data = week.data;
  const projectsById = useMemo(() => new Map((data?.projects || []).map(project => [project.id, project])), [data?.projects]);
  const weekClosed = data?.week.status === 'CLOSED';

  useEffect(() => { setSelected(new Set()); setPanel(null); }, [weekStart]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !panel) setSelected(new Set()); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel]);

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [ALLOCATION_REVIEW_QUERY_KEY] }),
      queryClient.invalidateQueries({ queryKey: ['allocation-review-month'] }),
      queryClient.invalidateQueries({ queryKey: ['allocation-review-pending'] })
    ]);
  }, [queryClient]);

  const onError = useCallback((error: Error) => {
    if (error instanceof ApiClientError && error.code === 'WEEK_VERSION_CONFLICT') {
      toast('Outra pessoa alterou esta semana. Os dados foram atualizados; refaça a alteração.', 'error');
      void refresh();
      return;
    }
    toast(error.message || 'Não foi possível salvar.', 'error');
  }, [refresh, toast]);

  const version = data?.week.version ?? 0;
  const save = useMutation({
    mutationFn: (items: SaveReviewDayItem[]) => saveAllocationReviewDays(weekStart, version, items),
    onSuccess: async (_, items) => {
      await refresh();
      setPanel(null);
      setSelected(new Set());
      toast(items.length > 1 ? `${items.length} dias salvos. Confira a linha para valer.` : 'Dia salvo. Confira a linha para valer.', 'success');
    },
    onError
  });
  const discard = useMutation({
    mutationFn: (day: { collaboratorId: string; date: string }) => discardAllocationReviewDays(weekStart, version, [day]),
    onSuccess: async () => { await refresh(); setPanel(null); toast('O dia voltou para a sugestão do app.', 'success'); },
    onError
  });
  const confirmRows = useMutation({
    mutationFn: (payload: { collaboratorIds: string[] } | { allReady: true }) => confirmAllocationReviewRows(weekStart, version, payload),
    onSuccess: async result => {
      await refresh();
      const alerts = result.alertsCreated || 0;
      toast(`${result.confirmed || 0} colaborador${(result.confirmed || 0) === 1 ? '' : 'es'} conferido${(result.confirmed || 0) === 1 ? '' : 's'}.${alerts ? ` ${alerts} aviso${alerts > 1 ? 's' : ''} de ausência enviado${alerts > 1 ? 's' : ''} ao Efetivo.` : ''}`, 'success');
    },
    onError
  });
  const unconfirm = useMutation({
    mutationFn: (collaboratorId: string) => unconfirmAllocationReviewRows(weekStart, version, [collaboratorId]),
    onSuccess: async () => { await refresh(); toast('Conferência desfeita. A linha voltou a ser editável.', 'success'); },
    onError
  });
  const close = useMutation({
    mutationFn: () => closeAllocationReviewWeek(weekStart, version),
    onSuccess: async () => { await refresh(); toast('Semana fechada.', 'success'); },
    onError
  });
  const reopen = useMutation({
    mutationFn: () => reopenAllocationReviewWeek(weekStart, version),
    onSuccess: async () => { await refresh(); toast('Semana reaberta.', 'success'); },
    onError
  });
  const busy = save.isPending || discard.isPending || confirmRows.isPending || unconfirm.isPending || close.isPending || reopen.isPending;

  const visibleRows = useMemo(() => filterRows(data?.rows || [], show, search, projectsById), [data?.rows, projectsById, search, show]);
  const groups = useMemo(() => groupRows(visibleRows, group, projectsById), [group, projectsById, visibleRows]);
  const flatRows = useMemo(() => groups.flatMap(groupItem => groupItem.rows), [groups]);
  const gridKeys = useMemo(() => flatRows.flatMap((row, rowIndex) => row.days
    .map((day, colIndex) => (day.eligible ? gridCellKey(rowIndex, colIndex) : null))
    .filter((key): key is string => Boolean(key))), [flatRows]);
  const grid = useAllocationReviewGrid(gridKeys);
  const panelRow = panel ? data?.rows.find(row => row.collaborator.id === panel.collaboratorId) || null : null;
  const panelDay = panelRow?.days.find(day => day.date === panel?.date) || null;

  function toggleSelection(row: ReviewRowView, day: ReviewDayView) {
    if (row.confirmed || weekClosed || day.isFuture || !day.eligible) {
      toast(row.confirmed ? 'Desfaça a conferência da linha para editar.' : 'Este dia não pode ser editado.', 'info');
      return;
    }
    setSelected(current => {
      const next = new Set(current);
      const key = dayCellKey(row.collaborator.id, day.date);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function handleCellClick(event: MouseEvent<HTMLButtonElement>, row: ReviewRowView, day: ReviewDayView) {
    if (selectMode || event.shiftKey || event.ctrlKey || event.metaKey) {
      toggleSelection(row, day);
      return;
    }
    setPanel({ collaboratorId: row.collaborator.id, date: day.date });
  }

  function applyBulk(kind: AllocationReviewKind, projectIds: string[]) {
    const items = [...selected].map(key => {
      const [collaboratorId, date] = key.split('|');
      return { collaboratorId, date, kind, projectIds };
    });
    if (items.length) save.mutate(items);
  }

  async function handleClose(payload: AllocationReviewWeekResponse) {
    const edited = payload.summary.editedDays;
    const ok = await confirm({
      title: `Fechar a semana ${isoWeekNumber(payload.week.weekStart)}?`,
      description: `${payload.summary.totalRows} colaboradores conferidos · ${edited} ajuste${edited === 1 ? '' : 's'}. Depois de fechada, ninguém edita os dias e só um administrador pode reabrir. A conferência já vale no custo HH e no relatório Alocação dos colaboradores.`,
      confirmLabel: 'Fechar semana',
      danger: false
    });
    if (ok) close.mutate();
  }

  async function handleReopen() {
    const ok = await confirm({
      title: 'Reabrir a semana?',
      description: 'As conferências feitas continuam valendo. A semana volta a aceitar edição até ser fechada de novo.',
      confirmLabel: 'Reabrir semana',
      danger: false
    });
    if (ok) reopen.mutate();
  }

  function renderCell(row: ReviewRowView, day: ReviewDayView, compact = false, position: [number, number] | null = null) {
    const display = cellDisplay(day.value, projectsById);
    const key = dayCellKey(row.collaborator.id, day.date);
    const classes = [
      'allocation-review-cell',
      `is-${display.tone}`,
      day.pending && day.pendingReason !== 'NO_INFORMATION' ? 'is-pending' : '',
      day.edited ? 'is-edited' : '',
      selected.has(key) ? 'is-selected' : '',
      !day.eligible ? 'is-ineligible' : '',
      compact ? 'is-compact' : ''
    ].filter(Boolean).join(' ');
    const label = `${row.collaborator.name}, ${formatDayMonth(day.date)}: ${valueText(day.value, projectsById)}${day.pending ? `, pendente (${pendingText(day)})` : ''}${day.edited ? ', ajustado' : ''}`;
    const gridKey = position ? gridCellKey(position[0], position[1]) : null;
    return (
      <button
        type="button"
        className={classes}
        aria-label={label}
        title={day.eligible ? `${valueText(day.value, projectsById)}\n${sourcesText(day)}` : undefined}
        aria-pressed={selected.has(key) || undefined}
        disabled={!day.eligible}
        onClick={event => handleCellClick(event, row, day)}
        data-allocation-review-cell
        data-grid-cell={gridKey || undefined}
        tabIndex={gridKey ? grid.tabIndexFor(gridKey) : undefined}
      >
        <span className="allocation-review-cell__mark" aria-hidden="true">{day.edited ? '✎' : day.pending && day.pendingReason !== 'NO_INFORMATION' ? '!' : day.sourceChangedAfterReview ? '↻' : ''}</span>
        <span className="allocation-review-cell__title">{display.title}</span>
        {display.subtitle ? <span className="allocation-review-cell__subtitle" title={display.subtitle}>{display.subtitle}</span> : null}
        {day.absenceAlert ? <span className="allocation-review-cell__alert">avisa o Efetivo</span> : null}
        {day.eligible ? <SourceDots day={day} /> : null}
      </button>
    );
  }

  function renderRowAction(row: ReviewRowView) {
    if (weekClosed) return <span className="allocation-review-row-status is-done">✓ Fechado</span>;
    if (row.confirmed) {
      return (
        <>
          <span className="allocation-review-row-status is-done">✓ Conferido</span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => unconfirm.mutate(row.collaborator.id)}>Desfazer</Button>
        </>
      );
    }
    const future = row.days.some(day => day.eligible && day.isFuture);
    return (
      <>
        {row.pendingCount ? <span className="allocation-review-row-status is-pending">{row.pendingCount} pendência{row.pendingCount > 1 ? 's' : ''}</span> : null}
        <Button
          size="sm"
          variant={row.canConfirm ? 'primary' : 'secondary'}
          disabled={!row.canConfirm || busy}
          title={row.canConfirm ? undefined : future ? 'A semana ainda não terminou.' : 'Resolva as pendências da linha antes de conferir.'}
          onClick={() => confirmRows.mutate({ collaboratorIds: [row.collaborator.id] })}
          data-allocation-review-confirm
        >
          Conferir
        </Button>
      </>
    );
  }

  const header = (
    <div className="allocation-review-header" data-allocation-review-header>
      <AllocationReviewViewToggle view="semana" onChange={onViewChange} />
      <div className="allocation-review-week" role="group" aria-label="Semana">
        <Button size="sm" variant="ghost" aria-label="Semana anterior" onClick={() => onWeekChange(addWeeks(weekStart, -1))}>‹</Button>
        <span className="allocation-review-week__label">
          Semana {isoWeekNumber(weekStart)} · {data ? weekRangeLabel(data.week.weekStart, data.week.weekEnd) : formatDayMonth(weekStart)}
        </span>
        <Button size="sm" variant="ghost" aria-label="Próxima semana" onClick={() => onWeekChange(addWeeks(weekStart, 1))}>›</Button>
      </div>
      {data ? (
        <Badge tone={weekClosed ? 'success' : 'warning'}>
          {weekClosed ? `Fechada${data.week.closedBy ? ` por ${data.week.closedBy.name}` : ''}` : data.week.ended ? 'Em conferência' : 'Semana em andamento'}
        </Badge>
      ) : null}
      {data ? (
        <div className="allocation-review-header__actions">
          {!weekClosed ? (
            <Button size="sm" variant="secondary" disabled={!data.summary.readyRows || busy} onClick={() => confirmRows.mutate({ allReady: true })} data-allocation-review-confirm-all>
              Conferir linhas sem pendência ({data.summary.readyRows})
            </Button>
          ) : null}
          {!weekClosed ? (
            <Button size="sm" variant="primary" disabled={!data.week.canClose || busy} title={data.week.closeBlockers.join(' ')} onClick={() => handleClose(data)} data-allocation-review-close>
              Fechar semana
            </Button>
          ) : null}
          {weekClosed && data.week.canReopen ? <Button size="sm" variant="secondary" disabled={busy} onClick={handleReopen}>Reabrir semana</Button> : null}
        </div>
      ) : null}
      {data && !weekClosed && !data.week.canClose && data.week.closeBlockers.length ? (
        <p className="allocation-review-close-hint" role="status">Para fechar: {data.week.closeBlockers.join(' ')}</p>
      ) : null}
    </div>
  );

  if (week.isLoading) {
    return <div className="efetivo-board allocation-review">{header}<p className="placeholder-copy"><BrandLoading label="Carregando a semana" inline size="sm" /></p></div>;
  }
  if (week.isError || !data) {
    return <div className="efetivo-board allocation-review">{header}<Alert tone="danger" title="Não foi possível carregar a semana">{(week.error as Error)?.message || 'Tente novamente.'}</Alert></div>;
  }

  const { summary } = data;
  return (
    <div className="efetivo-board allocation-review" data-allocation-review>
      {header}
      <p className="allocation-review-note">
        Semana não conferida vale pela alocação automática. O que você conferir passa a valer no custo HH e no relatório <strong>Alocação dos colaboradores</strong>.
      </p>

      <div className="allocation-review-summary" data-allocation-review-summary>
        <Button
          size="sm"
          variant={show === 'pend' ? 'primary' : 'secondary'}
          aria-pressed={show === 'pend'}
          disabled={!summary.divergenceDays && show !== 'pend'}
          onClick={() => onShowChange(show === 'pend' ? 'all' : 'pend')}
          iconLeft={<span className="allocation-review-summary__dot is-warning" aria-hidden="true" />}
        >
          {summary.divergenceDays} divergência{summary.divergenceDays === 1 ? '' : 's'}
        </Button>
        <Button
          size="sm"
          variant={show === 'pend' ? 'primary' : 'secondary'}
          aria-pressed={show === 'pend'}
          disabled={!summary.noInformationDays && show !== 'pend'}
          onClick={() => onShowChange(show === 'pend' ? 'all' : 'pend')}
          iconLeft={<span className="allocation-review-summary__dot is-danger" aria-hidden="true" />}
        >
          {summary.noInformationDays} sem informação
        </Button>
        <span className="allocation-review-summary__text">
          {summary.agreeDays} dias de acordo, {summary.editedDays} ajuste{summary.editedDays === 1 ? '' : 's'}
        </span>
        <ProgressBar
          className="allocation-review-summary__progress"
          label="Colaboradores conferidos"
          value={summary.totalRows ? (summary.confirmedRows / summary.totalRows) * 100 : 0}
          valueLabel={`${summary.confirmedRows} de ${summary.totalRows}`}
        />
      </div>

      <div className="allocation-review-toolbar">
        <SearchInput size="sm" value={search} onChange={onSearchChange} label="Buscar colaborador ou projeto" placeholder="Buscar colaborador ou projeto" resultCount={{ shown: visibleRows.length, total: data.rows.length }} />
        <div className="efetivo-segmented" role="group" aria-label="Mostrar">
          {SHOW_OPTIONS.map(([value, label]) => <button key={value} type="button" className={show === value ? 'active' : ''} aria-pressed={show === value} onClick={() => onShowChange(value)}>{label}</button>)}
        </div>
        <div className="efetivo-segmented" role="group" aria-label="Agrupar">
          {GROUP_OPTIONS.map(([value, label]) => <button key={value} type="button" className={group === value ? 'active' : ''} aria-pressed={group === value} onClick={() => onGroupChange(value)}>{label}</button>)}
        </div>
        {!weekClosed ? (
          <Button size="sm" variant={selectMode ? 'primary' : 'secondary'} className="allocation-review-select-toggle" aria-pressed={selectMode} title="No computador, você também pode segurar Shift e clicar nos dias." onClick={() => { setSelectMode(value => !value); setSelected(new Set()); }} data-allocation-review-select>
            {selectMode ? 'Concluir seleção' : 'Selecionar dias'}
          </Button>
        ) : null}
      </div>

      <AllocationReviewLegend showDots />

      {!visibleRows.length ? (
        <EmptyState title="Nenhum colaborador com esse filtro." description="Ajuste a busca ou o filtro para ver outros colaboradores." />
      ) : (
        <>
          <div className="allocation-review-table-wrap" onKeyDown={grid.onKeyDown} onFocus={grid.onFocus}>
            <table className="allocation-review-table" aria-label="Alocação da semana por colaborador" aria-describedby="allocation-review-grid-hint">
              <colgroup>
                <col className="allocation-review-table__col-who" />
                {data.days.map(day => <col key={day.date} className={day.isWeekend ? 'allocation-review-table__col-rest' : undefined} />)}
                <col className="allocation-review-table__col-end" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" className="allocation-review-table__who">Colaborador</th>
                  {data.days.map(day => (
                    <th scope="col" key={day.date} className={day.isWeekend || day.isHoliday ? 'is-rest' : ''} title={day.holidayName || undefined}>
                      {day.weekday}<strong>{formatDayMonth(day.date)}</strong>{day.isHoliday ? <small>feriado</small> : null}
                    </th>
                  ))}
                  <th scope="col" className="allocation-review-table__end">Conferência</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(groupItem => (
                  <GroupRows key={groupItem.key} title={groupItem.title} count={groupItem.rows.length}>
                    {groupItem.rows.map(row => (
                      <tr key={row.collaborator.id} className={row.confirmed ? 'is-confirmed' : ''}>
                        <th scope="row" className="allocation-review-table__who">
                          <span className="allocation-review-who__name">{row.collaborator.name}</span>
                          {row.collaborator.jobRole ? <span className="allocation-review-who__role">{row.collaborator.jobRole}</span> : null}
                        </th>
                        {row.days.map((day, colIndex) => (
                          <td key={day.date} className={data.days.find(item => item.date === day.date)?.isWeekend ? 'is-rest' : ''}>
                            {renderCell(row, day, false, [flatRows.indexOf(row), colIndex])}
                          </td>
                        ))}
                        <td className="allocation-review-table__end">{renderRowAction(row)}</td>
                      </tr>
                    ))}
                  </GroupRows>
                ))}
              </tbody>
            </table>
          </div>

          <div className="allocation-review-cards" aria-label="Alocação da semana por colaborador">
            {groups.map(groupItem => (
              <section key={groupItem.key} className="allocation-review-card-group">
                {groupItem.title ? <h3>{groupItem.title} · {groupItem.rows.length}</h3> : null}
                {groupItem.rows.map(row => (
                  <article key={row.collaborator.id} className={`allocation-review-card${row.confirmed ? ' is-confirmed' : ''}`}>
                    <header>
                      <span className="allocation-review-who__name">{row.collaborator.name}</span>
                      {row.collaborator.jobRole ? <span className="allocation-review-who__role">{row.collaborator.jobRole}</span> : null}
                    </header>
                    <ol>
                      {row.days.map(day => {
                        const meta = data.days.find(item => item.date === day.date);
                        return (
                          <li key={day.date}>
                            <span className="allocation-review-card__day">{meta?.weekday} {formatDayMonth(day.date)}</span>
                            {renderCell(row, day, true)}
                          </li>
                        );
                      })}
                    </ol>
                    <footer>{renderRowAction(row)}</footer>
                  </article>
                ))}
              </section>
            ))}
          </div>
        </>
      )}

      <p id="allocation-review-grid-hint" className="sr-only">Use as setas para andar entre os dias e Enter para abrir o dia.</p>

      <AllocationReviewBulkBar count={selected.size} projects={data.projects} saving={busy} onApply={applyBulk} onClear={() => setSelected(new Set())} />
      <AllocationReviewDayPanel
        open={Boolean(panelRow && panelDay)}
        row={panelRow}
        day={panelDay}
        weekClosed={weekClosed}
        projects={data.projects}
        projectsById={projectsById}
        saving={save.isPending || discard.isPending}
        onClose={() => setPanel(null)}
        onSave={items => save.mutate(items)}
        onDiscard={day => panelRow && discard.mutate({ collaboratorId: panelRow.collaborator.id, date: day.date })}
      />
      {confirmDialog}
    </div>
  );
}

function GroupRows({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <>
      {title ? (
        <tr className="allocation-review-table__group">
          <th scope="rowgroup" colSpan={9}>{title} · {count}</th>
        </tr>
      ) : null}
      {children}
    </>
  );
}
