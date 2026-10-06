import { isValidElement, type ReactNode } from 'react';

export type TableSortValue =
  string | number | bigint | boolean | Date | null | undefined;

const collator = new Intl.Collator('pt-BR', {
  numeric: true,
  sensitivity: 'base'
});

/** Read labels without executing components or including decorative icons. */
export function tableSortText(node: ReactNode): string {
  if (
    typeof node === 'string' ||
    typeof node === 'number' ||
    typeof node === 'bigint'
  )
    return String(node);
  if (Array.isArray(node)) return node.map(tableSortText).join('');
  if (
    !isValidElement<{
      children?: ReactNode;
      label?: string;
      value?: string | number;
      'aria-hidden'?: boolean | 'true';
    }>(node)
  )
    return '';
  if (
    node.props['aria-hidden'] === true ||
    node.props['aria-hidden'] === 'true'
  )
    return '';
  return tableSortText(
    node.props.children ?? node.props.label ?? node.props.value
  );
}

function comparable(value: TableSortValue): string | number | bigint | null {
  if (value == null) return null;
  if (value instanceof Date)
    return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'boolean') return Number(value);
  const text = value.trim();
  if (!text || text === '—' || text === '-') return null;
  const date = text.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:,?\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (date)
    return Date.UTC(
      +date[3],
      +date[2] - 1,
      +date[1],
      +(date[4] ?? 0),
      +(date[5] ?? 0),
      +(date[6] ?? 0)
    );
  if (/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(text)) {
    const timestamp = Date.parse(text);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  const time = text.match(/^(-?\d+):(\d{2})$/);
  if (time) return +time[1] * 60 + +time[2];
  const numeric = text
    .replace(/^R\$\s*/, '')
    .replace(/\s*(?:%|h|\/h|L|m|un|dias?)$/i, '')
    .trim();
  if (/^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/.test(numeric))
    return Number(numeric.replaceAll('.', '').replace(',', '.'));
  if (/^[+-]?\d+\.\d+$/.test(numeric)) return Number(numeric);
  return text;
}

export function compareTableValues(
  left: TableSortValue,
  right: TableSortValue,
  direction: 'asc' | 'desc'
): number {
  const a = comparable(left);
  const b = comparable(right);
  // Missing values stay at the end in either direction.
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  const comparison =
    typeof a !== 'string' && typeof b !== 'string'
      ? a < b
        ? -1
        : a > b
          ? 1
          : 0
      : collator.compare(String(a), String(b));
  return direction === 'asc' ? comparison : -comparison;
}
