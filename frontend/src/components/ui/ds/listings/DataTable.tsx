import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  type HTMLAttributes,
  type ReactNode
} from 'react';

import { AppIcon } from '../../../icons/AppIcon';
import { Alert } from '../Alert';
import { EmptyState } from '../EmptyState';
import { DS_ICONS } from '../icons';
import { Skeleton } from '../Skeleton';
import { Spinner } from '../Spinner';
import { joinClassNames } from '../utils';
import { MobileList } from './MobileList';
import type {
  DataTableColumn,
  DataTableDensity,
  DataTableMobileConfig,
  DataTableSort,
  ListingRowId,
  ListingSelection
} from './types';
import {
  useListingMobileViewport,
  type ListingMobileBreakpoint
} from './useListingMedia';
import './listings.css';

const EMPTY_ROW_IDS: readonly ListingRowId[] = [];

interface SelectionCheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  label: string;
  className?: string;
  onChange: () => void;
}

function SelectionCheckbox({
  checked,
  indeterminate = false,
  disabled,
  label,
  className,
  onChange
}: SelectionCheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label className={joinClassNames('fv-listing-checkbox', className)}>
      <input
        ref={inputRef}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={onChange}
      />
    </label>
  );
}

function renderColumnValue<T>(
  column: DataTableColumn<T>,
  row: T,
  rowIndex: number
) {
  if (column.render) return column.render(row, rowIndex);

  const value =
    typeof column.accessor === 'function'
      ? column.accessor(row)
      : row[column.accessor ?? (column.key as keyof T)];

  if (value === null || value === undefined || value === '') return '—';
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint'
  ) {
    return value;
  }
  return String(value);
}

export interface DataTableProps<T> extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'children'
> {
  rows: readonly T[];
  columns: readonly DataTableColumn<T>[];
  getRowId: (row: T) => ListingRowId;
  ariaLabel: string;
  caption?: ReactNode;
  density?: DataTableDensity;
  sort?: DataTableSort | null;
  onSortChange?: (sort: DataTableSort) => void;
  selection?: ListingSelection<T>;
  getRowClassName?: (row: T, index: number) => string | undefined;
  rowActions?: (
    row: T,
    index: number,
    context: { disabled: boolean }
  ) => ReactNode;
  renderRowDetails?: (row: T, index: number) => ReactNode;
  actionsLabel?: string;
  mobile: DataTableMobileConfig<T>;
  mobileBreakpoint?: ListingMobileBreakpoint;
  /** Use the existing card presentation inside narrow containers on desktop. */
  layout?: 'responsive' | 'cards';
  loading?: boolean;
  loadingRows?: number;
  updating?: boolean;
  error?: ReactNode;
  onRetry?: () => void;
  emptyState?: ReactNode;
  toolbar?: ReactNode;
  auxiliary?: ReactNode;
  pagination?: ReactNode;
  disabled?: boolean;
}

export function DataTable<T>({
  rows,
  columns,
  getRowId,
  ariaLabel,
  caption,
  density = 'comfortable',
  sort,
  onSortChange,
  selection,
  getRowClassName,
  rowActions,
  renderRowDetails,
  actionsLabel = 'Ações',
  mobile,
  mobileBreakpoint = 'md',
  layout = 'responsive',
  loading = false,
  loadingRows = 5,
  updating = false,
  error,
  onRetry,
  emptyState,
  toolbar,
  auxiliary,
  pagination,
  disabled = false,
  className,
  ...props
}: DataTableProps<T>) {
  const mobileViewport = useListingMobileViewport(mobileBreakpoint);
  const isMobile = layout === 'cards' || mobileViewport;
  const selectedIds = selection?.selectedRowIds ?? EMPTY_ROW_IDS;
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectableRows = selection
    ? rows.filter((row) => selection.isRowSelectable?.(row) ?? true)
    : [];
  const selectableIds = selectableRows.map(getRowId);
  const allVisibleSelected =
    selectableIds.length > 0 &&
    selectableIds.every((id) => selectedSet.has(id));
  const someVisibleSelected = selectableIds.some((id) => selectedSet.has(id));
  const selectionDisabled = disabled || selection?.disabled;
  const selectionGroupLabel = selection?.label ?? 'registros desta página';
  const columnCount =
    columns.length + (selection ? 1 : 0) + (rowActions ? 1 : 0);

  function updateRowSelection(rowId: ListingRowId) {
    if (!selection || selectionDisabled) return;
    selection.onSelectionChange(
      selectedSet.has(rowId)
        ? selectedIds.filter((selectedId) => selectedId !== rowId)
        : [...selectedIds, rowId]
    );
  }

  function updateVisibleSelection() {
    if (!selection || selectionDisabled) return;
    const nextSelection = new Set(selectedIds);
    if (allVisibleSelected) {
      selectableIds.forEach((id) => nextSelection.delete(id));
    } else {
      selectableIds.forEach((id) => nextSelection.add(id));
    }
    selection.onSelectionChange([...nextSelection]);
  }

  function handleSort(column: DataTableColumn<T>) {
    if (!column.sortable || !onSortChange || disabled) return;
    onSortChange({
      key: column.key,
      direction:
        sort?.key === column.key && sort.direction === 'asc' ? 'desc' : 'asc'
    });
  }

  const mobileRenderItem = (row: T, index: number) => {
    const content = mobile.renderItem(row, index);
    return {
      ...content,
      actions: content.actions ?? rowActions?.(row, index, { disabled }),
      details: content.details ?? renderRowDetails?.(row, index)
    };
  };

  return (
    <div
      {...props}
      className={joinClassNames(
        'fv-data-table',
        `fv-data-table--${density}`,
        className
      )}
      aria-busy={loading || updating || undefined}
      aria-disabled={disabled || undefined}
    >
      {toolbar || updating ? (
        <div className="fv-data-table__toolbar" inert={disabled || undefined}>
          <div className="fv-data-table__toolbar-content">{toolbar}</div>
          {updating ? (
            <div
              className="fv-data-table__updating"
              role="status"
              aria-live="polite"
            >
              <Spinner size="sm" decorative />
              <span>Atualizando…</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {loading && !isMobile ? (
        <span className="fv-sr-only" role="status" aria-live="polite">
          Carregando registros…
        </span>
      ) : null}

      {selection ? (
        <span className="fv-sr-only" role="status" aria-live="polite">
          {selectedIds.length}{' '}
          {selectedIds.length === 1
            ? 'registro selecionado'
            : 'registros selecionados'}
        </span>
      ) : null}

      {isMobile ? (
        <MobileList
          className="fv-data-table__mobile"
          items={rows}
          getItemId={getRowId}
          renderItem={mobileRenderItem}
          selection={selection}
          getItemClassName={getRowClassName}
          loading={loading}
          loadingItems={loadingRows}
          error={error}
          onRetry={onRetry}
          emptyState={emptyState}
          disabled={disabled}
          ariaLabel={mobile.ariaLabel ?? ariaLabel}
        />
      ) : (
        <div className="fv-data-table__desktop" inert={disabled || undefined}>
          <table className="fv-data-table__table" aria-label={ariaLabel}>
            {caption ? (
              <caption className="fv-data-table__caption">{caption}</caption>
            ) : null}
            <thead>
              <tr>
                {selection ? (
                  <th className="fv-data-table__selection" scope="col">
                    {selection.showSelectAll !== false ? (
                      <SelectionCheckbox
                        checked={allVisibleSelected}
                        indeterminate={
                          someVisibleSelected && !allVisibleSelected
                        }
                        disabled={
                          Boolean(selectionDisabled) ||
                          selectableIds.length === 0
                        }
                        label={
                          allVisibleSelected
                            ? `Desmarcar ${selectionGroupLabel}`
                            : `Selecionar ${selectionGroupLabel}`
                        }
                        className={selection.controlClassName}
                        onChange={updateVisibleSelection}
                      />
                    ) : (
                      <span className="fv-sr-only">Seleção</span>
                    )}
                  </th>
                ) : null}
                {columns.map((column) => {
                  const isActiveSort = sort?.key === column.key;
                  const ariaSort = isActiveSort
                    ? sort?.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : column.sortable
                      ? 'none'
                      : undefined;
                  const sortIcon = !isActiveSort
                    ? DS_ICONS.sort
                    : sort?.direction === 'asc'
                      ? DS_ICONS.sortAscending
                      : DS_ICONS.sortDescending;

                  return (
                    <th
                      className={joinClassNames(
                        `fv-data-table__cell--${column.align ?? (column.numeric ? 'right' : 'left')}`,
                        column.numeric && 'fv-data-table__cell--numeric'
                      )}
                      key={column.key}
                      scope="col"
                      aria-sort={ariaSort}
                    >
                      {column.sortable ? (
                        <button
                          className="fv-data-table__sort"
                          type="button"
                          disabled={disabled || !onSortChange}
                          aria-label={column.sortLabel}
                          onClick={() => handleSort(column)}
                        >
                          <span>{column.header}</span>
                          <AppIcon icon={sortIcon} size="sm" />
                        </button>
                      ) : (
                        column.header
                      )}
                    </th>
                  );
                })}
                {rowActions ? <th scope="col">{actionsLabel}</th> : null}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from(
                  { length: Math.max(1, Math.floor(loadingRows)) },
                  (_, rowIndex) => (
                    <tr key={rowIndex} aria-hidden="true">
                      {Array.from({ length: columnCount }, (_, cellIndex) => (
                        <td key={cellIndex}>
                          <Skeleton variant="text" lines={1} decorative />
                        </td>
                      ))}
                    </tr>
                  )
                )
              ) : error ? (
                <tr>
                  <td className="fv-data-table__state" colSpan={columnCount}>
                    <Alert
                      tone="danger"
                      title="Não foi possível carregar os registros"
                      action={
                        onRetry
                          ? { label: 'Tentar novamente', onClick: onRetry }
                          : undefined
                      }
                    >
                      {error}
                    </Alert>
                  </td>
                </tr>
              ) : !rows.length ? (
                <tr>
                  <td className="fv-data-table__state" colSpan={columnCount}>
                    {emptyState ?? (
                      <EmptyState
                        title="Nenhum registro encontrado"
                        description="Não há dados para exibir com os critérios atuais."
                      />
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((row, rowIndex) => {
                  const rowId = getRowId(row);
                  const isSelectable =
                    Boolean(selection) &&
                    !selectionDisabled &&
                    (selection?.isRowSelectable?.(row) ?? true);
                  const isSelected = selectedSet.has(rowId);
                  const rowLabel =
                    selection?.getRowLabel?.(row) ?? String(rowId);
                  const rowDetails = renderRowDetails?.(row, rowIndex);

                  return (
                    <Fragment key={rowId}>
                      <tr
                        className={joinClassNames(
                          isSelected && 'fv-data-table__row--selected',
                          getRowClassName?.(row, rowIndex)
                        )}
                        data-row-id={String(rowId)}
                        aria-selected={selection ? isSelected : undefined}
                      >
                        {selection ? (
                          <td className="fv-data-table__selection">
                            <SelectionCheckbox
                              checked={isSelected}
                              disabled={!isSelectable}
                              label={`${isSelected ? 'Desmarcar' : 'Selecionar'} ${rowLabel}`}
                              className={selection.controlClassName}
                              onChange={() => updateRowSelection(rowId)}
                            />
                          </td>
                        ) : null}
                        {columns.map((column) => {
                          const cellClassName = joinClassNames(
                            `fv-data-table__cell--${column.align ?? (column.numeric ? 'right' : 'left')}`,
                            column.numeric && 'fv-data-table__cell--numeric'
                          );
                          const cellContent = renderColumnValue(
                            column,
                            row,
                            rowIndex
                          );

                          return column.rowHeader ? (
                            <th
                              className={cellClassName}
                              key={column.key}
                              scope="row"
                            >
                              {cellContent}
                            </th>
                          ) : (
                            <td className={cellClassName} key={column.key}>
                              {cellContent}
                            </td>
                          );
                        })}
                        {rowActions ? (
                          <td>
                            <div className="fv-data-table__actions">
                              {rowActions(row, rowIndex, { disabled })}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                      {rowDetails !== null && rowDetails !== undefined ? (
                        <tr
                          className="fv-data-table__details-row"
                          data-details-for-row={String(rowId)}
                        >
                          <td
                            className="fv-data-table__details"
                            colSpan={columnCount}
                          >
                            {rowDetails}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {auxiliary ? (
        <div className="fv-data-table__auxiliary">{auxiliary}</div>
      ) : null}
      {pagination ? (
        <div
          className="fv-data-table__pagination"
          aria-disabled={disabled || undefined}
          inert={disabled || undefined}
        >
          {pagination}
        </div>
      ) : null}
    </div>
  );
}
