import { Badge } from '../ui/ds';

import './ReportTypeBadge.css';

interface ReportTypeBadgeProps {
  reportType: string;
  className?: string;
}

function reportTypeToken(reportType: string) {
  return reportType
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');
}

export function ReportTypeBadge({
  reportType,
  className
}: ReportTypeBadgeProps) {
  return (
    <Badge
      className={['rdo-report-type-badge', className].filter(Boolean).join(' ')}
      tone="neutral"
      data-report-type={reportTypeToken(reportType)}
    >
      {reportType}
    </Badge>
  );
}
