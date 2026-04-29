import type { ReportSummary } from '../types/domain';

export interface ProjectGroup {
  projectId: string;
  projectCode: string;
  projectName: string;
  isActive: boolean;
  reports: ReportSummary[];
}

export function groupByProject(reports: ReportSummary[]): ProjectGroup[] {
  const groups: ProjectGroup[] = [];
  const idx = new Map<string, number>();

  for (const report of reports) {
    const key = report.projectId;
    if (idx.has(key)) {
      groups[idx.get(key)!].reports.push(report);
    } else {
      idx.set(key, groups.length);
      groups.push({
        projectId: key,
        projectCode: report.project.code,
        projectName: report.project.name,
        isActive: report.project.isActive,
        reports: [report]
      });
    }
  }

  return groups;
}
