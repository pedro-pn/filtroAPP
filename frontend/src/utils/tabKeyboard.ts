import type { KeyboardEvent } from 'react';

export function handleHorizontalTabListKeyDown(event: KeyboardEvent<HTMLElement>) {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!keys.includes(event.key)) return;

  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'));
  if (!tabs.length) return;

  const activeIndex = Math.max(0, tabs.indexOf(document.activeElement as HTMLButtonElement));
  const nextIndex = (() => {
    if (event.key === 'Home') return 0;
    if (event.key === 'End') return tabs.length - 1;
    if (event.key === 'ArrowLeft') return activeIndex <= 0 ? tabs.length - 1 : activeIndex - 1;
    return activeIndex >= tabs.length - 1 ? 0 : activeIndex + 1;
  })();

  event.preventDefault();
  tabs[nextIndex].focus();
  tabs[nextIndex].click();
}
