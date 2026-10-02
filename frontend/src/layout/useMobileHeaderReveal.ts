import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';

import { isPageScrollEvent, pageScrollElement, PAGE_SCROLL_COMMAND_EVENT } from './pageScroll';

const DIRECTION_THRESHOLD = 8;
const HIDE_AFTER = 84;

export function useMobileHeaderReveal() {
  const location = useLocation();
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 767.98px)');
    let lastPosition = pageScrollElement()?.scrollTop || 0;
    let directionStart = lastPosition;

    const reset = () => {
      lastPosition = pageScrollElement()?.scrollTop || 0;
      directionStart = lastPosition;
      setHidden(false);
    };
    const handleScroll = (event: Event) => {
      if (!mobile.matches || !isPageScrollEvent(event)) return;
      const source = event.target instanceof HTMLElement ? event.target : pageScrollElement();
      const position = source?.scrollTop || 0;
      if (position <= 8) {
        setHidden(false);
        directionStart = position;
      } else if (position > lastPosition) {
        if (directionStart > lastPosition) directionStart = lastPosition;
        if (position > HIDE_AFTER && position - directionStart >= DIRECTION_THRESHOLD) {
          setHidden(true);
        }
      } else if (position < lastPosition) {
        if (directionStart < lastPosition) directionStart = lastPosition;
        if (directionStart - position >= DIRECTION_THRESHOLD) {
          setHidden(false);
        }
      }
      lastPosition = position;
    };

    document.addEventListener('scroll', handleScroll, true);
    window.addEventListener(PAGE_SCROLL_COMMAND_EVENT, reset);
    mobile.addEventListener('change', reset);
    return () => {
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener(PAGE_SCROLL_COMMAND_EVENT, reset);
      mobile.removeEventListener('change', reset);
    };
  }, [location.pathname, location.search]);

  return hidden;
}
