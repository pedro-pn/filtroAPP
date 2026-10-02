import type { HTMLAttributes } from 'react';

import { IconButton } from '../Button';
import { DS_ICONS } from '../icons';
import { Select } from '../Select';
import { Spinner } from '../Spinner';
import { joinClassNames } from '../utils';
import './listings.css';

type PaginationItem = number | 'ellipsis-start' | 'ellipsis-end';

function paginationItems(page: number, totalPages: number): PaginationItem[] {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const candidates = new Set([1, totalPages, page - 1, page, page + 1]);
  const pages = [...candidates]
    .filter((candidate) => candidate >= 1 && candidate <= totalPages)
    .sort((left, right) => left - right);
  const items: PaginationItem[] = [];

  pages.forEach((candidate, index) => {
    const previous = pages[index - 1];
    if (previous && candidate - previous > 1) {
      items.push(index === 1 ? 'ellipsis-start' : 'ellipsis-end');
    }
    items.push(candidate);
  });

  return items;
}

export interface PaginationProps extends Omit<
  HTMLAttributes<HTMLElement>,
  'onChange'
> {
  page: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  pageSizeOptions?: readonly number[];
  onPageSizeChange?: (pageSize: number) => void;
  showFirstLast?: boolean;
  disabled?: boolean;
  loading?: boolean;
  label?: string;
}

export function Pagination({
  page,
  total,
  pageSize,
  onPageChange,
  pageSizeOptions = [10, 25, 50],
  onPageSizeChange,
  showFirstLast = true,
  disabled = false,
  loading = false,
  label = 'Paginação',
  className,
  ...props
}: PaginationProps) {
  const safeTotal = Math.max(0, total);
  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const firstItem = safeTotal ? (currentPage - 1) * safePageSize + 1 : 0;
  const lastItem = Math.min(currentPage * safePageSize, safeTotal);
  const isDisabled = disabled || loading || safeTotal === 0;
  const items = paginationItems(currentPage, totalPages);
  const resolvedPageSizeOptions = [
    ...new Set([...pageSizeOptions, safePageSize])
  ].sort((left, right) => left - right);

  function goTo(nextPage: number) {
    if (isDisabled) return;
    onPageChange(Math.min(Math.max(1, nextPage), totalPages));
  }

  return (
    <nav
      {...props}
      className={joinClassNames('fv-pagination', className)}
      aria-label={label}
      aria-busy={loading || undefined}
      aria-disabled={disabled || undefined}
    >
      <div className="fv-pagination__summary" aria-live="polite">
        {loading ? <Spinner size="sm" decorative /> : null}
        <span>
          Página <strong>{currentPage}</strong> de <strong>{totalPages}</strong>
        </span>
        <span className="fv-pagination__total">
          {firstItem}–{lastItem} de {safeTotal}{' '}
          {safeTotal === 1 ? 'registro' : 'registros'}
        </span>
      </div>

      <div className="fv-pagination__controls">
        {showFirstLast ? (
          <IconButton
            className="fv-pagination__edge"
            icon={DS_ICONS.firstPage}
            label="Ir para a primeira página"
            size="sm"
            disabled={isDisabled || currentPage === 1}
            onClick={() => goTo(1)}
          />
        ) : null}
        <IconButton
          icon={DS_ICONS.previous}
          label="Ir para a página anterior"
          size="sm"
          disabled={isDisabled || currentPage === 1}
          onClick={() => goTo(currentPage - 1)}
        />

        <div
          className="fv-pagination__pages"
          role="group"
          aria-label="Páginas disponíveis"
        >
          {items.map((item) =>
            typeof item === 'number' ? (
              <button
                className="fv-pagination__page"
                type="button"
                key={item}
                aria-label={`Ir para a página ${item}`}
                aria-current={item === currentPage ? 'page' : undefined}
                disabled={isDisabled}
                onClick={() => goTo(item)}
              >
                {item}
              </button>
            ) : (
              <span
                className="fv-pagination__ellipsis"
                key={item}
                aria-hidden="true"
              >
                …
              </span>
            )
          )}
        </div>

        <IconButton
          icon={DS_ICONS.next}
          label="Ir para a próxima página"
          size="sm"
          disabled={isDisabled || currentPage === totalPages}
          onClick={() => goTo(currentPage + 1)}
        />
        {showFirstLast ? (
          <IconButton
            className="fv-pagination__edge"
            icon={DS_ICONS.lastPage}
            label="Ir para a última página"
            size="sm"
            disabled={isDisabled || currentPage === totalPages}
            onClick={() => goTo(totalPages)}
          />
        ) : null}
      </div>

      {onPageSizeChange ? (
        <label className="fv-pagination__page-size">
          <span>Itens por página</span>
          <Select
            size="sm"
            aria-label="Itens por página"
            value={String(safePageSize)}
            disabled={disabled || loading}
            options={resolvedPageSizeOptions.map((option) => ({
              value: String(option),
              label: String(option)
            }))}
            onChange={(event) =>
              onPageSizeChange(Number.parseInt(event.target.value, 10))
            }
          />
        </label>
      ) : null}
    </nav>
  );
}
