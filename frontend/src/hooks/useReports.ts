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

function accumulatedReportsStorageKey(filtersKey: string, userId?: string | null) {
  return `accumulated-reports:${userId || 'anonymous'}:${encodeURIComponent(filtersKey)}`;
}

function readAccumulatedReportsSnapshot(storageKey: string): AccumulatedReportsSnapshot | null {
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
    return {
      version: ACCUMULATED_REPORTS_STORAGE_VERSION,
      savedAt: Number(parsed.savedAt),
      page: Math.max(1, Math.floor(parsed.page)),
      items: parsed.items,
      groupLoadedCounts: parsed.groupLoadedCounts && typeof parsed.groupLoadedCounts === 'object' ? parsed.groupLoadedCounts : {},
      groupTotals: parsed.groupTotals && typeof parsed.groupTotals === 'object' ? parsed.groupTotals : {}
    };
  } catch {
    return null;
  }
}

function writeAccumulatedReportsSnapshot(storageKey: string, snapshot: Omit<AccumulatedReportsSnapshot, 'version' | 'savedAt'>) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify({
      version: ACCUMULATED_REPORTS_STORAGE_VERSION,
      savedAt: Date.now(),
      ...snapshot
    }));
  } catch {
    // Ignore storage quota/private mode failures; the in-memory accumulated state still works.
  }
}

function clearAccumulatedReportsSnapshots(userId?: string | null) {
  if (typeof window === 'undefined') return;
  try {
    const prefix = `accumulated-reports:${userId || 'anonymous'}:`;
    Object.keys(window.sessionStorage)
      .filter(key => key.startsWith(prefix))
      .forEach(key => window.sessionStorage.removeItem(key));
  } catch {
    // If storage is unavailable, there is nothing to clear.
  }
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
    if (activeFiltersKey === filtersKey) return;
    const snapshot = readAccumulatedReportsSnapshot(storageKey);
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
    writeAccumulatedReportsSnapshot(storageKey, {
      page,
      items,
      groupLoadedCounts: groupLoadedCountsRef.current,
      groupTotals
    });
  }, [activeFiltersKey, enabled, filtersKey, groupTotals, items, page, storageKey]);

  useEffect(() => {
    const data = query.data;
    if (!data || !enabled || activeFiltersKey !== filtersKey) return;
    const groups = data.groups;
    if (groups) {
      setGroupTotals(current => {
        const next = data.pagination.page <= 1 ? {} : { ...current };
        groups.forEach(group => {
          next[`${group.projectId}-${group.reportType}`] = group.total;
        });
        return next;
      });
    }
    const currentItems = itemsRef.current;
    if (data.pagination.page <= 1) {
      itemsRef.current = data.items;
      setItems(data.items);
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
  const clearAccumulatedReportsCache = () => clearAccumulatedReportsSnapshots(user?.id || user?.username || null);
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
      clearAccumulatedReportsCache();
      updateReportCaches(queryClient, report);
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
      queryClient.invalidateQueries({ queryKey: ['report', report.id] });
    }
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: { status: ReportStatus; reviewNotes?: string | null } }) =>
      updateReportStatus(id, payload),
    onSuccess: report => {
      clearAccumulatedReportsCache();
      updateReportCaches(queryClient, report);
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
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
      clearAccumulatedReportsCache();
      updateReportCaches(queryClient, data.report);
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
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
      clearAccumulatedReportsCache();
      updateReportCaches(queryClient, report);
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
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
      clearAccumulatedReportsCache();
      updateReportCaches(queryClient, report);
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
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
