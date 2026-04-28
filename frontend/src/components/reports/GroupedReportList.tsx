import { useMemo, useState } from 'react';

import type { ReportSummary } from '../../types/domain';
import { groupByProject } from '../../utils/groupByProject';
import { ReportSummaryCard } from './ReportSummaryCard';

interface GroupedReportListProps {
  reports: ReportSummary[];
  archived?: boolean;
  renderReport?: (report: ReportSummary) => React.ReactNode;
  renderTypeActions?: (reports: ReportSummary[]) => React.ReactNode;
}

export function GroupedReportList({ reports, archived, renderReport, renderTypeActions }: GroupedReportListProps) {
  const [closedProjects, setClosedProjects] = useState<string[]>([]);
  const [closedTypes, setClosedTypes] = useState<string[]>([]);

  const groups = useMemo(() => groupByProject(reports), [reports]);

  function toggleProject(id: string) {
    setClosedProjects(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }

  function toggleType(id: string) {
    setClosedTypes(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
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
                {Object.entries(typeGroups).map(([reportType, typeReports]) => {
                  const typeKey = `${group.projectId}-${reportType}`;
                  const typeClosed = closedTypes.includes(typeKey);

                  return (
                    <section className="report-type-group" key={typeKey}>
                      <button className="report-type-header" type="button" onClick={() => toggleType(typeKey)}>
                        <span className={`rtype-badge rtype-${reportType}`}>{reportType}</span>
                        <span className="rtype-count">
                          {typeReports.length} relatório{typeReports.length !== 1 ? 's' : ''}
                        </span>
                        <span className="group-chevron">{typeClosed ? '▸' : '▾'}</span>
                      </button>
                      {!typeClosed ? (
                        <>
                          {renderTypeActions ? renderTypeActions(typeReports) : null}
                          <div className="report-type-list">
                            {typeReports.map(report => (
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
