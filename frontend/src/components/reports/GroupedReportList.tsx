import { useMemo, useState } from 'react';

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
}

export function GroupedReportList({
  reports,
  archived,
  renderReport,
  renderTypeActions,
  sortDirection = 'asc',
  showTypeSort = false
}: GroupedReportListProps) {
  const [closedProjects, setClosedProjects] = useState<string[]>([]);
  const [closedTypes, setClosedTypes] = useState<string[]>([]);
  const [typeSortDirections, setTypeSortDirections] = useState<Record<string, ProjectSortDirection>>({});

  const groups = useMemo(() => sortProjectGroups(groupByProject(reports), sortDirection), [reports, sortDirection]);

  function toggleProject(id: string) {
    setClosedProjects(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }

  function toggleType(id: string) {
    setClosedTypes(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }

  function toggleTypeSort(id: string) {
    setTypeSortDirections(current => ({ ...current, [id]: (current[id] || 'asc') === 'asc' ? 'desc' : 'asc' }));
  }

  return (
    <>
      {groups.map(group => {
        const projectClosed = closedProjects.includes(group.projectId);
        const typeGroups = group.reports.reduce<Record<string, ReportSummary[]>>((acc, report) => {
          if (!acc[report.reportType]) acc[report.reportType] = [];
          acc[report.reportType].push(report);
          return acc;
        }, {});

        return (
          <div className="report-project-group" key={group.projectId}>
            <button className="project-group-header project-group-toggle" type="button" onClick={() => toggleProject(group.projectId)}>
              <span className="project-group-code">{group.projectCode}</span>
              <span className={`project-group-name ${archived ? 'project-group-name--archived' : ''}`}>
                {group.projectName}
              </span>
              <span className="project-group-spacer" />
              {archived ? <span className="project-group-badge">Arquivado</span> : null}
              <span className="group-chevron">{projectClosed ? '▸' : '▾'}</span>
            </button>
            {!projectClosed ? (
              <div className="project-group-body">
                {Object.entries(typeGroups).sort(([a], [b]) => compareReportTypes(a, b)).map(([reportType, typeReports]) => {
                  const typeKey = `${group.projectId}-${reportType}`;
                  const typeClosed = closedTypes.includes(typeKey);
                  const typeSortDirection = typeSortDirections[typeKey] || 'asc';

                  return (
                    <section className="report-type-group" key={typeKey}>
                      <div className="report-type-header">
                        <button className="report-type-toggle" type="button" onClick={() => toggleType(typeKey)}>
                          <span className={`rtype-badge rtype-${reportType}`}>{reportType}</span>
                          <span className="rtype-count">
                            {typeReports.length} relatório{typeReports.length !== 1 ? 's' : ''}
                          </span>
                          <span className="group-chevron">{typeClosed ? '▸' : '▾'}</span>
                        </button>
                        {showTypeSort ? (
                          <ProjectSortButton direction={typeSortDirection} onToggle={() => toggleTypeSort(typeKey)} />
                        ) : null}
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
                    </section>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
