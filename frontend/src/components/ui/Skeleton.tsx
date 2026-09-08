interface SkeletonProps {
  lines?: number;
  className?: string;
}

export function Skeleton({ lines = 3, className = '' }: SkeletonProps) {
  return (
    <div className={`skeleton-stack ${className}`.trim()} aria-label="Carregando">
      {Array.from({ length: lines }, (_, index) => (
        <span className="skeleton-line" key={index} />
      ))}
    </div>
  );
}

interface ReportListSkeletonProps {
  groups?: number;
  rowsPerGroup?: number;
}

export function ReportListSkeleton({ groups = 2, rowsPerGroup = 3 }: ReportListSkeletonProps) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando relatórios...</span>
      {Array.from({ length: groups }).map((_, groupIndex) => (
        <div className="card report-project-group skeleton-group" key={groupIndex}>
          <div className="skeleton skeleton-line skeleton-title" />
          {Array.from({ length: rowsPerGroup }).map((__, rowIndex) => (
            <div className="skeleton skeleton-row" key={rowIndex} />
          ))}
        </div>
      ))}
    </div>
  );
}
