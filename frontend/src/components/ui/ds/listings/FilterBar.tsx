import {
  useEffect,
  useId,
  useRef,
  useState,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode
} from 'react';

import { AppIcon } from '../../../icons/AppIcon';
import { Badge } from '../Badge';
import { Button, IconButton } from '../Button';
import { DS_ICONS } from '../icons';
import { Spinner } from '../Spinner';
import { joinClassNames } from '../utils';
import {
  useListingMobileViewport,
  type ListingMobileBreakpoint
} from './useListingMedia';
import './listings.css';

export interface ActiveFilter {
  id: string;
  label: ReactNode;
  onRemove: () => void;
  removeLabel?: string;
}

export interface FilterBarProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'children'
> {
  search?: ReactNode;
  children?: ReactNode;
  activeFilters?: readonly ActiveFilter[];
  activeCount?: number;
  onClear?: () => void;
  clearLabel?: string;
  actions?: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  label?: string;
  resultsId?: string;
  mobileTitle?: string;
  mobileDescription?: string;
  mobileApplyLabel?: string;
  mobileBreakpoint?: ListingMobileBreakpoint;
  mobileOpen?: boolean;
  defaultMobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
  onMobileApply?: () => void;
}

export function FilterBar({
  search,
  children,
  activeFilters = [],
  activeCount,
  onClear,
  clearLabel = 'Limpar filtros',
  actions,
  disabled = false,
  loading = false,
  label = 'Filtros da listagem',
  resultsId,
  mobileTitle = 'Filtros',
  mobileDescription = 'Refine os registros exibidos.',
  mobileApplyLabel = 'Ver resultados',
  mobileBreakpoint = 'md',
  mobileOpen,
  defaultMobileOpen = false,
  onMobileOpenChange,
  onMobileApply,
  className,
  ...props
}: FilterBarProps) {
  const isMobile = useListingMobileViewport(mobileBreakpoint);
  const [internalOpen, setInternalOpen] = useState(defaultMobileOpen);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const panelId = useId();
  const isControlled = mobileOpen !== undefined;
  const open = isControlled ? mobileOpen : internalOpen;
  const sheetOpen = open && !disabled;
  const resolvedActiveCount = Math.max(0, activeCount ?? activeFilters.length);

  function setOpen(nextOpen: boolean) {
    if (!isControlled) setInternalOpen(nextOpen);
    onMobileOpenChange?.(nextOpen);
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !isMobile) return;

    if (sheetOpen && !dialog.open) {
      dialog.showModal();
    } else if (!sheetOpen && dialog.open) {
      dialog.close();
    }
  }, [isMobile, sheetOpen]);

  useEffect(() => {
    if (!isMobile || !sheetOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobile, sheetOpen]);

  useEffect(() => {
    if (!isMobile && open) {
      if (!isControlled) setInternalOpen(false);
      onMobileOpenChange?.(false);
    }
  }, [isControlled, isMobile, onMobileOpenChange, open]);

  function closeSheet() {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function handleDialogClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) closeSheet();
  }

  function handleApply() {
    onMobileApply?.();
    closeSheet();
  }

  const controls = children ? (
    <div className="fv-filter-bar__controls">{children}</div>
  ) : null;

  return (
    <div
      {...props}
      className={joinClassNames('fv-filter-bar', className)}
      role="region"
      aria-label={label}
      aria-controls={resultsId}
      aria-busy={loading || undefined}
      aria-disabled={disabled || undefined}
      inert={disabled || undefined}
    >
      <div className="fv-filter-bar__main">
        {search ? <div className="fv-filter-bar__search">{search}</div> : null}

        {!isMobile ? controls : null}

        {isMobile && children ? (
          <Button
            ref={triggerRef}
            className="fv-filter-bar__mobile-trigger"
            variant="secondary"
            iconLeft={<AppIcon icon={DS_ICONS.filter} size="sm" />}
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            aria-controls={panelId}
            disabled={disabled}
            onClick={() => setOpen(true)}
          >
            Filtros
            {resolvedActiveCount ? (
              <Badge
                tone="brand"
                aria-label={`${resolvedActiveCount} filtros ativos`}
              >
                {resolvedActiveCount}
              </Badge>
            ) : null}
          </Button>
        ) : null}

        {loading ? (
          <span
            className="fv-filter-bar__loading"
            role="status"
            aria-live="polite"
          >
            <Spinner size="sm" decorative />
            <span>Atualizando…</span>
          </span>
        ) : null}

        {actions ? (
          <div className="fv-filter-bar__actions">{actions}</div>
        ) : null}

        {onClear && resolvedActiveCount > 0 ? (
          <Button
            className="fv-filter-bar__clear"
            variant="link"
            size="sm"
            disabled={disabled}
            onClick={onClear}
          >
            {clearLabel}
          </Button>
        ) : null}
      </div>

      {activeFilters.length ? (
        <div className="fv-filter-bar__chips" aria-label="Filtros ativos">
          {activeFilters.map((filter) => (
            <Badge
              key={filter.id}
              tone="brand"
              onRemove={filter.onRemove}
              removeLabel={
                filter.removeLabel ??
                (typeof filter.label === 'string' ||
                typeof filter.label === 'number'
                  ? `Remover filtro ${filter.label}`
                  : 'Remover filtro ativo')
              }
            >
              {filter.label}
            </Badge>
          ))}
        </div>
      ) : null}

      {resultsId ? (
        <span className="fv-sr-only" aria-live="polite">
          {resolvedActiveCount
            ? `${resolvedActiveCount} filtros ativos`
            : 'Nenhum filtro ativo'}
        </span>
      ) : null}

      {isMobile && children ? (
        <dialog
          ref={dialogRef}
          className="fv-filter-sheet"
          id={panelId}
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          aria-disabled={disabled || undefined}
          inert={disabled || undefined}
          onCancel={(event) => {
            event.preventDefault();
            closeSheet();
          }}
          onClose={() => {
            if (open) setOpen(false);
          }}
          onClick={handleDialogClick}
        >
          <div className="fv-filter-sheet__panel">
            <header className="fv-filter-sheet__header">
              <div className="fv-filter-sheet__heading">
                <h2 id={titleId}>{mobileTitle}</h2>
                <p id={descriptionId}>{mobileDescription}</p>
              </div>
              <IconButton
                autoFocus
                icon={DS_ICONS.close}
                label="Fechar filtros"
                onClick={closeSheet}
              />
            </header>
            <div className="fv-filter-sheet__body">{controls}</div>
            <footer className="fv-filter-sheet__footer">
              {onClear && resolvedActiveCount > 0 ? (
                <Button
                  variant="secondary"
                  disabled={disabled}
                  onClick={onClear}
                >
                  {clearLabel}
                </Button>
              ) : null}
              <Button
                variant="primary"
                disabled={disabled}
                onClick={handleApply}
              >
                {mobileApplyLabel}
              </Button>
            </footer>
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
