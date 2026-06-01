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

function normalizeUploadReference(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('data:')) return '';

  let pathname = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      pathname = new URL(raw).pathname;
    } catch {
      return '';
    }
  }

  if (pathname.startsWith('/api/uploads/file/')) {
    return normalizeRelativeUploadPath(pathname.slice('/api/uploads/file/'.length));
  }
  if (pathname.startsWith('/api/rdo/uploads/file/')) {
    return normalizeRelativeUploadPath(pathname.slice('/api/rdo/uploads/file/'.length));
  }
  if (pathname.startsWith('/relatorios/')) {
    return normalizeRelativeUploadPath(pathname.slice('/relatorios/'.length));
  }
  if (pathname.startsWith('/uploads/')) {
    return normalizeRelativeUploadPath(pathname.slice('/uploads/'.length));
  }
  if (pathname.startsWith('relatorios/')) {
    return normalizeRelativeUploadPath(pathname.slice('relatorios/'.length));
  }
  if (pathname.startsWith('uploads/')) {
    return normalizeRelativeUploadPath(pathname.slice('uploads/'.length));
  }
  if (pathname.includes('/')) {
    return normalizeRelativeUploadPath(pathname);
  }
  return '';
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

function collectUploadReferences(value, paths) {
  if (!value) return;
  if (typeof value === 'string') {
    const normalized = normalizeUploadReference(value);
    if (normalized) paths.add(normalized);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectUploadReferences(item, paths));
    return;
  }
  if (typeof value === 'object') {
    for (const key of ['url', 'path', 'storagePath']) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const normalized = normalizeUploadReference(value[key]);
        if (normalized) paths.add(normalized);
      }
    }
    Object.values(value).forEach(item => collectUploadReferences(item, paths));
  }
}

export function grantReportUploadAccess(auth, report) {
  const userId = auth?.user?.id;
  if (!userId || !report) return;

  const paths = new Set();
  collectUploadReferences(report.specialConditions, paths);
  collectUploadReferences(report.attachments, paths);
  for (const service of report.services || []) {
    collectUploadReferences(service.extraData, paths);
    collectUploadReferences(service.attachments, paths);
  }
  for (const normalizedPath of paths) {
    rememberTransientUploadAccess(normalizedPath, userId);
  }
}

export function grantReportsUploadAccess(auth, reports) {
  if (!Array.isArray(reports)) return;
  reports.forEach(report => grantReportUploadAccess(auth, report));
}
