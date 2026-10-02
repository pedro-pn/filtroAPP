import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react';
import { createPortal } from 'react-dom';

import { IconButton } from '../components/ui/ds';
import { NAVIGATION_CHROME_ICONS } from './navigationIcons';
import type { NavigationModel } from './navigationModel';
import { Sidebar, type NavigationProfile } from './Sidebar';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

export interface NavigationDrawerProps {
  open: boolean;
  onClose: () => void;
  navigation: NavigationModel;
  profile?: NavigationProfile;
  utilityActions?: React.ReactNode;
  onLogout?: () => void | Promise<void>;
}

export function NavigationDrawer({
  open,
  onClose,
  navigation,
  profile,
  utilityActions,
  onLogout
}: NavigationDrawerProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusFrame = window.requestAnimationFrame(() => {
      const firstFocusable =
        panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (firstFocusable || panelRef.current)?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [onClose, open]);

  const trapFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) || []
    );
    if (!focusable.length) {
      event.preventDefault();
      panelRef.current?.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fv-ds fv-navigation-drawer-layer"
      data-state={open ? 'open' : 'closed'}
      role="presentation"
      aria-hidden={!open}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="fv-navigation-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapFocus}
      >
        <div className="fv-navigation-drawer__header">
          <h2 id={titleId}>Menu</h2>
          <IconButton
            icon={NAVIGATION_CHROME_ICONS.close}
            label="Fechar menu"
            onClick={onClose}
          />
        </div>
        <Sidebar
          navigation={navigation}
          profile={profile}
          utilityActions={utilityActions}
          onLogout={onLogout}
          onNavigate={onClose}
          className="fv-sidebar--drawer"
        />
      </div>
    </div>,
    document.body
  );
}
