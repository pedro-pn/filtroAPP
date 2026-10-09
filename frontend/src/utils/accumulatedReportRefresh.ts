import type { PaginatedReports, ReportPageFilters } from '../api/reports';
import type { ReportSummary } from '../types/domain';

type PageLoader = (filters: ReportPageFilters, signal?: AbortSignal) => Promise<PaginatedReports>;

export interface LoadedReportGroup {
  projectId: string;
  reportType: string;
  pageSize: number;
  sortDirection: 'asc' | 'desc';
  loadedCount: number;
}

export function loadedReportGroups(items: ReportSummary[], counts: Record<string, number>): LoadedReportGroup[] {
  const groups = new Map(items.map(item => [`${item.projectId}-${item.reportType}`, item]));
  const requests: LoadedReportGroup[] = [];
  for (const [groupKey, item] of groups) {
    for (const [key, loadedCount] of Object.entries(counts)) {
      if (!key.startsWith(`${groupKey}-`) || loadedCount <= 0) continue;
      const [size, direction] = key.slice(groupKey.length + 1).split('-');
      const pageSize = Number(size);
      if (!Number.isInteger(pageSize) || pageSize <= 0) continue;
      requests.push({ projectId: item.projectId, reportType: item.reportType, pageSize, sortDirection: direction === 'desc' ? 'desc' : 'asc', loadedCount });
    }
  }
  return requests;
}

export async function refreshAccumulatedReportPages(
  filters: Omit<ReportPageFilters, 'page'>,
  page: number,
  groups: () => LoadedReportGroup[],
  loadPage: PageLoader,
  signal?: AbortSignal
): Promise<PaginatedReports> {
  // Atualiza toda a janela visível. O resultado do servidor substitui também itens
  // removidos ou que deixaram de atender ao filtro (aprovação, arquivamento etc.).
  const first = await loadPage({ ...filters, page: 1 }, signal);
  const lastPage = Math.min(page, first.pagination.totalPages);
  const pages = [first, ...await Promise.all(Array.from({ length: Math.max(0, lastPage - 1) }, (_, index) => loadPage({ ...filters, page: index + 2 }, signal)))];
  const items = new Map(pages.flatMap(result => result.items).map(item => [item.id, item]));
  const totals = new Map(pages.flatMap(result => result.groups || []).map(group => [`${group.projectId}-${group.reportType}`, group]));
  const refreshedGroups = new Set<string>();
  for (const group of groups()) {
    if (signal?.aborted) throw signal.reason;
    const results = await Promise.all(Array.from({ length: Math.ceil(group.loadedCount / group.pageSize) }, (_, index) => loadPage({
      ...filters, projectId: group.projectId, reportType: group.reportType,
      reportSort: group.sortDirection, page: index + 1, pageSize: group.pageSize
    }, signal)));
    // A consulta específica é a fonte atual de todos os itens desse grupo.
    const groupKey = `${group.projectId}-${group.reportType}`;
    if (!refreshedGroups.has(groupKey)) {
      for (const [id, item] of items) if (item.projectId === group.projectId && item.reportType === group.reportType) items.delete(id);
      refreshedGroups.add(groupKey);
    }
    results.flatMap(result => result.items).forEach(item => items.set(item.id, item));
    results.flatMap(result => result.groups || []).forEach(total => totals.set(`${total.projectId}-${total.reportType}`, total));
  }
  return { ...first, items: [...items.values()], groups: [...totals.values()], pagination: { ...first.pagination, page: Math.max(1, lastPage) } };
}
