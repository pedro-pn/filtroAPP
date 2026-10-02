import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';

import { AppIcon } from '../components/icons/AppIcon';
import { isPageScrollEvent, pageScrollElement, PAGE_SCROLL_COMMAND_EVENT, scrollPageTo } from './pageScroll';
import './PageScrollControls.css';

const MIN_SCROLL_RANGE = 320;
const HIDE_AFTER_MS = 2600;

export function PageScrollControls() {
  const location = useLocation();
  const [range, setRange] = useState(0);
  const [position, setPosition] = useState(0);
  const [recentlyScrolled, setRecentlyScrolled] = useState(false);
  const [nearCorner, setNearCorner] = useState(false);

  useEffect(() => {
    let hideTimer = 0;
    let suppressUntil = 0;
    let frame = 0;
    const update = () => {
      const element = pageScrollElement();
      setRange(element ? Math.max(0, element.scrollHeight - element.clientHeight) : 0);
      setPosition(element?.scrollTop || 0);
    };
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };
    const handleScroll = (event: Event) => {
      if (!isPageScrollEvent(event)) return;
      scheduleUpdate();
      if (Date.now() < suppressUntil) return;
      setRecentlyScrolled(true);
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setRecentlyScrolled(false), HIDE_AFTER_MS);
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      setNearCorner(event.clientX >= window.innerWidth - 100 && event.clientY >= window.innerHeight - 190);
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      if (event.target instanceof Element && event.target.closest('.fv-page-scroll-controls')) return;
      setRecentlyScrolled(false);
      window.clearTimeout(hideTimer);
    };
    const handleCommand = () => {
      suppressUntil = Date.now() + 1500;
      setRecentlyScrolled(false);
      setNearCorner(false);
      window.clearTimeout(hideTimer);
      scheduleUpdate();
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleUpdate);
    const content = document.querySelector('.fv-app-shell__content-inner');
    if (content) observer?.observe(content);
    observer?.observe(document.documentElement);
    document.addEventListener('scroll', handleScroll, true);
    document.addEventListener('pointermove', handlePointerMove, { passive: true });
    document.addEventListener('pointerdown', handlePointerDown, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener(PAGE_SCROLL_COMMAND_EVENT, handleCommand);
    scheduleUpdate();
    setRecentlyScrolled(false);
    setNearCorner(false);
    return () => {
      observer?.disconnect();
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener(PAGE_SCROLL_COMMAND_EVENT, handleCommand);
      window.clearTimeout(hideTimer);
      window.cancelAnimationFrame(frame);
    };
  }, [location.pathname, location.search]);

  const available = range > MIN_SCROLL_RANGE;
  const visible = available && (recentlyScrolled || nearCorner);
  return (
    <div className={`fv-page-scroll-controls${visible ? ' is-visible' : ''}`} aria-hidden={!visible}>
      <button type="button" title="Ir para o início" aria-label="Ir para o início" tabIndex={visible ? 0 : -1}
        disabled={position <= 2} onClick={() => scrollPageTo('start')}>
        <AppIcon icon={ChevronUp} size="md" />
      </button>
      <button type="button" title="Ir para o final" aria-label="Ir para o final" tabIndex={visible ? 0 : -1}
        disabled={position >= range - 2} onClick={() => scrollPageTo('end')}>
        <AppIcon icon={ChevronDown} size="md" />
      </button>
    </div>
  );
}
