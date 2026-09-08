import type { ApiCredentialPublic } from '../../../../../shared/schemas/api-credentials.js';

const keys = ['etapa', 'operation', 'testScope', 'q', 'status', 'scope', 'expiresBefore', 'credential', 'detail', 'cursor', 'eventCursor'];

export function nextAdminSearch(current: URLSearchParams, values: Record<string, string | undefined>) {
  const next = new URLSearchParams();
  for (const key of keys) {
    const value = values[key] ?? current.get(key);
    if (value) next.set(key, value);
  }
  if (['q', 'status', 'scope', 'expiresBefore'].some(key => values[key] !== undefined && values[key] !== (current.get(key) || ''))) next.delete('cursor');
  if (values.detail !== undefined && values.detail !== (current.get('detail') || '')) next.delete('eventCursor');
  return next;
}

export function resolveSelectedCredential(id: string, items: ApiCredentialPublic[], direct?: ApiCredentialPublic) {
  if (!id) return null;
  return direct?.id === id ? direct : items.find(item => item.id === id) || null;
}
