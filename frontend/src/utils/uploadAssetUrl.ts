import { TOKEN_STORAGE_KEY } from '../api/client';

const assetsBaseUrl = (import.meta.env.VITE_ASSETS_BASE_URL || '').replace(/\/$/, '');
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encodePath(value: string) {
  return value
    .split('/')
    .filter(Boolean)
    .map(part => encodeURIComponent(safeDecode(part)))
    .join('/');
}

function apiUrl(path: string) {
  if (/^https?:\/\//i.test(apiBaseUrl)) return `${apiBaseUrl}${path}`;
  if (apiBaseUrl) return `${apiBaseUrl}${path}`;
  return `/api${path}`;
}

export function normalizeLocalUploadUrl(url: string) {
  return String(url || '').replace(
    /^\/\/(api\/uploads\/file\/|api\/rdo\/uploads\/file\/|relatorios\/|uploads\/)/i,
    '/$1'
  );
}

function protectedUploadPath(rawUrl: string) {
  const value = normalizeLocalUploadUrl(rawUrl).trim();
  if (!value || value.startsWith('data:')) return '';

  let pathname = value;
  if (/^https?:\/\//i.test(value)) {
    try {
      pathname = new URL(value).pathname;
    } catch {
      return '';
    }
  }

  if (pathname.startsWith('/api/uploads/file/')) {
    return safeDecode(pathname.slice('/api/uploads/file/'.length));
  }
  if (pathname.startsWith('/api/rdo/uploads/file/')) {
    return safeDecode(pathname.slice('/api/rdo/uploads/file/'.length));
  }
  if (pathname.startsWith('/relatorios/')) {
    return safeDecode(pathname.slice('/relatorios/'.length));
  }
  if (pathname.startsWith('/uploads/')) {
    return safeDecode(pathname.slice('/uploads/'.length));
  }
  if (pathname.startsWith('relatorios/')) {
    return safeDecode(pathname.slice('relatorios/'.length));
  }
  if (pathname.startsWith('uploads/')) {
    return safeDecode(pathname.slice('uploads/'.length));
  }

  return '';
}

function isPublicAssetUrl(url: string) {
  const normalized = url.startsWith('/') ? url : `/relatorios/${url}`;
  return normalized.startsWith('/assets/');
}

export function resolveUploadAssetUrl(url: string) {
  const normalizedUrl = normalizeLocalUploadUrl(url);
  if (!normalizedUrl) return '';
  if (normalizedUrl.startsWith('data:')) return normalizedUrl;

  const protectedPath = protectedUploadPath(normalizedUrl);
  if (protectedPath) {
    return apiUrl(`/rdo/uploads/file/${encodePath(protectedPath)}`);
  }

  if (/^https?:\/\//i.test(normalizedUrl)) return normalizedUrl;

  const normalized = normalizedUrl.startsWith('/') ? normalizedUrl : `/relatorios/${normalizedUrl}`;
  const isPublic = isPublicAssetUrl(normalizedUrl);
  if (isPublic && assetsBaseUrl) return `${assetsBaseUrl}${normalized}`;
  if (isPublic) return normalized;

  return apiUrl(`/rdo/uploads/file/${encodePath(normalizedUrl)}`);
}

export function isProtectedUploadAssetUrl(url: string) {
  const normalizedUrl = normalizeLocalUploadUrl(url);
  if (!normalizedUrl || normalizedUrl.startsWith('data:')) return false;
  if (protectedUploadPath(normalizedUrl)) return true;
  if (/^https?:\/\//i.test(normalizedUrl)) return false;
  return !isPublicAssetUrl(normalizedUrl);
}

export async function loadUploadAssetUrl(url: string) {
  const resolvedUrl = resolveUploadAssetUrl(url);
  if (!resolvedUrl || !isProtectedUploadAssetUrl(url)) return resolvedUrl;

  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (!token) return '';

  const response = await fetch(resolvedUrl, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error('Não foi possível carregar o arquivo protegido.');
  }

  return URL.createObjectURL(await response.blob());
}
