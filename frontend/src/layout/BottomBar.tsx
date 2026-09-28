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

const MORE_SHEET_EXIT_MS = 220;

function DesignSystemBottomBar({
  navigation
}: DesignSystemBottomBarProps) {
  const navigate = useNavigate();
  const sections = mobileSectionNavigation(navigation);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreMounted, setMoreMounted] = useState(false);
  const activeSectionRef = useRef<HTMLAnchorElement>(null);
  const pendingHrefRef = useRef<string | null>(null);
  const activeSection = sections?.allItems.find(item => item.active);

  useEffect(() => {
    pendingHrefRef.current = null;
    setMoreOpen(false);
  }, [sections?.module.id, activeSection?.id]);
  useEffect(() => {
    if (moreOpen || !moreMounted) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timeout = window.setTimeout(() => {
      setMoreMounted(false);
      const href = pendingHrefRef.current;
      pendingHrefRef.current = null;
      if (href) void navigate(href);
    }, reduceMotion ? 0 : MORE_SHEET_EXIT_MS);
    return () => window.clearTimeout(timeout);
  }, [moreOpen, moreMounted, navigate]);
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 768px)');
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setMoreOpen(false);
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
              onClick={() => { pendingHrefRef.current = null; setMoreMounted(true); setMoreOpen(true); }}
              aria-label={`Mais áreas de ${sections.module.label}${sections.moreActive && activeSection ? `, atual: ${activeSection.label}` : ''}`}
              aria-haspopup="dialog" aria-expanded={moreOpen}>
              <span className="fv-bottom-bar__icon"><AppIcon icon={NAVIGATION_CHROME_ICONS.more} size="md" /></span>
              <span className="fv-bottom-bar__label">Mais</span>
            </button>
          </li> : null}
        </ul>
      </nav>
      {sections.hasMore ? <Modal open={moreMounted} onClose={() => setMoreOpen(false)} closeOnBackdrop
        appearance="design-system" size="md" title={`Áreas de ${sections.module.label}`}
        fullscreenOnMobile={false} backdropClassName={`fv-bottom-bar__sheet-backdrop${moreOpen ? '' : ' is-closing'}`}
        panelClassName="fv-bottom-bar__sheet" initialFocusRef={activeSectionRef}>
        <ul className="fv-bottom-bar__sheet-list">
          {sections.allItems.map(item => <li key={item.id}>
            <Link ref={item.active ? activeSectionRef : undefined} to={item.href}
              className={item.active ? 'is-active' : undefined} aria-current={item.active ? 'page' : undefined}
              onClick={(event) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                pendingHrefRef.current = item.href;
                setMoreOpen(false);
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
