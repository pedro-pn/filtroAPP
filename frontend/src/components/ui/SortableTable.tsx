import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  useState,
  type ReactElement,
  type ReactNode,
  type TableHTMLAttributes
} from 'react';
import {
  compareTableValues,
  tableSortText,
  type TableSortValue
} from '../../utils/tableSort';
import './SortableTable.css';

type TableElement = ReactElement<{
  children?: ReactNode;
  colSpan?: number;
  scope?: string;
  'data-sort-value'?: TableSortValue;
  'data-sortable'?: string;
  'aria-sort'?: 'ascending' | 'descending' | 'none';
}>;

interface SortableTableProps extends TableHTMLAttributes<HTMLTableElement> {
  /** Values for tables whose rows are rendered by separate components. */
  sortValues?: readonly (readonly TableSortValue[])[];
}

function firstRow(node: ReactNode): TableElement | undefined {
  if (!isValidElement(node)) return undefined;
  if (node.type === 'tr') return node as TableElement;
  if (node.type === Fragment) {
    return Children.toArray((node as TableElement).props.children)
      .map(firstRow)
      .find(Boolean);
  }
}

function cellValue(row: ReactNode, column: number): TableSortValue {
  const cell = Children.toArray(firstRow(row)?.props.children)[column];
  if (!isValidElement(cell)) return null;
  const props = (cell as TableElement).props;
  return Object.prototype.hasOwnProperty.call(props, 'data-sort-value')
    ? props['data-sort-value']
    : tableSortText(props.children);
}

/** Adds sorting while keeping each React row (and its expanded details) together. */
export function SortableTable({
  children,
  sortValues,
  className,
  ...props
}: SortableTableProps) {
  const [sort, setSort] = useState<{
    column: number;
    direction: 'asc' | 'desc';
  } | null>(null);

  function renderSection(node: ReactNode): ReactNode {
    if (!isValidElement(node)) return node;
    const section = node as TableElement;
    if (section.type === 'thead') {
      return cloneElement(
        section,
        {},
        Children.map(section.props.children, (headerRow) => {
          if (!isValidElement(headerRow) || headerRow.type !== 'tr')
            return headerRow;
          let column = 0;
          return cloneElement(
            headerRow as TableElement,
            {},
            Children.map(
              (headerRow as TableElement).props.children,
              (header) => {
                if (!isValidElement(header)) return header;
                const cell = header as TableElement;
                const index = column;
                column += cell.props.colSpan ?? 1;
                const label = tableSortText(cell.props.children);
                if (cell.props['aria-sort'])
                  return sort
                    ? cloneElement(cell, { 'aria-sort': 'none' })
                    : cell;
                if (
                  cell.props['data-sortable'] === 'false' ||
                  (cell.props.colSpan ?? 1) > 1 ||
                  !label ||
                  /^(?:ações?|documento|detalhes)$/i.test(label)
                )
                  return cell;
                const active = sort?.column === index;
                const nextDirection =
                  active && sort.direction === 'asc' ? 'desc' : 'asc';
                return cloneElement(
                  cell,
                  {
                    scope: 'col',
                    'aria-sort': active
                      ? sort.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  },
                  <button
                    type="button"
                    className="fv-table-sort"
                    onClick={() =>
                      setSort({ column: index, direction: nextDirection })
                    }
                    aria-label={`${label}: ordenar em ordem ${nextDirection === 'asc' ? 'crescente' : 'decrescente'}`}
                  >
                    <span>{cell.props.children}</span>
                    <span aria-hidden="true">
                      {active ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </button>
                );
              }
            )
          );
        })
      );
    }
    if (section.type !== 'tbody' || !sort) return section;
    const rows = Children.toArray(section.props.children);
    const sortable = rows
      .map((row, index) => ({ row, index }))
      .filter(
        ({ row, index }) =>
          sortValues?.[index] ||
          (firstRow(row) &&
            !Children.toArray(firstRow(row)!.props.children).some(
              (cell) =>
                isValidElement(cell) &&
                ((cell as TableElement).props.colSpan ?? 1) > 1
            ))
      );
    const sorted = [...sortable].sort(
      (a, b) =>
        compareTableValues(
          sortValues
            ? sortValues[a.index]?.[sort.column]
            : cellValue(a.row, sort.column),
          sortValues
            ? sortValues[b.index]?.[sort.column]
            : cellValue(b.row, sort.column),
          sort.direction
        ) || a.index - b.index
    );
    const sortableIndexes = new Set(sortable.map(({ index }) => index));
    let next = 0;
    return cloneElement(
      section,
      {},
      rows.map((row, index) =>
        sortableIndexes.has(index) ? sorted[next++].row : row
      )
    );
  }

  return (
    <table {...props} className={className}>
      {Children.map(children, renderSection)}
    </table>
  );
}
