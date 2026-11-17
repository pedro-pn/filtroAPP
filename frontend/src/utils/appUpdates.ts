const CHECK_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

/** Compare deployments with the version loaded by this tab, never a fetched baseline. */
export function watchAppUpdates(currentVersion: string, onUpdateAvailable: () => void) {
  let disposed = false;
  let notified = false;
  let pending: AbortController | null = null;
  let lastCheck = -Infinity;

  async function check() {
    if (disposed || notified || pending || document.visibilityState === 'hidden' || !navigator.onLine) return;
    // Focus and visibility events often arrive together.
    if (Date.now() - lastCheck < REQUEST_TIMEOUT_MS) return;
    lastCheck = Date.now();

    const controller = new AbortController();
    pending = controller;
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}app-version.json`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return;
      const data: unknown = await response.json();
      if (
        !disposed && !controller.signal.aborted &&
        typeof data === 'object' && data !== null && 'version' in data &&
        typeof data.version === 'string' && data.version.trim() &&
        data.version !== currentVersion
      ) {
        notified = true;
        onUpdateAvailable();
      }
    } catch {
      // Offline, failed deployments and missing metadata must not interrupt work.
    } finally {
      window.clearTimeout(timeout);
      pending = null;
    }
  }

  // Leave the first render and its API requests free to finish first.
  const initialCheck = window.setTimeout(check, REQUEST_TIMEOUT_MS);
  const interval = window.setInterval(check, CHECK_INTERVAL_MS);
  window.addEventListener('focus', check);
  window.addEventListener('online', check);
  document.addEventListener('visibilitychange', check);

  return () => {
    disposed = true;
    window.clearTimeout(initialCheck);
    window.clearInterval(interval);
    window.removeEventListener('focus', check);
    window.removeEventListener('online', check);
    document.removeEventListener('visibilitychange', check);
    pending?.abort();
  };
}
