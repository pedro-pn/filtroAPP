import { useEffect, useMemo, useState } from 'react';

import type { ReportSummary } from '../../types/domain';
import { groupByProject } from '../../utils/groupByProject';
import { ProjectSortButton, compareReportTypes, sortProjectGroups, sortReportsInGroup, type ProjectSortDirection } from '../../utils/projectSort';
import { ReportSummaryCard } from './ReportSummaryCard';

interface GroupedReportListProps {
  reports: ReportSummary[];
  archived?: boolean;
  renderReport?: (report: ReportSummary) => React.ReactNode;
  renderTypeActions?: (reports: ReportSummary[]) => React.ReactNode;
  onLoadMoreType?: (params: {
    projectId: string;
    reportType: string;
    loadedCount: number;
    pageSize?: number;
    sortDirection?: ProjectSortDirection;
  }) => Promise<boolean | void> | boolean | void;
  onEnsureTypePage?: (params: {
    projectId: string;
    reportType: string;
    pageSize?: number;
    sortDirection?: ProjectSortDirection;
  }) => Promise<void> | void;
  isTypePageReady?: (projectId: string, reportType: string, pageSize?: number, sortDirection?: ProjectSortDirection) => boolean;
  getTypeLoadedCount?: (projectId: string, reportType: string, pageSize?: number, sortDirection?: ProjectSortDirection) => number;
  hasMoreType?: (projectId: string, reportType: string, loadedCount: number) => boolean;
  isTypeLoading?: (projectId: string, reportType: string) => boolean;
  isTypePageErrored?: (projectId: string, reportType: string) => boolean;
  getTypeTotal?: (projectId: string, reportType: string) => number | undefined;
  getProjectTypeTotals?: (projectId: string) => Array<{ reportType: string; total: number }>;
  sortDirection?: ProjectSortDirection;
  showTypeSort?: boolean;
  storageKey?: string;
  initialVisiblePerType?: number;
  loadMoreStep?: number;
}

export function GroupedReportList({
  reports,
  archived,
  renderReport,
  renderTypeActions,
  onLoadMoreType,
  onEnsureTypePage,
  isTypePageReady,
  getTypeLoadedCount,
  hasMoreType,
  isTypeLoading,
  isTypePageErrored,
  getTypeTotal,
  getProjectTypeTotals,
  sortDirection = 'asc',
  showTypeSort = false,
  storageKey,
  initialVisiblePerType = 10,
  loadMoreStep = 10
}: GroupedReportListProps) {
  const [closedProjects, setClosedProjects] = useState<string[]>([]);
  const [closedTypes, setClosedTypes] = useState<string[]>([]);
  const [visibleByType, setVisibleByType] = useState<Record<string, number>>({});
  const [typeSortDirections, setTypeSortDirections] = useState<Record<string, ProjectSortDirection>>({});
  const [storageLoaded, setStorageLoaded] = useState(!storageKey);

  const groups = useMemo(() => sortProjectGroups(groupByProject(reports), sortDirection), [reports, sortDirection]);
  const typePageRequests = useMemo(() => {
    if (!onEnsureTypePage) return [];
    return groups.flatMap(group => {
      if (closedProjects.includes(group.projectId)) return [];
      const typeGroups = group.reports.reduce<Record<string, ReportSummary[]>>((acc, report) => {
        if (!acc[report.reportType]) acc[report.reportType] = [];
        acc[report.reportType].push(report);
        return acc;
      }, {});
      getProjectTypeTotals?.(group.projectId).forEach(typeTotal => {
        if (!typeGroups[typeTotal.reportType]) typeGroups[typeTotal.reportType] = [];
      });
      return Object.entries(typeGroups)
        .filter(([reportType, typeReports]) => {
          const typeKey = `${group.projectId}-${reportType}`;
          const total = getTypeTotal?.(group.projectId, reportType) ?? typeReports.length;
          return total > 0 && !closedTypes.includes(typeKey);
        })
        .map(([reportType]) => ({
          projectId: group.projectId,
          reportType,
          pageSize: initialVisiblePerType,
          sortDirection: typeSortDirections[`${group.projectId}-${reportType}`] || 'asc'
        }));
    });
  }, [
    closedProjects,
    closedTypes,
    getProjectTypeTotals,
    getTypeTotal,
    groups,
    initialVisiblePerType,
    onEnsureTypePage,
    typeSortDirections
  ]);

  useEffect(() => {
    if (!storageKey) {
      setStorageLoaded(true);
      return;
    }
    setStorageLoaded(false);
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || '{}') as {
        closedProjects?: unknown;
        closedTypes?: unknown;
        typeSortDirections?: unknown;
      };
      setClosedProjects(Array.isArray(parsed.closedProjects) ? parsed.closedProjects.filter((id): id is string => typeof id === 'string') : []);
      setClosedTypes(Array.isArray(parsed.closedTypes) ? parsed.closedTypes.filter((id): id is string => typeof id === 'string') : []);
      setTypeSortDirections(parsed.typeSortDirections && typeof parsed.typeSortDirections === 'object'
        ? Object.fromEntries(Object.entries(parsed.typeSortDirections).filter((entry): entry is [string, ProjectSortDirection] => entry[1] === 'asc' || entry[1] === 'desc'))
        : {});
    } catch {
      setClosedProjects([]);
      setClosedTypes([]);
      setTypeSortDirections({});
    } finally {
      setStorageLoaded(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || !storageLoaded) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ closedProjects, closedTypes, typeSortDirections }));
    } catch {
      // localStorage can be unavailable in private or restricted contexts.
    }
  }, [closedProjects, closedTypes, storageKey, storageLoaded, typeSortDirections]);

  useEffect(() => {
    if (!onEnsureTypePage || !typePageRequests.length) return;
    typePageRequests.forEach(request => {
      void onEnsureTypePage(request);
    });
  }, [onEnsureTypePage, typePageRequests]);

  function toggleType(id: string) {
    setClosedTypes(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }

  function toggleProject(id: string) {
    setClosedProjects(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }

  function toggleTypeSort(id: string) {
    setTypeSortDirections(current => ({ ...current, [id]: (current[id] || 'asc') === 'asc' ? 'desc' : 'asc' }));
  }

  function visibleLimitForType(typeKey: string) {
    return visibleByType[typeKey] || initialVisiblePerType;
  }

  function loadMoreType(typeKey: string, total: number) {
    setVisibleByType(current => ({
      ...current,
      [typeKey]: Math.min(total, (current[typeKey] || initialVisiblePerType) + loadMoreStep)
    }));
  }

  async function handleLoadMoreType(
    projectId: string,
    reportType: string,
    typeKey: string,
    loadedCount: number,
    hasLoadedItemsToReveal: boolean,
    sortDirection: ProjectSortDirection
  ) {
    if (!hasLoadedItemsToReveal && onLoadMoreType) {
      const loaded = await onLoadMoreType({ projectId, reportType, loadedCount, pageSize: loadMoreStep, sortDirection });
      if (loaded === false) return;
    }
    setVisibleByType(current => ({
      ...current,
      [typeKey]: (current[typeKey] || initialVisiblePerType) + loadMoreStep
    }));
  }

  return (
    <>
      {groups.map(group => {
        const typeGroups = group.reports.reduce<Record<string, ReportSummary[]>>((acc, report) => {
          if (!acc[report.reportType]) acc[report.reportType] = [];
          acc[report.reportType].push(report);
          return acc;
        }, {});
        getProjectTypeTotals?.(group.projectId).forEach(typeTotal => {
          if (!typeGroups[typeTotal.reportType]) typeGroups[typeTotal.reportType] = [];
        });

        const projectLabel = group.projectCode
          ? `${group.projectCode} - ${group.projectName}`
          : group.projectName;

        return (
          <div className="card report-project-group" key={group.projectId}>
            <button
              type="button"
              className="project-group-toggle"
              onClick={() => toggleProject(group.projectId)}
            >
              <span className="sec">
                {projectLabel}
                {archived ? (
                  <span className="badge badge-rev" style={{ textTransform: 'none', marginLeft: 6 }}>
                    Arquivado
                  </span>
                ) : null}
              </span>
              <span className="group-chevron">{closedProjects.includes(group.projectId) ? '▸' : '▾'}</span>
            </button>

            {!closedProjects.includes(group.projectId) ? Object.entries(typeGroups).sort(([a], [b]) => compareReportTypes(a, b)).map(([reportType, typeReports]) => {
              const typeKey = `${group.projectId}-${reportType}`;
              const typeClosed = closedTypes.includes(typeKey);
              const typeSortDirection = typeSortDirections[typeKey] || 'asc';
              const sortedReports = sortReportsInGroup(typeReports, typeSortDirection);
              const visibleLimit = visibleLimitForType(typeKey);
              const totalReports = getTypeTotal?.(group.projectId, reportType) ?? typeReports.length;
              const typeErrored = isTypePageErrored?.(group.projectId, reportType) ?? false;
              const orderedLoadedCount = onEnsureTypePage
                ? Math.min(
                    getTypeLoadedCount?.(group.projectId, reportType, initialVisiblePerType, typeSortDirection) ?? 0,
                    totalReports
                  )
                : sortedReports.length;
              const needsOrderedPage = !!onEnsureTypePage
                && totalReports > 0
                && !typeErrored
                && !(isTypePageReady?.(group.projectId, reportType, initialVisiblePerType, typeSortDirection) ?? false);
              const orderedReports = sortedReports.slice(0, orderedLoadedCount);
              const visibleReports = needsOrderedPage ? [] : orderedReports.slice(0, visibleLimit);
              const hasLoadedItemsToReveal = !needsOrderedPage && visibleReports.length < orderedReports.length;
              const hasRemoteItemsToLoad = !hasLoadedItemsToReveal
                && (onEnsureTypePage
                  ? orderedLoadedCount < totalReports
                  : (hasMoreType?.(group.projectId, reportType, sortedReports.length) ?? false));
              const typeLoading = isTypeLoading?.(group.projectId, reportType) ?? false;

              return (
                <div className="report-type-group" key={typeKey}>
                  <div
                    className="report-type-header"
                    onClick={() => toggleType(typeKey)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleType(typeKey); } }}
                  >
                    <span className={`rtype-badge rtype-${reportType}`}>{reportType}</span>
                    <span className="rtype-count">
                      {visibleReports.length} de {totalReports} relatório{totalReports !== 1 ? 's' : ''}
                    </span>
                    {showTypeSort ? (
                      <span onClick={e => e.stopPropagation()}>
                        <ProjectSortButton direction={typeSortDirection} onToggle={() => toggleTypeSort(typeKey)} />
                      </span>
                    ) : null}
                    <span className="rtype-chevron">{typeClosed ? '▸' : '▾'}</span>
                  </div>
                  {!typeClosed ? (
                    <>
                      {renderTypeActions && visibleReports.length ? renderTypeActions(visibleReports) : null}
                      {needsOrderedPage ? (
                        <div className="placeholder-copy">Carregando relatórios...</div>
                      ) : null}
                      {typeErrored ? (
                        <div className="placeholder-copy">Não foi possível carregar os relatórios desta aba.</div>
                      ) : null}
                      {visibleReports.length ? (
                        <div className="report-type-list">
                          {visibleReports.map(report => (
                            renderReport ? renderReport(report) : <ReportSummaryCard key={report.id} report={report} />
                          ))}
                        </div>
                      ) : null}
                      {hasLoadedItemsToReveal || hasRemoteItemsToLoad ? (
                        <div className="admin-create-toolbar report-type-load-more">
                          <button
                            className="mini-btn"
                            type="button"
                            disabled={typeLoading}
                            onClick={() => {
                              if (hasLoadedItemsToReveal) {
                                loadMoreType(typeKey, sortedReports.length);
                                return;
                              }
                              void handleLoadMoreType(group.projectId, reportType, typeKey, sortedReports.length, hasLoadedItemsToReveal, typeSortDirection);
                            }}
                          >
                            {typeLoading ? 'Carregando...' : typeErrored ? 'Tentar novamente' : 'Carregar mais'}
                          </button>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              );
            }) : null}
          </div>
        );
      })}
    </>
  );
}
