import type { ReactNode } from 'react';

export type ListingRowId = string | number;

export interface ListingSelection<T> {
  selectedRowIds: readonly ListingRowId[];
  onSelectionChange: (rowIds: ListingRowId[]) => void;
  isRowSelectable?: (row: T) => boolean;
  getRowLabel?: (row: T) => string;
  label?: string;
  controlClassName?: string;
  showSelectAll?: boolean;
  disabled?: boolean;
}

export interface MobileListMetadata {
  label: ReactNode;
  value: ReactNode;
}

export interface MobileListItemContent {
  title: ReactNode;
  subtitle?: ReactNode;
  metadata?: readonly MobileListMetadata[];
  status?: ReactNode;
  value?: ReactNode;
  actions?: ReactNode;
  details?: ReactNode;
  href?: string;
  onClick?: () => void;
  accessibleLabel?: string;
}

export type DataTableAlign = 'left' | 'center' | 'right';
export type DataTableDensity = 'comfortable' | 'compact';
export type DataTableSortDirection = 'asc' | 'desc';

export interface DataTableSort {
  key: string;
  direction: DataTableSortDirection;
}

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  accessor?: keyof T | ((row: T) => unknown);
  render?: (row: T, index: number) => ReactNode;
  align?: DataTableAlign;
  sortable?: boolean;
  sortLabel?: string;
  numeric?: boolean;
  rowHeader?: boolean;
}

export interface DataTableMobileConfig<T> {
  renderItem: (row: T, index: number) => MobileListItemContent;
  ariaLabel?: string;
}
