import { AppIcon } from '../../components/icons/AppIcon';
import { Button, Select } from '../../components/ui/ds';
import { DS_ICONS } from '../../components/ui/ds/icons';

type NpsSortBy = 'project' | 'sentAt';
type SortDirection = 'asc' | 'desc';

interface NpsSortControlsProps {
  sortBy: NpsSortBy;
  direction: SortDirection;
  onSortByChange: (sortBy: NpsSortBy) => void;
  onDirectionChange: (direction: SortDirection) => void;
}

export function NpsSortControls({ sortBy, direction, onSortByChange, onDirectionChange }: NpsSortControlsProps) {
  const sortLabel = sortBy === 'sentAt'
    ? direction === 'asc' ? 'Mais antigas' : 'Mais recentes'
    : direction === 'asc' ? 'A–Z' : 'Z–A';
  const sortActionLabel = sortBy === 'sentAt'
    ? direction === 'asc' ? 'Ordenar envios do mais recente ao mais antigo' : 'Ordenar envios do mais antigo ao mais recente'
    : direction === 'asc' ? 'Ordenar projetos de Z a A' : 'Ordenar projetos de A a Z';

  return (
    <>
      <Select
        containerClassName="rdo-nps__sort-select"
        aria-label="Ordenar cards por"
        value={sortBy}
        onChange={(event) => {
          const nextSortBy = event.target.value as NpsSortBy;
          onSortByChange(nextSortBy);
          onDirectionChange(nextSortBy === 'sentAt' ? 'desc' : 'asc');
        }}
      >
        <option value="project">Projeto</option>
        <option value="sentAt">Data de envio</option>
      </Select>
      <Button
        variant="secondary"
        iconLeft={<AppIcon icon={DS_ICONS.sort} size="sm" />}
        aria-label={sortActionLabel}
        onClick={() => onDirectionChange(direction === 'asc' ? 'desc' : 'asc')}
      >
        <span className="rdo-sort-label rdo-sort-label--full">Ordenar por: {sortLabel}</span>
        <span className="rdo-sort-label rdo-sort-label--compact">{sortLabel}</span>
      </Button>
    </>
  );
}
