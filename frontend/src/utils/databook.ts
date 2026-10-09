import type { AuthUser } from '../types/auth';
import type { DatabookInput, DatabookSources } from '../api/databooks';

export function canOpenDatabook(user: AuthUser | null) {
  return Boolean(user && user.accountType !== 'CLIENT' && (user.accountType === 'ADMIN' || user.moduleRoles.some(role =>
    ['rdo:manager', 'rdo:coordinator'].includes(role) || role.startsWith('efetivo:') || role.startsWith('acompanhamento:'))));
}

export function emptyDatabookInput(defaults: { startDate: string | null; endDate: string | null }): DatabookInput {
  return { title: '', startDate: defaults.startDate || '', endDate: defaults.endDate || '', summary: '',
    productsReviewed: false, reportIds: [], photos: [], products: [], documentVersionIds: [] };
}

export function reconcileDatabookSelection(input: DatabookInput, sources: DatabookSources): DatabookInput {
  const reportIds = input.reportIds.filter(id => sources.reports.some(report => report.id === id));
  return { ...input, reportIds,
    photos: input.photos.filter(photo => sources.photos.some(source => source.key === photo.key && reportIds.includes(source.reportId))),
    products: input.products.filter(product => sources.products.some(source => source.id === product.itemId)),
    documentVersionIds: input.documentVersionIds.filter(id => sources.documents.some(document => document.versionId === id)) };
}

export const DATABOOK_NOVELTY_START = Date.parse('2026-10-08T00:00:00-03:00');
export const DATABOOK_NOVELTY_END = Date.parse('2026-10-18T00:00:00-03:00');
const noveltyKey = (userId: string, guide: boolean) => `filtrovali:databook:v1:${guide ? 'guide' : 'novelty'}:${userId}`;
export function shouldShowDatabookNovelty(userId: string, guide = false, now = Date.now()) {
  if (!userId || now < DATABOOK_NOVELTY_START || now >= DATABOOK_NOVELTY_END) return false;
  try { return localStorage.getItem(noveltyKey(userId, guide)) !== '1'; } catch { return false; }
}
export function markDatabookNoveltySeen(userId: string, guide = false) {
  try { localStorage.setItem(noveltyKey(userId, guide), '1'); } catch { /* browser storage unavailable */ }
}
