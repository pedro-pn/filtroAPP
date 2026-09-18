import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Tooltip genérico renderizado em portal (posição fixa + clamp na viewport), para nunca ser cortado
// por overflow de containers/modais nem pela borda da tela (importante no mobile). Aceita conteúdo
// arbitrário no balão. O gatilho é `children`.
export function PortalTip({ children, content, triggerClassName, balloonClassName, ariaLabel, triggerTabIndex = 0, preferredPlacement = 'auto', interactive = false }: {
  children: ReactNode;
  content: ReactNode;
  triggerClassName?: string;
  balloonClassName?: string;
  ariaLabel?: string;
  triggerTabIndex?: number;
  preferredPlacement?: 'auto' | 'above' | 'below';
  interactive?: boolean;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const balloonRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; placement: 'above' | 'below'; maxHeight: number } | null>(null);

  const position = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const placement: 'above' | 'below' = preferredPlacement === 'auto'
      ? (r.top > 150 ? 'above' : 'below')
      : preferredPlacement;
    const top = placement === 'above' ? r.top - 8 : r.bottom + 8;
    setPos({
      top,
      left: r.left + r.width / 2,
      placement,
      maxHeight: placement === 'above'
        ? Math.max(0, r.top - 16)
        : Math.max(0, window.innerHeight - top - 8)
    });
  }, [preferredPlacement]);

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current === null) return;
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);
  const show = useCallback(() => {
    cancelHide();
    position();
    setOpen(true);
  }, [cancelHide, position]);
  const hide = useCallback(() => {
    cancelHide();
    if (!interactive) {
      setOpen(false);
      return;
    }
    hideTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      hideTimerRef.current = null;
    }, 120);
  }, [cancelHide, interactive]);

  useEffect(() => () => cancelHide(), [cancelHide]);

  useEffect(() => {
    if (!open) return;
    const handler = () => position();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [open, position]);

  // Mantém o balão dentro da viewport (clamp horizontal) após medir a largura.
  useLayoutEffect(() => {
    if (!open || !pos) return;
    const b = balloonRef.current;
    if (!b) return;
    const half = b.offsetWidth / 2;
    const min = 8 + half;
    const max = window.innerWidth - 8 - half;
    const clamped = Math.max(min, Math.min(pos.left, max));
    if (Math.abs(clamped - pos.left) > 0.5) setPos(p => (p ? { ...p, left: clamped } : p));
  }, [open, pos]);

  return (
    <>
      <span
        ref={triggerRef}
        className={triggerClassName}
        tabIndex={triggerTabIndex}
        aria-label={ariaLabel}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {open && pos
        ? createPortal(
          <div
            ref={balloonRef}
            className={['help-tip-portal', pos.placement, interactive ? 'is-interactive' : '', balloonClassName].filter(Boolean).join(' ')}
            style={{ top: pos.top, left: pos.left, maxHeight: pos.maxHeight }}
            role="tooltip"
            onMouseEnter={interactive ? cancelHide : undefined}
            onMouseLeave={interactive ? hide : undefined}
          >
            {content}
          </div>,
          document.body
        )
        : null}
    </>
  );
}
