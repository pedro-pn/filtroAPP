type ErrorPayload = {
  message: string;
  name?: string;
  stack?: string;
  source: string;
  url: string;
  userAgent: string;
  context?: Record<string, unknown>;
};

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');
const trackingEndpoint = import.meta.env.VITE_ERROR_TRACKING_ENDPOINT
  || `${apiBaseUrl}/operations/client-errors`;
const trackingEnabled = import.meta.env.VITE_ERROR_TRACKING_ENABLED === 'true'
  || Boolean(import.meta.env.VITE_ERROR_TRACKING_ENDPOINT);

function errorFromUnknown(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === 'string' ? value : 'Erro não tratado no frontend.');
}

function sendPayload(payload: ErrorPayload) {
  if (!trackingEnabled) return;
  const body = JSON.stringify(payload);
  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: 'application/json' });
    if (navigator.sendBeacon(trackingEndpoint, blob)) return;
  }
  fetch(trackingEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: true
  }).catch(() => {});
}

export function captureClientError(errorValue: unknown, source = 'frontend', context: Record<string, unknown> = {}) {
  const error = errorFromUnknown(errorValue);
  sendPayload({
    message: error.message,
    name: error.name,
    stack: error.stack,
    source,
    url: window.location.href,
    userAgent: navigator.userAgent,
    context
  });
}

export function installClientErrorTracking() {
  if (!trackingEnabled || typeof window === 'undefined') return;

  window.addEventListener('error', event => {
    captureClientError(event.error || event.message, 'frontend.window-error', {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno
    });
  });

  window.addEventListener('unhandledrejection', event => {
    captureClientError(event.reason, 'frontend.unhandledrejection');
  });
}
