const TRANSIENT_UPLOAD_ACCESS_MS = 30 * 60 * 1000;
const transientUploadAccess = new Map();

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function normalizeRelativeUploadPath(rawPath) {
  const normalizedPath = String(rawPath || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map(part => safeDecode(part))
    .join('/');
  return normalizedPath || '';
}

function cleanupTransientUploadAccess(now = Date.now()) {
  for (const [key, grant] of transientUploadAccess) {
    if (!grant || grant.expiresAt <= now) transientUploadAccess.delete(key);
  }
}

export function rememberTransientUploadAccess(normalizedPath, userId) {
  if (!normalizedPath || !userId) return;
  cleanupTransientUploadAccess();
  transientUploadAccess.set(normalizedPath, {
    userId,
    expiresAt: Date.now() + TRANSIENT_UPLOAD_ACCESS_MS
  });
}

export function hasTransientUploadAccess(normalizedPath, auth) {
  cleanupTransientUploadAccess();
  const grant = transientUploadAccess.get(normalizedPath);
  return !!(grant && grant.userId === auth.user.id && grant.expiresAt > Date.now());
}

export function grantReportUploadAccess(auth, report) {
  void auth;
  void report;
}

export function grantReportsUploadAccess(auth, reports) {
  if (!Array.isArray(reports)) return;
  reports.forEach(report => grantReportUploadAccess(auth, report));
}
