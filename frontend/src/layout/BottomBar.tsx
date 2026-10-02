import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';

import { AppIcon } from '../components/icons/AppIcon';
import { Badge } from '../components/ui/ds';
import { Modal } from '../components/ui/Modal';
import { NAVIGATION_CHROME_ICONS, navigationSectionIcon } from './navigationIcons';
import { mobileSectionNavigation, type NavigationModel } from './navigationModel';
import { scrollPageTo } from './pageScroll';

interface LegacyBottomBarProps {
  appearance?: 'legacy';
  children: ReactNode;
}

interface DesignSystemBottomBarProps {
  appearance: 'design-system';
  navigation: NavigationModel;
}

export type BottomBarProps = LegacyBottomBarProps | DesignSystemBottomBarProps;

const MORE_SHEET_TRANSITION_MS = 280;
type MoreSheetPhase = 'closed' | 'opening' | 'open' | 'closing';

function DesignSystemBottomBar({
  navigation
}: DesignSystemBottomBarProps) {
  const navigate = useNavigate();
  const sections = mobileSectionNavigation(navigation);
  const [morePhase, setMorePhase] = useState<MoreSheetPhase>('closed');
  const moreMounted = morePhase !== 'closed';
  const pendingActionRef = useRef<(() => void) | null>(null);
  const activeSection = sections?.allItems.find(item => item.active);

  useEffect(() => {
    pendingActionRef.current = null;
    setMorePhase('closed');
  }, [sections?.module.id, activeSection?.id]);
  useEffect(() => {
    if (morePhase !== 'opening') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setMorePhase('open');
      return;
    }
    let nextFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      nextFrame = window.requestAnimationFrame(() => setMorePhase('open'));
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(nextFrame);
    };
  }, [morePhase]);
  useEffect(() => {
    if (morePhase !== 'closing') return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timeout = window.setTimeout(() => {
      setMorePhase('closed');
      const action = pendingActionRef.current;
      pendingActionRef.current = null;
      action?.();
    }, reduceMotion ? 0 : MORE_SHEET_TRANSITION_MS);
    return () => window.clearTimeout(timeout);
  }, [morePhase]);
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 768px)');
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setMorePhase('closed');
    };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);
  useEffect(() => {
    if (!moreMounted) return;
    const root = document.documentElement;
    const body = document.body;
    const scrollY = window.scrollY;
    const previous = {
      rootOverflow: root.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyWidth: body.style.width
    };
    root.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    return () => {
      root.style.overflow = previous.rootOverflow;
      body.style.position = previous.bodyPosition;
      body.style.top = previous.bodyTop;
      body.style.width = previous.bodyWidth;
      window.scrollTo(0, scrollY);
    };
  }, [moreMounted]);
  useEffect(() => {
    if (morePhase !== 'open') return;
    const backdrop = document.querySelector<HTMLElement>('.fv-bottom-bar__sheet-backdrop');
    const sheet = backdrop?.querySelector<HTMLElement>('.fv-bottom-bar__sheet');
    const header = sheet?.querySelector<HTMLElement>('.fv-modal__header');
    const list = sheet?.querySelector<HTMLElement>('.fv-modal__body');
    if (!sheet || !header || !list) return;

    let pointerId: number | null = null;
    let startY = 0;
    let startTime = 0;
    let distance = 0;
    const settleDrag = (dragDistance: number, elapsed: number, cancelled: boolean) => {
      sheet.style.removeProperty('transition');
      if (!cancelled && (dragDistance > 96 || (dragDistance > 32 && dragDistance / Math.max(1, elapsed) > 0.6))) {
        setMorePhase('closing');
      } else {
        sheet.style.removeProperty('--fv-sheet-drag-y');
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button, a'))) return;
      pointerId = event.pointerId;
      startY = event.clientY;
      startTime = event.timeStamp;
      distance = 0;
      header.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      distance = Math.max(0, event.clientY - startY);
      if (distance === 0) {
        sheet.style.removeProperty('--fv-sheet-drag-y');
        return;
      }
      sheet.style.transition = 'none';
      sheet.style.setProperty('--fv-sheet-drag-y', `${distance}px`);
    };
    const finish = (event: PointerEvent, cancelled: boolean) => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
      settleDrag(distance, event.timeStamp - startTime, cancelled);
    };
    const onPointerUp = (event: PointerEvent) => finish(event, false);
    const onPointerCancel = (event: PointerEvent) => finish(event, true);
    let touchStartY: number | null = null;
    let touchStartTime = 0;
    let touchDistance = 0;
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || list.scrollTop > 0) return;
      touchStartY = event.touches[0].clientY;
      touchStartTime = event.timeStamp;
      touchDistance = 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (touchStartY === null || event.touches.length !== 1) return;
      const nextDistance = Math.max(0, event.touches[0].clientY - touchStartY);
      if (nextDistance === 0) {
        touchDistance = 0;
        sheet.style.removeProperty('transition');
        sheet.style.removeProperty('--fv-sheet-drag-y');
        return;
      }
      if (list.scrollTop > 0) {
        touchStartY = null;
        touchDistance = 0;
        sheet.style.removeProperty('transition');
        sheet.style.removeProperty('--fv-sheet-drag-y');
        return;
      }
      if (event.cancelable) event.preventDefault();
      touchDistance = nextDistance;
      sheet.style.transition = 'none';
      sheet.style.setProperty('--fv-sheet-drag-y', `${touchDistance}px`);
    };
    const finishTouch = (event: TouchEvent, cancelled: boolean) => {
      if (touchStartY === null) return;
      touchStartY = null;
      if (touchDistance > 0) settleDrag(touchDistance, event.timeStamp - touchStartTime, cancelled);
      touchDistance = 0;
    };
    const onTouchEnd = (event: TouchEvent) => finishTouch(event, false);
    const onTouchCancel = (event: TouchEvent) => finishTouch(event, true);
    header.addEventListener('pointerdown', onPointerDown);
    header.addEventListener('pointermove', onPointerMove);
    header.addEventListener('pointerup', onPointerUp);
    header.addEventListener('pointercancel', onPointerCancel);
    list.addEventListener('touchstart', onTouchStart, { passive: true });
    list.addEventListener('touchmove', onTouchMove, { passive: false });
    list.addEventListener('touchend', onTouchEnd);
    list.addEventListener('touchcancel', onTouchCancel);
    return () => {
      header.removeEventListener('pointerdown', onPointerDown);
      header.removeEventListener('pointermove', onPointerMove);
      header.removeEventListener('pointerup', onPointerUp);
      header.removeEventListener('pointercancel', onPointerCancel);
      list.removeEventListener('touchstart', onTouchStart);
      list.removeEventListener('touchmove', onTouchMove);
      list.removeEventListener('touchend', onTouchEnd);
      list.removeEventListener('touchcancel', onTouchCancel);
      sheet.style.removeProperty('transition');
      sheet.style.removeProperty('--fv-sheet-drag-y');
    };
  }, [morePhase]);

  if (!sections) return null;

  const itemCountStyle = {
    '--fv-bottom-bar-item-count': sections.quickItems.length + (sections.hasMore ? 1 : 0)
  } as CSSProperties;

  return (
    <>
      <nav
        className="fv-ds fv-bottom-bar fv-bottom-bar--sections"
        aria-label={`Áreas de ${sections.module.label}`}
        style={itemCountStyle}
      >
        <ul>
          {sections.quickItems.map(item => (
            <li key={item.id}>
              <Link className={[item.active && 'is-active', item.locked && 'is-locked'].filter(Boolean).join(' ')} to={item.href}
                onClick={event => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  if (!item.active && !item.onSelect) return;
                  event.preventDefault();
                  if (item.active) scrollPageTo('start');
                  else item.onSelect?.();
                }}
                aria-current={item.active ? 'page' : undefined}
                aria-label={item.locked
                  ? `${item.label}, bloqueado devido a assinaturas pendentes`
                  : item.mobileLabel || item.shortLabel ? item.label : undefined}
                title={item.label}>
                <span className="fv-bottom-bar__icon">
                  <AppIcon icon={navigationSectionIcon(sections.module.id, item.id)} size="md" />
                  {item.badge !== undefined ? <span className="fv-bottom-bar__badge">{item.badge}</span> : null}
                </span>
                <span className="fv-bottom-bar__label">{item.mobileLabel || item.shortLabel || item.label}</span>
              </Link>
            </li>
          ))}
          {sections.hasMore ? <li>
            <button type="button" className={sections.moreActive ? 'is-active' : undefined}
              onClick={() => { pendingActionRef.current = null; setMorePhase('opening'); }}
              aria-label={`Mais áreas de ${sections.module.label}${sections.moreActive && activeSection ? `, atual: ${activeSection.label}` : ''}`}
              aria-haspopup="dialog" aria-expanded={morePhase === 'opening' || morePhase === 'open'}>
              <span className="fv-bottom-bar__icon"><AppIcon icon={NAVIGATION_CHROME_ICONS.more} size="md" /></span>
              <span className="fv-bottom-bar__label">Mais</span>
            </button>
          </li> : null}
        </ul>
      </nav>
      {sections.hasMore ? <Modal open={moreMounted} onClose={() => setMorePhase('closing')} closeOnBackdrop
        appearance="design-system" size="md" title={`Áreas de ${sections.module.label}`}
        fullscreenOnMobile={false} preventInitialFocusScroll
        backdropClassName={`fv-bottom-bar__sheet-backdrop${morePhase === 'open' ? ' is-open' : morePhase === 'closing' ? ' is-closing' : ''}`}
        panelClassName="fv-bottom-bar__sheet">
        <ul className="fv-bottom-bar__sheet-list">
          {sections.allItems.map(item => <li key={item.id}>
            <Link to={item.href}
              className={[item.active && 'is-active', item.locked && 'is-locked'].filter(Boolean).join(' ')} aria-current={item.active ? 'page' : undefined}
              aria-label={item.locked ? `${item.label}, bloqueado devido a assinaturas pendentes` : undefined}
              onClick={(event) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                pendingActionRef.current = item.active
                  ? () => window.requestAnimationFrame(() => scrollPageTo('start'))
                  : item.onSelect ?? (() => { void navigate(item.href); });
                setMorePhase('closing');
              }}>
              <AppIcon icon={navigationSectionIcon(sections.module.id, item.id)} size="md" />
              <span>{item.label}</span>
              {item.badge !== undefined ? <Badge tone={item.active ? 'brand' : 'neutral'}>{item.badge}</Badge> : null}
              {item.active ? <span className="fv-bottom-bar__sheet-current">Atual</span> : null}
            </Link>
          </li>)}
        </ul>
      </Modal> : null}
    </>
  );
}

export function BottomBar(props: BottomBarProps) {
  if (props.appearance === 'design-system') {
    return <DesignSystemBottomBar {...props} />;
  }

  return <footer className="bottom-bar-react">{props.children}</footer>;
}
