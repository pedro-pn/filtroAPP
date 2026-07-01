import type { ProjectSortDirection } from './projectSort';

export function ProjectSortButton({
  direction,
  onToggle
}: {
  direction: ProjectSortDirection;
  onToggle: () => void;
}) {
  return (
    <button className="secondary-button project-sort-button" type="button" title="Alternar ordem" onClick={onToggle}>
      {direction === 'asc' ? 'A→Z' : 'Z→A'}
    </button>
  );
}
