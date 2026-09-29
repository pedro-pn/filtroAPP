import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';

import { AppIcon } from '../components/icons/AppIcon';
import { Badge } from '../components/ui/ds';
import { Modal } from '../components/ui/Modal';
import { NAVIGATION_CHROME_ICONS, navigationSectionIcon } from './navigationIcons';
import { mobileSectionNavigation, type NavigationModel } from './navigationModel';

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
              <Link className={item.active ? 'is-active' : undefined} to={item.href}
                onClick={event => {
                  if (!item.onSelect || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  item.onSelect();
                }}
                aria-current={item.active ? 'page' : undefined} title={item.label}>
                <span className="fv-bottom-bar__icon">
                  <AppIcon icon={navigationSectionIcon(sections.module.id, item.id)} size="md" />
                  {item.badge !== undefined ? <span className="fv-bottom-bar__badge">{item.badge}</span> : null}
                </span>
                <span className="fv-bottom-bar__label">{item.label}</span>
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
      {sections.hasMore ? <Modal open={morePhase !== 'closed'} onClose={() => setMorePhase('closing')} closeOnBackdrop
        appearance="design-system" size="md" title={`Áreas de ${sections.module.label}`}
        fullscreenOnMobile={false} preventInitialFocusScroll
        backdropClassName={`fv-bottom-bar__sheet-backdrop${morePhase === 'open' ? ' is-open' : morePhase === 'closing' ? ' is-closing' : ''}`}
        panelClassName="fv-bottom-bar__sheet">
        <ul className="fv-bottom-bar__sheet-list">
          {sections.allItems.map(item => <li key={item.id}>
            <Link to={item.href}
              className={item.active ? 'is-active' : undefined} aria-current={item.active ? 'page' : undefined}
              onClick={(event) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                pendingActionRef.current = item.onSelect ?? (() => { void navigate(item.href); });
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
