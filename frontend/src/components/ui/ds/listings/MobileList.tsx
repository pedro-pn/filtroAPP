import type { HTMLAttributes, ReactNode } from 'react';

import { Alert } from '../Alert';
import { Card } from '../Card';
import { EmptyState } from '../EmptyState';
import { Skeleton } from '../Skeleton';
import { joinClassNames } from '../utils';
import type {
  ListingRowId,
  ListingSelection,
  MobileListItemContent
} from './types';
import './listings.css';

export interface MobileListProps<T> extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'children'
> {
  items: readonly T[];
  getItemId: (item: T) => ListingRowId;
  renderItem: (item: T, index: number) => MobileListItemContent;
  selection?: ListingSelection<T>;
  getItemClassName?: (item: T, index: number) => string | undefined;
  loading?: boolean;
  loadingItems?: number;
  error?: ReactNode;
  onRetry?: () => void;
  emptyState?: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
}

function hasContent(value: ReactNode) {
  return value !== null && value !== undefined;
}

function toggleSelection(
  selectedIds: readonly ListingRowId[],
  rowId: ListingRowId
) {
  return selectedIds.includes(rowId)
    ? selectedIds.filter((selectedId) => selectedId !== rowId)
    : [...selectedIds, rowId];
}

export function MobileList<T>({
  items,
  getItemId,
  renderItem,
  selection,
  getItemClassName,
  loading = false,
  loadingItems = 3,
  error,
  onRetry,
  emptyState,
  disabled = false,
  ariaLabel = 'Lista de registros',
  className,
  ...props
}: MobileListProps<T>) {
  if (loading) {
    return (
      <div
        {...props}
        className={joinClassNames('fv-mobile-list', className)}
        role="status"
        aria-live="polite"
        aria-busy="true"
        aria-disabled={disabled || undefined}
        inert={disabled || undefined}
      >
        <span className="fv-sr-only">Carregando registros…</span>
        <div className="fv-mobile-list__loading" aria-hidden="true">
          <Skeleton variant="card" lines={loadingItems} decorative />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        {...props}
        className={joinClassNames('fv-mobile-list', className)}
        aria-disabled={disabled || undefined}
        inert={disabled || undefined}
      >
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
      </div>
    );
  }

  if (!items.length) {
    return (
      <div
        {...props}
        className={joinClassNames('fv-mobile-list', className)}
        aria-disabled={disabled || undefined}
        inert={disabled || undefined}
      >
        {emptyState ?? (
          <EmptyState
            title="Nenhum registro encontrado"
            description="Não há dados para exibir com os critérios atuais."
          />
        )}
      </div>
    );
  }

  return (
    <div
      {...props}
      className={joinClassNames('fv-mobile-list', className)}
      aria-disabled={disabled || undefined}
      inert={disabled || undefined}
    >
      <ul className="fv-mobile-list__items" aria-label={ariaLabel}>
        {items.map((item, index) => {
          const itemId = getItemId(item);
          const content = renderItem(item, index);
          const selectable =
            Boolean(selection) &&
            !selection?.disabled &&
            (selection?.isRowSelectable?.(item) ?? true);
          const selected = selection?.selectedRowIds.includes(itemId) ?? false;
          const selectionLabel =
            selection?.getRowLabel?.(item) ??
            content.accessibleLabel ??
            String(itemId);
          const primaryContent = (
            <>
              <span className="fv-mobile-list__title">{content.title}</span>
              {hasContent(content.subtitle) ? (
                <span className="fv-mobile-list__subtitle">
                  {content.subtitle}
                </span>
              ) : null}
            </>
          );

          return (
            <li
              className={joinClassNames(
                'fv-mobile-list__item',
                getItemClassName?.(item, index)
              )}
              key={itemId}
              data-row-id={String(itemId)}
              aria-selected={selection ? selected : undefined}
            >
              <Card variant="flat" padding="sm" selected={selected}>
                <div className="fv-mobile-list__header">
                  {selection ? (
                    <label
                      className={joinClassNames(
                        'fv-listing-checkbox',
                        selection.controlClassName
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={!selectable}
                        aria-label={`${selected ? 'Desmarcar' : 'Selecionar'} ${selectionLabel}`}
                        onChange={() =>
                          selection.onSelectionChange(
                            toggleSelection(selection.selectedRowIds, itemId)
                          )
                        }
                      />
                    </label>
                  ) : null}

                  <div className="fv-mobile-list__primary">
                    {content.href ? (
                      <a
                        className="fv-mobile-list__primary-action"
                        href={content.href}
                        aria-label={content.accessibleLabel}
                      >
                        {primaryContent}
                      </a>
                    ) : content.onClick ? (
                      <button
                        className="fv-mobile-list__primary-action"
                        type="button"
                        aria-label={content.accessibleLabel}
                        onClick={content.onClick}
                      >
                        {primaryContent}
                      </button>
                    ) : (
                      <div className="fv-mobile-list__primary-copy">
                        {primaryContent}
                      </div>
                    )}
                  </div>

                  {hasContent(content.status) ? (
                    <div className="fv-mobile-list__status">
                      {content.status}
                    </div>
                  ) : null}
                </div>

                {hasContent(content.value) ? (
                  <div className="fv-mobile-list__value">{content.value}</div>
                ) : null}

                {content.metadata?.length ? (
                  <dl className="fv-mobile-list__metadata">
                    {content.metadata.map((metadata, metadataIndex) => (
                      <div
                        className="fv-mobile-list__metadata-item"
                        key={metadataIndex}
                      >
                        <dt>{metadata.label}</dt>
                        <dd>{metadata.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}

                {content.actions ? (
                  <div className="fv-mobile-list__actions">
                    {content.actions}
                  </div>
                ) : null}

                {hasContent(content.details) ? (
                  <div className="fv-mobile-list__details">
                    {content.details}
                  </div>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
