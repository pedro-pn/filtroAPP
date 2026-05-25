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
  if (!url) return '';
  if (url.startsWith('data:')) return url;

  const protectedPath = protectedUploadPath(url);
  if (protectedPath) {
    return apiUrl(`/rdo/uploads/file/${encodePath(protectedPath)}`);
  }

  if (/^https?:\/\//i.test(url)) return url;

  const normalized = url.startsWith('/') ? url : `/relatorios/${url}`;
  const isPublic = isPublicAssetUrl(url);
  if (isPublic && assetsBaseUrl) return `${assetsBaseUrl}${normalized}`;
  if (isPublic) return normalized;

  return apiUrl(`/rdo/uploads/file/${encodePath(url)}`);
}

export function isProtectedUploadAssetUrl(url: string) {
  if (!url || url.startsWith('data:')) return false;
  if (protectedUploadPath(url)) return true;
  if (/^https?:\/\//i.test(url)) return false;
  return !isPublicAssetUrl(url);
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
