function isMobile(): boolean {
  const ua = (navigator.userAgent || '').toLowerCase();
  const touch = !!(navigator.maxTouchPoints && navigator.maxTouchPoints > 1);
  return /android|iphone|ipad|ipod|mobile/.test(ua) || touch;
}

/**
 * Opens a placeholder window synchronously (inside a click handler) so popup
 * blockers don't interfere. Returns null on mobile, where we redirect in-place.
 */
export function openZapSignPendingWindow(): Window | null {
  if (isMobile()) return null;
  let win: Window | null = null;
  try {
    win = window.open('about:blank', '_blank');
    if (win) {
      try { (win as Window & { opener: null }).opener = null; } catch { /* noop */ }
      try {
        win.document.title = 'Abrindo ZapSign...';
        win.document.body.innerHTML =
          '<div style="font-family:Arial,sans-serif;padding:24px;line-height:1.5;color:#111827">' +
          '<strong>Abrindo ZapSign...</strong><br>Aguarde enquanto o link de assinatura é preparado.</div>';
      } catch { /* cross-origin guard */ }
    }
  } catch { win = null; }
  return win;
}

/** Redirects the pre-opened window to `url`, or redirects current page on mobile. */
export function redirectZapSignWindow(win: Window | null, url: string): void {
  if (!url) return;
  if (win && !win.closed) {
    try { win.location.replace(url); return; } catch { /* fallthrough */ }
  }
  window.location.assign(url);
}

/** Closes the pending window if an error occurs before we get the URL. */
export function closeZapSignPendingWindow(win: Window | null): void {
  if (win && !win.closed) {
    try { win.close(); } catch { /* noop */ }
  }
}
