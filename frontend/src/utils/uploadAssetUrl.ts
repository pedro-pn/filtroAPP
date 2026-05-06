import { TOKEN_STORAGE_KEY } from '../api/client';

const assetsBaseUrl = (import.meta.env.VITE_ASSETS_BASE_URL || '').replace(/\/$/, '');

export function resolveUploadAssetUrl(url: string) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url;

  const normalized = url.startsWith('/') ? url : `/relatorios/${url}`;
  const protectedPath = normalized.startsWith('/relatorios/')
    ? normalized.slice('/relatorios/'.length)
    : (normalized.startsWith('/uploads/') ? normalized.slice('/uploads/'.length) : '');
  const isPublic = normalized.startsWith('/assets/');
  const resolved = protectedPath
    ? `/api/uploads/file/${protectedPath}`
    : (isPublic && assetsBaseUrl ? `${assetsBaseUrl}${normalized}` : normalized);

  if (isPublic) return resolved;
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (!token) return resolved;
  const separator = resolved.includes('?') ? '&' : '?';
  return `${resolved}${separator}token=${encodeURIComponent(token)}`;
}
