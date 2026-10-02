import { useSyncExternalStore } from 'react';

export type ListingMobileBreakpoint = 'md' | 'lg' | 'xl';

const LISTING_MOBILE_QUERIES: Record<ListingMobileBreakpoint, string> = {
  md: '(max-width: 767.98px)',
  lg: '(max-width: 1023.98px)',
  xl: '(max-width: 1279.98px)'
};

function createMediaStore(query: string) {
  return {
    subscribe(onStoreChange: () => void) {
      const media = window.matchMedia(query);
      media.addEventListener('change', onStoreChange);
      return () => media.removeEventListener('change', onStoreChange);
    },
    getSnapshot() {
      return window.matchMedia(query).matches;
    }
  };
}

const LISTING_MEDIA_STORES = {
  md: createMediaStore(LISTING_MOBILE_QUERIES.md),
  lg: createMediaStore(LISTING_MOBILE_QUERIES.lg),
  xl: createMediaStore(LISTING_MOBILE_QUERIES.xl)
} satisfies Record<ListingMobileBreakpoint, ReturnType<typeof createMediaStore>>;

function getServerSnapshot() {
  return false;
}

export function useListingMobileViewport(
  breakpoint: ListingMobileBreakpoint = 'md'
) {
  const store = LISTING_MEDIA_STORES[breakpoint];
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    getServerSnapshot
  );
}
