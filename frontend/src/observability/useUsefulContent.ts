import { createContext, useContext, useEffect, useRef } from 'react';
import { pagePerformance, pagePerformanceEnabled, pagePerformanceNavigation } from './pagePerformance';

export const PagePerformanceNavigationContext = createContext('standalone');

interface ContentState {
  ready: boolean;
  fetching: boolean;
  cached: boolean;
  dataUpdatedAt?: number;
}
// Call beside the actual data consumer, including inside lazy panels. Polling cannot
// create another initial-load sample. Two frames allow the committed content to paint.
export function useUsefulContent(surface: string, viewKey: string, { ready, fetching, cached, dataUpdatedAt }: ContentState) {
  const navigationKey = useContext(PagePerformanceNavigationContext);
  const state = useRef<{ key: string; startedAt: number; seen: boolean; refreshAt?: number }>(undefined);
  useEffect(() => {
    if (!pagePerformanceEnabled()) return;
    const navigation = pagePerformanceNavigation();
    const key = `${navigationKey === 'standalone' ? navigation?.key || 'standalone' : navigationKey}:${viewKey}`;
    if (state.current?.key !== key) state.current = { key, startedAt: navigation?.startedAt ?? performance.now(), seen: false };
    const current = state.current;
    const fromCache = navigation && dataUpdatedAt
      ? dataUpdatedAt <= performance.timeOrigin + navigation.startedAt : cached;
    if (current.seen && fetching) current.refreshAt ??= performance.now();
    if (!ready) return;
    const phase = !current.seen ? 'content-visible' : !fetching && current.refreshAt !== undefined ? 'refresh-complete' : null;
    if (!phase) return;
    let secondFrame = 0;
    let firstFrame = 0;
    const schedule = () => {
      cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame);
      if (document.visibilityState === 'hidden') return;
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => {
          if (document.visibilityState === 'hidden' || state.current !== current) return;
          if (phase === 'content-visible' ? current.seen : current.refreshAt === undefined) return;
          pagePerformance.record({ surface, phase, source: phase === 'content-visible' && fromCache ? 'cache' : 'network',
            refreshing: fetching, durationMs: performance.now() - (phase === 'content-visible' ? current.startedAt : current.refreshAt!) });
          current.seen = true;
          if (phase === 'content-visible' && fetching) current.refreshAt ??= performance.now();
          if (phase === 'refresh-complete') current.refreshAt = undefined;
        });
      });
    };
    schedule();
    document.addEventListener('visibilitychange', schedule);
    return () => { document.removeEventListener('visibilitychange', schedule); cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); };
  }, [surface, viewKey, navigationKey, ready, fetching, cached, dataUpdatedAt]);
}

interface UsefulQueryState {
  data: unknown;
  isError: boolean;
  isFetching: boolean;
  isFetchedAfterMount: boolean;
  dataUpdatedAt: number;
}
export function useUsefulQueryContent(surface: string, viewKey: string, queries: UsefulQueryState[], enabled = true) {
  useUsefulContent(surface, viewKey, {
    ready: enabled && queries.length > 0 && queries.every(query => query.data !== undefined && !query.isError),
    fetching: queries.some(query => query.isFetching),
    cached: queries.every(query => !query.isFetchedAfterMount),
    dataUpdatedAt: Math.max(0, ...queries.map(query => query.dataUpdatedAt))
  });
}
