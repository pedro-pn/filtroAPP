import type { ProjectSortDirection } from '../../../utils/projectSort';
import { AppIcon } from '../../icons/AppIcon';
import { Button } from '../../ui/ds';
import { DS_ICONS } from '../../ui/ds/icons';

interface ManagerReportTypeSortButtonProps {
  reportType: string;
  direction: ProjectSortDirection;
  onToggle: () => void;
}

export function ManagerReportTypeSortButton({
  reportType,
  direction,
  onToggle
}: ManagerReportTypeSortButtonProps) {
  const nextDirectionLabel = direction === 'asc' ? 'decrescente' : 'crescente';

  return (
    <Button
      className="rdo-manager-report-type-sort"
      variant="secondary"
      size="sm"
      iconLeft={<AppIcon icon={DS_ICONS.sort} size="sm" />}
      aria-label={`Ordenar relatórios ${reportType} em ordem ${nextDirectionLabel}`}
      onClick={onToggle}
    >
      {direction === 'asc' ? 'A→Z' : 'Z→A'}
    </Button>
  );
}
