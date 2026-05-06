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

function appendSessionToken(url: string) {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (!token) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}

function protectedUploadPath(rawUrl: string) {
  const value = String(rawUrl || '').trim();
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

export function resolveUploadAssetUrl(url: string) {
  if (!url) return '';
  if (url.startsWith('data:')) return url;

  const protectedPath = protectedUploadPath(url);
  if (protectedPath) {
    return appendSessionToken(apiUrl(`/uploads/file/${encodePath(protectedPath)}`));
  }

  if (/^https?:\/\//i.test(url)) return url;

  const normalized = url.startsWith('/') ? url : `/relatorios/${url}`;
  const isPublic = normalized.startsWith('/assets/');
  if (isPublic && assetsBaseUrl) return `${assetsBaseUrl}${normalized}`;
  if (isPublic) return normalized;

  return appendSessionToken(apiUrl(`/uploads/file/${encodePath(url)}`));
}
