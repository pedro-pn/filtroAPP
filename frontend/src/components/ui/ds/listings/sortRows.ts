import {
  compareTableValues,
  tableSortText,
  type TableSortValue
} from '../../../../utils/tableSort';
import type { DataTableColumn, DataTableSort } from './types';

function scalarValue(value: unknown): TableSortValue {
  if (
    value == null ||
    value instanceof Date ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  )
    return value;
  return String(value);
}

export function columnSortValue<T>(
  column: DataTableColumn<T>,
  row: T,
  index: number
): TableSortValue {
  if (column.sortValue) return column.sortValue(row);
  if (column.accessor) {
    const value =
      typeof column.accessor === 'function'
        ? column.accessor(row)
        : row[column.accessor];
    return scalarValue(value);
  }
  if (column.render) return tableSortText(column.render(row, index));
  return scalarValue(row[column.key as keyof T]);
}

/** Sort the full result before pagination; preserve input order for ties. */
export function sortTableRows<T>(
  rows: readonly T[],
  columns: readonly DataTableColumn<T>[],
  sort?: DataTableSort | null
): readonly T[] {
  const column =
    sort &&
    columns.find(
      (candidate) => candidate.key === sort.key && candidate.sortable !== false
    );
  if (!sort || !column) return rows;
  return rows
    .map((row, index) => ({
      row,
      index,
      value: columnSortValue(column, row, index)
    }))
    .sort(
      (a, b) =>
        compareTableValues(a.value, b.value, sort.direction) ||
        a.index - b.index
    )
    .map(({ row }) => row);
}
