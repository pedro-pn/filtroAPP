import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

import { IconButton } from './ds/Button';
import { DS_ICONS } from './ds/icons';
import { joinClassNames } from './ds/utils';
import './ds/modal.css';

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

let bodyScrollLocks = 0;
let originalBodyOverflow = '';

function lockBodyScroll() {
  if (typeof document === 'undefined') return () => undefined;

  if (bodyScrollLocks === 0) {
    originalBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  bodyScrollLocks += 1;

  return () => {
    bodyScrollLocks = Math.max(0, bodyScrollLocks - 1);
    if (bodyScrollLocks === 0)
      document.body.style.overflow = originalBodyOverflow;
  };
}

function visibleFocusableElements(panel: HTMLElement) {
  return Array.from(
    panel.querySelectorAll<HTMLElement>(focusableSelector)
  ).filter(
    (element) =>
      !element.matches(':disabled') &&
      !element.closest('[hidden], [inert]') &&
      element.getAttribute('aria-hidden') !== 'true' &&
      element.tabIndex !== -1 &&
      element.getClientRects().length > 0
  );
}

export type ModalSize = 'sm' | 'md' | 'lg' | 'full';
export type ModalAppearance = 'legacy' | 'design-system';

export interface ModalProps {
  open: boolean;
  children: ReactNode;
  onClose: () => void;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  ariaLabel?: string;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  backdropClassName?: string;
  panelClassName?: string;
  appearance?: ModalAppearance;
  title?: ReactNode;
  size?: ModalSize;
  footer?: ReactNode;
  headerActions?: ReactNode;
  showCloseButton?: boolean;
  closeLabel?: string;
  fullscreenOnMobile?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

export function Modal({
  open,
  children,
  onClose,
  ariaLabelledBy,
  ariaDescribedBy,
  ariaLabel,
  closeOnBackdrop = false,
  closeOnEscape = true,
  backdropClassName,
  panelClassName,
  appearance = 'legacy',
  title,
  size = 'md',
  footer,
  headerActions,
  showCloseButton = true,
  closeLabel = 'Fechar',
  fullscreenOnMobile = true,
  initialFocusRef
}: ModalProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const generatedTitleId = useId().replace(/:/g, '');
  const isDesignSystem = appearance === 'design-system';
  const resolvedTitleId =
    ariaLabelledBy ??
    (isDesignSystem && title ? `fv-modal-${generatedTitleId}` : undefined);

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const unlockBodyScroll = lockBodyScroll();
    const frame = window.requestAnimationFrame(() => {
      const initialFocus = initialFocusRef?.current;
      const firstFocusable = panelRef.current ? visibleFocusableElements(panelRef.current)[0] : undefined;
      (initialFocus ?? firstFocusable ?? panelRef.current)?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      unlockBodyScroll();
      const previousFocus = previousFocusRef.current;
      if (previousFocus && document.contains(previousFocus))
        previousFocus.focus();
    };
  }, [initialFocusRef, open]);

  if (!open || typeof document === 'undefined') return null;

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    // React portal events bubble through their owning dialog, even though the
    // nested dialog is outside its DOM tree. Only the nearest dialog handles keys.
    if (event.target instanceof Element
      && event.target.closest('[role="dialog"], [role="alertdialog"]') !== event.currentTarget) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (closeOnEscape) onClose();
      return;
    }

    if (event.key !== 'Tab') return;
    event.stopPropagation();
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = visibleFocusableElements(panel);

    if (!focusable.length) {
      event.preventDefault();
      panelRef.current?.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const backdropClasses = isDesignSystem
    ? joinClassNames('fv-ds', 'fv-modal-backdrop', backdropClassName)
    : (backdropClassName ?? 'modal-backdrop');
  const panelClasses = isDesignSystem
    ? joinClassNames(
        'fv-modal',
        `fv-modal--${size}`,
        fullscreenOnMobile && 'fv-modal--mobile-fullscreen',
        panelClassName
      )
    : (panelClassName ?? 'modal-card');

  return createPortal(
    <div
      className={backdropClasses}
      data-fv-ds={isDesignSystem ? '' : undefined}
      role="presentation"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={panelRef}
        className={panelClasses}
        role="dialog"
        aria-modal="true"
        aria-labelledby={resolvedTitleId}
        aria-describedby={ariaDescribedBy}
        aria-label={ariaLabel}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {isDesignSystem ? (
          <>
            <header className="fv-modal__header">
              <div className="fv-modal__title" id={resolvedTitleId}>
                {title}
              </div>
              {headerActions ? (
                <div className="fv-modal__header-actions">{headerActions}</div>
              ) : null}
              {showCloseButton ? (
                <IconButton
                  icon={DS_ICONS.close}
                  label={closeLabel}
                  size="md"
                  onClick={onClose}
                />
              ) : null}
            </header>
            <div className="fv-modal__body">{children}</div>
            {footer ? (
              <footer className="fv-modal__footer">{footer}</footer>
            ) : null}
          </>
        ) : (
          children
        )}
      </section>
    </div>,
    document.body
  );
}
