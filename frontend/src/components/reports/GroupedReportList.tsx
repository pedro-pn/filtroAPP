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
  sortDirection?: ProjectSortDirection;
  showTypeSort?: boolean;
  storageKey?: string;
}

export function GroupedReportList({
  reports,
  archived,
  renderReport,
  renderTypeActions,
  sortDirection = 'asc',
  showTypeSort = false,
  storageKey
}: GroupedReportListProps) {
  const [closedProjects, setClosedProjects] = useState<string[]>([]);
  const [closedTypes, setClosedTypes] = useState<string[]>([]);
  const [typeSortDirections, setTypeSortDirections] = useState<Record<string, ProjectSortDirection>>({});
  const [storageLoaded, setStorageLoaded] = useState(!storageKey);

  const groups = useMemo(() => sortProjectGroups(groupByProject(reports), sortDirection), [reports, sortDirection]);

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

  function toggleType(id: string) {
    setClosedTypes(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }

  function toggleProject(id: string) {
    setClosedProjects(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }

  function toggleTypeSort(id: string) {
    setTypeSortDirections(current => ({ ...current, [id]: (current[id] || 'asc') === 'asc' ? 'desc' : 'asc' }));
  }

  return (
    <>
      {groups.map(group => {
        const typeGroups = group.reports.reduce<Record<string, ReportSummary[]>>((acc, report) => {
          if (!acc[report.reportType]) acc[report.reportType] = [];
          acc[report.reportType].push(report);
          return acc;
        }, {});

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
                      {typeReports.length} relatório{typeReports.length !== 1 ? 's' : ''}
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
                      {renderTypeActions ? renderTypeActions(typeReports) : null}
                      <div className="report-type-list">
                        {sortReportsInGroup(typeReports, typeSortDirection).map(report => (
                          renderReport ? renderReport(report) : <ReportSummaryCard key={report.id} report={report} />
                        ))}
                      </div>
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
