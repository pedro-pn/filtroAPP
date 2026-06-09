import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createClientReportReview,
  createReport,
  createServiceOnlyReports,
  deleteReport as deleteReportApi,
  deleteReportService,
  getReportAudit,
  getReport,
  listReports,
  listReportsPage,
  requestReportSignature,
  updateReport,
  updateReportStatus,
  type PaginatedReports,
  type ReportFilters,
  type ReportPagination,
  type ReportPageFilters
} from '../api/reports';
import { useAuth } from '../auth/AuthContext';
import type { ReportPayload, ReportStatus, ReportSummary, ServiceOnlyReportPayload } from '../types/domain';
import { queryKeys } from './queryKeys';

interface LoadMoreReportGroupOptions {
  projectId: string;
  reportType: string;
  loadedCount: number;
  pageSize?: number;
  sortDirection?: 'asc' | 'desc';
}

interface ReportGroupTotalEntry {
  reportType: string;
  total: number;
}

interface AccumulatedReportsSnapshot {
  version: 1;
  savedAt: number;
  page: number;
  items: ReportSummary[];
  groupLoadedCounts: Record<string, number>;
  groupTotals: Record<string, number>;
}

const ACCUMULATED_REPORTS_STORAGE_VERSION = 1;
const ACCUMULATED_REPORTS_STORAGE_TTL_MS = 30 * 60 * 1000;
const accumulatedReportsSnapshots = new Map<string, AccumulatedReportsSnapshot>();

// Hooks montados de useAccumulatedReportsPage assinam aqui para re-sincronizar seus
// itens quando uma mutação altera o snapshot (ex.: aprovar um relatório direto da lista,
// sem abrir o card). Sem isso, o storage muda mas o estado React vivo fica defasado.
const accumulatedReportsListeners = new Set<() => void>();

function notifyAccumulatedReportsListeners() {
  accumulatedReportsListeners.forEach(listener => {
    try {
      listener();
    } catch {
      // Um listener com falha não deve impedir os demais de sincronizar.
    }
  });
}

function accumulatedReportsStorageKey(filtersKey: string, userId?: string | null) {
  return `accumulated-reports:${userId || 'anonymous'}:${encodeURIComponent(filtersKey)}`;
}

function readAccumulatedReportsSnapshot(storageKey: string): AccumulatedReportsSnapshot | null {
  const memorySnapshot = accumulatedReportsSnapshots.get(storageKey);
  if (memorySnapshot && Date.now() - memorySnapshot.savedAt <= ACCUMULATED_REPORTS_STORAGE_TTL_MS) {
    return memorySnapshot;
  }
  if (memorySnapshot) {
    accumulatedReportsSnapshots.delete(storageKey);
  }
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AccumulatedReportsSnapshot>;
    if (
      parsed.version !== ACCUMULATED_REPORTS_STORAGE_VERSION
      || !Array.isArray(parsed.items)
      || typeof parsed.page !== 'number'
      || Date.now() - Number(parsed.savedAt || 0) > ACCUMULATED_REPORTS_STORAGE_TTL_MS
    ) {
      window.sessionStorage.removeItem(storageKey);
      return null;
    }
    const snapshot: AccumulatedReportsSnapshot = {
      version: ACCUMULATED_REPORTS_STORAGE_VERSION,
      savedAt: Number(parsed.savedAt),
      page: Math.max(1, Math.floor(parsed.page)),
      items: parsed.items,
      groupLoadedCounts: parsed.groupLoadedCounts && typeof parsed.groupLoadedCounts === 'object' ? parsed.groupLoadedCounts : {},
      groupTotals: parsed.groupTotals && typeof parsed.groupTotals === 'object' ? parsed.groupTotals : {}
    };
    accumulatedReportsSnapshots.set(storageKey, snapshot);
    return snapshot;
  } catch {
    return null;
  }
}

function writeAccumulatedReportsSnapshot(storageKey: string, snapshot: Omit<AccumulatedReportsSnapshot, 'version' | 'savedAt'>) {
  const nextSnapshot: AccumulatedReportsSnapshot = {
    version: ACCUMULATED_REPORTS_STORAGE_VERSION,
    savedAt: Date.now(),
    ...snapshot
  };
  accumulatedReportsSnapshots.set(storageKey, nextSnapshot);
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(nextSnapshot));
  } catch {
    // Ignore storage quota/private mode failures; the in-memory accumulated state still works.
  }
}

function clearAccumulatedReportsSnapshots(userId?: string | null) {
  const prefix = `accumulated-reports:${userId || 'anonymous'}:`;
  Array.from(accumulatedReportsSnapshots.keys())
    .filter(key => key.startsWith(prefix))
    .forEach(key => accumulatedReportsSnapshots.delete(key));
  if (typeof window !== 'undefined') {
    try {
      Object.keys(window.sessionStorage)
        .filter(key => key.startsWith(prefix))
        .forEach(key => window.sessionStorage.removeItem(key));
    } catch {
      // If storage is unavailable, there is nothing to clear.
    }
  }
  notifyAccumulatedReportsListeners();
}

function accumulatedReportsSnapshotKeys(userId?: string | null) {
  const prefix = `accumulated-reports:${userId || 'anonymous'}:`;
  const keys = new Set(Array.from(accumulatedReportsSnapshots.keys()).filter(key => key.startsWith(prefix)));
  if (typeof window !== 'undefined') {
    try {
      Object.keys(window.sessionStorage)
        .filter(key => key.startsWith(prefix))
        .forEach(key => keys.add(key));
    } catch {
      // If storage cannot be inspected, use the in-memory snapshots only.
    }
  }
  return Array.from(keys);
}

function filtersFromAccumulatedReportsStorageKey(storageKey: string, userId?: string | null): Omit<ReportPageFilters, 'page'> | null {
  const prefix = `accumulated-reports:${userId || 'anonymous'}:`;
  if (!storageKey.startsWith(prefix)) return null;
  try {
    return JSON.parse(decodeURIComponent(storageKey.slice(prefix.length))) as Omit<ReportPageFilters, 'page'>;
  } catch {
    return null;
  }
}

function normalizeReportSearchValue(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function reportMatchesSearch(report: ReportSummary, term?: string) {
  const normalizedTerm = normalizeReportSearchValue(term || '').trim();
  if (normalizedTerm.length < 2) return true;
  const parts = [
    report.reportType,
    report.sequenceNumber,
    report.status,
    report.reportDate,
    report.project?.code,
    report.project?.name,
    report.project?.clientName,
    report.project?.clientCnpj,
    report.createdBy?.name,
    report.createdBy?.collaborator?.name,
    report.overtimeReason,
    report.dailyDescription,
    report.reviewNotes,
    ...(report.collaborators || []).map(item => item.collaborator?.name),
    ...(report.services || []).flatMap(service => [
      service.serviceType,
      service.equipment?.code,
      service.equipment?.name,
      service.system,
      service.material
    ])
  ];
  return normalizeReportSearchValue(parts.join(' ')).includes(normalizedTerm);
}

function hasActiveClientRejection(report: ReportSummary) {
  const special = report.specialConditions || {};
  return Boolean(special.__clientRejectedAt && !special.__clientRejectionResolvedAt);
}

function reportMatchesAccumulatedReportsFilters(
  report: ReportSummary,
  filters: Omit<ReportPageFilters, 'page'>,
  userId?: string | null
) {
  if (report.deletedAt) return false;
  if (filters.status && report.status !== filters.status) return false;
  if (filters.statuses?.length && !filters.statuses.includes(report.status)) return false;
  if (filters.reviewQueue && !(['PENDING', 'RETURNED'].includes(report.status) || (report.status !== 'SIGNED' && hasActiveClientRejection(report)))) return false;
  if (filters.projectActive !== undefined && report.project?.isActive !== filters.projectActive) return false;
  if (filters.projectId && report.projectId !== filters.projectId) return false;
  if (filters.reportType && report.reportType !== filters.reportType) return false;
  if (filters.createdByUserId && report.createdByUserId !== filters.createdByUserId) return false;
  if (filters.createdBy && report.createdByUserId !== filters.createdBy) return false;
  if (filters.mine && report.createdByUserId !== userId) return false;
  if (!reportMatchesSearch(report, filters.search)) return false;
  return true;
}

function adjustGroupTotal(totals: Record<string, number>, key: string, delta: number) {
  if (totals[key] === undefined) return;
  totals[key] = Math.max(0, totals[key] + delta);
}

function updateAccumulatedReportsSnapshots(report: ReportSummary, userId?: string | null) {
  accumulatedReportsSnapshotKeys(userId).forEach(storageKey => {
    const snapshot = readAccumulatedReportsSnapshot(storageKey);
    const filters = filtersFromAccumulatedReportsStorageKey(storageKey, userId);
    if (!snapshot || !filters) return;
    const existing = snapshot.items.find(item => item.id === report.id);
    if (!existing) return;

    const groupTotals = { ...snapshot.groupTotals };
    const oldGroupKey = `${existing.projectId}-${existing.reportType}`;
    const nextGroupKey = `${report.projectId}-${report.reportType}`;
    const keepReport = reportMatchesAccumulatedReportsFilters(report, filters, userId);
    const items = keepReport
      ? snapshot.items.map(item => item.id === report.id ? report : item)
      : snapshot.items.filter(item => item.id !== report.id);

    if (!keepReport) {
      adjustGroupTotal(groupTotals, oldGroupKey, -1);
    } else if (oldGroupKey !== nextGroupKey) {
      adjustGroupTotal(groupTotals, oldGroupKey, -1);
      adjustGroupTotal(groupTotals, nextGroupKey, 1);
    }

    writeAccumulatedReportsSnapshot(storageKey, {
      page: snapshot.page,
      items,
      groupLoadedCounts: snapshot.groupLoadedCounts,
      groupTotals
    });
  });
  notifyAccumulatedReportsListeners();
}

export function useReports(filters?: ReportFilters) {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.reports(filters, user?.id),
    queryFn: () => listReports(filters)
  });
}

export function useReportsPage(filters: ReportPageFilters, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.reportPage(filters, user?.id),
    queryFn: () => listReportsPage(filters),
    enabled
  });
}

export function hasMoreReportProjects(
  pagination: ReportPagination | undefined,
  loadedProjectCount: number,
  projectTotal?: number
) {
  if (!pagination || pagination.page >= pagination.totalPages) return false;
  if (projectTotal === undefined) return true;
  return loadedProjectCount < projectTotal;
}

export function isFirstReportPageAlreadyCovered(
  currentItems: Pick<ReportSummary, 'id'>[],
  pageItems: Pick<ReportSummary, 'id'>[],
  page: number
) {
  return page <= 1
    && pageItems.length > 0
    && currentItems.length > pageItems.length
    && pageItems.every(report => currentItems.some(current => current.id === report.id));
}

export function mergeCoveredFirstReportPage<T extends { id: string }>(
  currentItems: T[],
  pageItems: T[],
  page: number
) {
  if (!isFirstReportPageAlreadyCovered(currentItems, pageItems, page)) return null;
  const pageItemsById = new Map(pageItems.map(report => [report.id, report]));
  return currentItems.map(report => pageItemsById.get(report.id) || report);
}

export function useAccumulatedReportsPage(filters: Omit<ReportPageFilters, 'page'>, enabled = true) {
  const { user } = useAuth();
  const filtersKey = useMemo(() => JSON.stringify(filters), [filters]);
  const storageUserId = user?.id || user?.username || null;
  const storageKey = useMemo(() => accumulatedReportsStorageKey(filtersKey, storageUserId), [filtersKey, storageUserId]);
  const initialSnapshot = useMemo(() => readAccumulatedReportsSnapshot(storageKey), [storageKey]);
  const [page, setPage] = useState(() => initialSnapshot?.page || 1);
  const [items, setItems] = useState<ReportSummary[]>(() => initialSnapshot?.items || []);
  const itemsRef = useRef<ReportSummary[]>(initialSnapshot?.items || []);
  const groupLoadedCountsRef = useRef<Record<string, number>>(initialSnapshot?.groupLoadedCounts || {});
  const groupPageLoadingKeysRef = useRef<Set<string>>(new Set());
  const [groupLoadingKeys, setGroupLoadingKeys] = useState<string[]>([]);
  const [groupErrorKeys, setGroupErrorKeys] = useState<string[]>([]);
  const [groupTotals, setGroupTotals] = useState<Record<string, number>>(() => initialSnapshot?.groupTotals || {});
  const [activeFiltersKey, setActiveFiltersKey] = useState(filtersKey);
  const activeStorageKeyRef = useRef(storageKey);
  const skipNextSnapshotWriteRef = useRef(false);
  const effectivePage = activeFiltersKey === filtersKey ? page : 1;
  const query = useReportsPage({ ...filters, page: effectivePage }, enabled);
  const pagination = query.data?.pagination;
  const loadedProjectCount = useMemo(
    () => new Set(items.map(report => report.projectId).filter(Boolean)).size,
    [items]
  );
  const projectTotal = query.data?.meta?.projectTotal;
  const hasMoreProjects = hasMoreReportProjects(pagination, loadedProjectCount, projectTotal);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    if (activeFiltersKey === filtersKey && activeStorageKeyRef.current === storageKey) return;
    const snapshot = readAccumulatedReportsSnapshot(storageKey);
    activeStorageKeyRef.current = storageKey;
    skipNextSnapshotWriteRef.current = true;
    setActiveFiltersKey(filtersKey);
    setPage(snapshot?.page || 1);
    itemsRef.current = snapshot?.items || [];
    groupLoadedCountsRef.current = snapshot?.groupLoadedCounts || {};
    groupPageLoadingKeysRef.current = new Set();
    setItems(snapshot?.items || []);
    setGroupTotals(snapshot?.groupTotals || {});
    setGroupLoadingKeys([]);
    setGroupErrorKeys([]);
  }, [activeFiltersKey, filtersKey, storageKey]);

  useEffect(() => {
    if (!enabled || activeFiltersKey !== filtersKey) return;
    if (skipNextSnapshotWriteRef.current) {
      skipNextSnapshotWriteRef.current = false;
      return;
    }
    writeAccumulatedReportsSnapshot(storageKey, {
      page,
      items,
      groupLoadedCounts: groupLoadedCountsRef.current,
      groupTotals
    });
  }, [activeFiltersKey, enabled, filtersKey, groupTotals, items, page, storageKey]);

  // Re-sincroniza a lista visível quando uma mutação altera o snapshot (aprovar/devolver/
  // assinar/excluir direto da lista). O snapshot já foi atualizado pela mutação; aqui só
  // refletimos essa verdade no estado React deste hook montado.
  useEffect(() => {
    const syncFromSnapshot = () => {
      const snapshot = readAccumulatedReportsSnapshot(activeStorageKeyRef.current);
      const nextItems = snapshot?.items || [];
      itemsRef.current = nextItems;
      setItems(nextItems);
      setGroupTotals(snapshot?.groupTotals || {});
      if (snapshot) setPage(snapshot.page);
    };
    accumulatedReportsListeners.add(syncFromSnapshot);
    return () => {
      accumulatedReportsListeners.delete(syncFromSnapshot);
    };
  }, []);

  useEffect(() => {
    const data = query.data;
    if (!data || !enabled || activeFiltersKey !== filtersKey) return;
    const currentItems = itemsRef.current;
    const mergedCoveredFirstPage = mergeCoveredFirstReportPage(currentItems, data.items, data.pagination.page);

    const groups = data.groups;
    if (groups) {
      setGroupTotals(current => {
        const next = data.pagination.page <= 1 && !mergedCoveredFirstPage ? {} : { ...current };
        groups.forEach(group => {
          next[`${group.projectId}-${group.reportType}`] = group.total;
        });
        return next;
      });
    }
    if (data.pagination.page <= 1) {
      const nextItems = mergedCoveredFirstPage || data.items;
      itemsRef.current = nextItems;
      setItems(nextItems);
      return;
    }

    const seen = new Set(currentItems.map(report => report.id));
    const existingProjectIds = new Set(currentItems.map(report => report.projectId));
    const next = [...currentItems];
    let appendedNewProject = false;
    data.items.forEach(report => {
      if (!existingProjectIds.has(report.projectId) && !seen.has(report.id)) {
        seen.add(report.id);
        next.push(report);
        appendedNewProject = true;
      }
    });
    itemsRef.current = next;
    setItems(next);

    const shouldAdvanceToNextProjectPage = !appendedNewProject
      && data.items.length > 0
      && data.pagination.page < data.pagination.totalPages;
    if (shouldAdvanceToNextProjectPage) {
      setPage(current => Math.max(current, data.pagination.page + 1));
    }
  }, [activeFiltersKey, enabled, filtersKey, query.data]);

  function loadMore() {
    if (!pagination || pagination.page >= pagination.totalPages) return;
    setPage(current => Math.min(pagination.totalPages, current + 1));
  }

  function groupKey(projectId: string, reportType: string) {
    return `${projectId}-${reportType}`;
  }

  function groupPageKey(projectId: string, reportType: string, pageSize: number, sortDirection?: 'asc' | 'desc') {
    return `${projectId}-${reportType}-${pageSize}-${sortDirection || 'asc'}`;
  }

  async function fetchGroupPage({
    projectId,
    reportType,
    page,
    pageSize,
    sortDirection
  }: {
    projectId: string;
    reportType: string;
    page: number;
    pageSize: number;
    sortDirection?: 'asc' | 'desc';
  }) {
    const loadingKey = groupKey(projectId, reportType);
    const pageKey = groupPageKey(projectId, reportType, pageSize, sortDirection);
    const requestKey = `${pageKey}-${page}`;
    if (groupPageLoadingKeysRef.current.has(requestKey)) return null;

    groupPageLoadingKeysRef.current.add(requestKey);
    setGroupLoadingKeys(current => current.includes(loadingKey) ? current : [...current, loadingKey]);
    setGroupErrorKeys(current => current.filter(key => key !== loadingKey));
    try {
      const data = await listReportsPage({
        ...filters,
        projectId,
        reportType,
        reportSort: sortDirection || 'asc',
        page,
        pageSize
      });
      groupLoadedCountsRef.current[pageKey] = Math.max(
        groupLoadedCountsRef.current[pageKey] || 0,
        Math.min(data.pagination.total, ((page - 1) * pageSize) + data.items.length)
      );
      setGroupTotals(current => {
        const next = { ...current, [loadingKey]: data.pagination.total };
        data.groups?.forEach(group => {
          next[groupKey(group.projectId, group.reportType)] = group.total;
        });
        return next;
      });
      setItems(current => {
        const seen = new Set(current.map(report => report.id));
        const next = [...current];
        data.items.forEach(report => {
          if (!seen.has(report.id)) {
            seen.add(report.id);
            next.push(report);
          }
        });
        itemsRef.current = next;
        return next;
      });
      return data;
    } catch (error) {
      setGroupErrorKeys(current => current.includes(loadingKey) ? current : [...current, loadingKey]);
      return null;
    } finally {
      groupPageLoadingKeysRef.current.delete(requestKey);
      setGroupLoadingKeys(current => current.filter(key => key !== loadingKey));
    }
  }

  async function ensureGroupPage({ projectId, reportType, pageSize, sortDirection }: Omit<LoadMoreReportGroupOptions, 'loadedCount'>) {
    const groupPageSize = pageSize || 10;
    const pageKey = groupPageKey(projectId, reportType, groupPageSize, sortDirection);
    const knownTotal = groupTotals[groupKey(projectId, reportType)];
    const expectedCount = knownTotal === undefined ? groupPageSize : Math.min(knownTotal, groupPageSize);
    if ((groupLoadedCountsRef.current[pageKey] || 0) >= expectedCount) return;
    await fetchGroupPage({ projectId, reportType, page: 1, pageSize: groupPageSize, sortDirection });
  }

  async function loadMoreGroup({ projectId, reportType, pageSize, sortDirection }: LoadMoreReportGroupOptions) {
    const groupKey = `${projectId}-${reportType}`;
    const knownTotal = groupTotals[groupKey];

    const groupPageSize = pageSize || 10;
    const loadedWindow = groupLoadedCountsRef.current[groupPageKey(projectId, reportType, groupPageSize, sortDirection)] || 0;
    if (knownTotal !== undefined && loadedWindow >= knownTotal) return;

    const nextGroupPage = Math.floor(loadedWindow / groupPageSize) + 1;
    const data = await fetchGroupPage({ projectId, reportType, page: nextGroupPage, pageSize: groupPageSize, sortDirection });
    return !!data;
  }

  function hasMoreGroup(projectId: string, reportType: string, loadedCount: number) {
    const groupKey = `${projectId}-${reportType}`;
    const knownTotal = groupTotals[groupKey];
    if (knownTotal !== undefined) return loadedCount < knownTotal;
    return false;
  }

  function isGroupPageReady(projectId: string, reportType: string, pageSize = 10, sortDirection?: 'asc' | 'desc') {
    const knownTotal = groupTotals[groupKey(projectId, reportType)];
    const expectedCount = knownTotal === undefined ? pageSize : Math.min(knownTotal, pageSize);
    return (groupLoadedCountsRef.current[groupPageKey(projectId, reportType, pageSize, sortDirection)] || 0) >= expectedCount;
  }

  function groupLoadedCount(projectId: string, reportType: string, pageSize = 10, sortDirection?: 'asc' | 'desc') {
    return groupLoadedCountsRef.current[groupPageKey(projectId, reportType, pageSize, sortDirection)] || 0;
  }

  function isGroupLoading(projectId: string, reportType: string) {
    return groupLoadingKeys.includes(`${projectId}-${reportType}`);
  }

  function isGroupError(projectId: string, reportType: string) {
    return groupErrorKeys.includes(`${projectId}-${reportType}`);
  }

  function groupTotal(projectId: string, reportType: string) {
    return groupTotals[`${projectId}-${reportType}`];
  }

  function projectTypeTotals(projectId: string): ReportGroupTotalEntry[] {
    const prefix = `${projectId}-`;
    return Object.entries(groupTotals)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, total]) => ({ reportType: key.slice(prefix.length), total }))
      .sort((a, b) => a.reportType.localeCompare(b.reportType));
  }

  return {
    ...query,
    items,
    pagination,
    hasMore: hasMoreProjects,
    loadMore,
    loadMoreGroup,
    ensureGroupPage,
    hasMoreGroup,
    isGroupPageReady,
    groupLoadedCount,
    isGroupLoading,
    isGroupError,
    groupTotal,
    projectTypeTotals,
    isLoadingInitial: query.isLoading && items.length === 0,
    isLoadingMore: query.isFetching && items.length > 0
  };
}

export function useReport(reportId: string, enabled = true) {
  return useQuery({
    queryKey: ['report', reportId],
    queryFn: () => getReport(reportId),
    enabled: enabled && !!reportId
  });
}

function isPaginatedReports(value: ReportSummary[] | PaginatedReports | undefined): value is PaginatedReports {
  return !!value && !Array.isArray(value) && Array.isArray(value.items) && !!value.pagination;
}

function updateReportCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  report: ReportSummary
) {
  queryClient.setQueryData(['report', report.id], report);
  queryClient.setQueriesData<ReportSummary[] | PaginatedReports>({ queryKey: ['reports'] }, current => {
    const list = Array.isArray(current) ? current : isPaginatedReports(current) ? current.items : undefined;
    if (!list?.length) return current;
    let found = false;
    const nextItems = list.map(item => {
      if (item.id !== report.id) return item;
      found = true;
      return report;
    });
    if (!found) return current;
    if (Array.isArray(current)) return nextItems;
    if (!isPaginatedReports(current)) return current;
    return { ...current, items: nextItems };
  });
}

function removeReportFromCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  reportId: string
) {
  queryClient.removeQueries({ queryKey: ['report', reportId] });
  queryClient.setQueriesData<ReportSummary[] | PaginatedReports>({ queryKey: ['reports'] }, current => {
    const list = Array.isArray(current) ? current : isPaginatedReports(current) ? current.items : undefined;
    if (!list?.length) return current;
    const nextItems = list.filter(report => report.id !== reportId);
    if (nextItems.length === list.length) return current;
    if (Array.isArray(current)) return nextItems;
    if (!isPaginatedReports(current)) return current;
    const total = Math.max(0, current.pagination.total - 1);
    return {
      ...current,
      items: nextItems,
      pagination: {
        ...current.pagination,
        total,
        totalPages: Math.max(1, Math.ceil(total / current.pagination.pageSize))
      }
    };
  });
}

export function useReportAudit(reportId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.reportAudit(reportId),
    queryFn: () => getReportAudit(reportId),
    enabled: enabled && !!reportId
  });
}

export function useReportMutations() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const reportStorageUserId = user?.id || user?.username || null;
  const clearAccumulatedReportsCache = () => clearAccumulatedReportsSnapshots(reportStorageUserId);
  const updateAccumulatedReportsCache = (report: ReportSummary) => updateAccumulatedReportsSnapshots(report, reportStorageUserId);
  const createMutation = useMutation({
    mutationFn: (payload: ReportPayload) => createReport(payload),
    onSuccess: report => {
      clearAccumulatedReportsCache();
      queryClient.setQueryData(['report', report.id], report);
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
    }
  });

  const createServiceOnlyMutation = useMutation({
    mutationFn: (payload: ServiceOnlyReportPayload) => createServiceOnlyReports(payload),
    onSuccess: reports => {
      clearAccumulatedReportsCache();
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
      reports.forEach(report => queryClient.invalidateQueries({ queryKey: ['report', report.id] }));
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Omit<ReportPayload, 'createdByUserId' | 'status'> }) =>
      updateReport(id, payload),
    onSuccess: report => {
      updateAccumulatedReportsCache(report);
      updateReportCaches(queryClient, report);
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['report', report.id] });
    }
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: { status: ReportStatus; reviewNotes?: string | null } }) =>
      updateReportStatus(id, payload),
    onSuccess: report => {
      updateAccumulatedReportsCache(report);
      updateReportCaches(queryClient, report);
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['report', report.id] });
    }
  });

  const requestSignatureMutation = useMutation({
    mutationFn: ({
      id,
      comment,
      signerName,
      signatureImageDataUrl,
      privacyNoticeAccepted,
      privacyNoticeVersion
    }: {
      id: string;
      comment?: string | null;
      signerName: string;
      signatureImageDataUrl: string;
      privacyNoticeAccepted: true;
      privacyNoticeVersion: string;
    }) =>
      requestReportSignature(id, { comment, signerName, signatureImageDataUrl, privacyNoticeAccepted, privacyNoticeVersion }),
    onSuccess: data => {
      updateAccumulatedReportsCache(data.report);
      updateReportCaches(queryClient, data.report);
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['report', data.report.id] });
      queryClient.invalidateQueries({ queryKey: queryKeys.reportAudit(data.report.id) });
    }
  });

  const clientReviewMutation = useMutation({
    mutationFn: ({
      id,
      payload
    }: {
      id: string;
      payload: { action: 'APPROVED' | 'REJECTED'; comment?: string | null };
    }) => createClientReportReview(id, payload),
    onSuccess: report => {
      updateAccumulatedReportsCache(report);
      updateReportCaches(queryClient, report);
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['report', report.id] });
    }
  });

  const deleteReport = useMutation({
    mutationFn: (id: string) => deleteReportApi(id),
    onSuccess: (_data, reportId) => {
      clearAccumulatedReportsCache();
      removeReportFromCaches(queryClient, reportId);
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
    }
  });

  const deleteService = useMutation({
    mutationFn: ({ reportId, serviceId }: { reportId: string; serviceId: string }) =>
      deleteReportService(reportId, serviceId),
    onSuccess: report => {
      updateAccumulatedReportsCache(report);
      updateReportCaches(queryClient, report);
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['report', report.id] });
    }
  });

  return {
    createReport: createMutation,
    createServiceOnlyReports: createServiceOnlyMutation,
    updateReport: updateMutation,
    updateStatus: updateStatusMutation,
    requestSignature: requestSignatureMutation,
    clientReview: clientReviewMutation,
    deleteReport,
    deleteService
  };
}
