export type PageScrollEdge = 'start' | 'end';

export const PAGE_SCROLL_COMMAND_EVENT = 'fv:page-scroll-command';
const PAGE_SCROLL_SELECTOR = '.fv-app-shell__content .page-scroll, .app-shell .page-scroll';

export function isPageScrollEvent(event: Event) {
  const target = event.target;
  return target === window || target === document || target === document.documentElement || target === document.body ||
    target === document.querySelector(PAGE_SCROLL_SELECTOR);
}

export function pageScrollElement() {
  if (typeof document === 'undefined') return null;
  const page = document.querySelector<HTMLElement>(PAGE_SCROLL_SELECTOR);
  const documentElement = (document.scrollingElement as HTMLElement | null) || document.documentElement;
  if (!page) return documentElement;
  if (documentElement.scrollTop > 0) return documentElement;
  const pageRange = Math.max(0, page.scrollHeight - page.clientHeight);
  const documentRange = Math.max(0, documentElement.scrollHeight - documentElement.clientHeight);
  return pageRange > 1 && (page.scrollTop > 0 || pageRange >= documentRange) ? page : documentElement;
}

export function scrollPageTo(edge: PageScrollEdge) {
  if (typeof window === 'undefined') return;
  const element = pageScrollElement();
  if (!element) return;
  window.dispatchEvent(new Event(PAGE_SCROLL_COMMAND_EVENT));
  const top = edge === 'start' ? 0 : element.scrollHeight;
  const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  element.scrollTo({ top, behavior });
}
