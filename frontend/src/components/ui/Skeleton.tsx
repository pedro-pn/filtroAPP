import { Skeleton as SharedSkeleton } from './ds/Skeleton';

interface SkeletonProps {
  lines?: number;
  className?: string;
}

export function Skeleton({ lines = 3, className = '' }: SkeletonProps) {
  return <SharedSkeleton variant="text" lines={lines} className={className} />;
}

interface ReportListSkeletonProps {
  groups?: number;
  rowsPerGroup?: number;
}

export function ReportListSkeleton({ groups = 2, rowsPerGroup = 3 }: ReportListSkeletonProps) {
  return <SharedSkeleton variant="table-rows" lines={groups * rowsPerGroup} label="Carregando relatórios" />;
}
