import { Button, StatusPill } from '../ui/ds';

interface CollaboratorListToolbarActionsProps {
  showInactive: boolean;
  inactiveCount: number;
  onToggleInactive: () => void;
  onNew: () => void;
}

export function CollaboratorListToolbarActions({
  showInactive,
  inactiveCount,
  onToggleInactive,
  onNew
}: CollaboratorListToolbarActionsProps) {
  return (
    <div className="rdo-admin-toolbar__actions">
      <Button
        variant="secondary"
        size="sm"
        type="button"
        onClick={onToggleInactive}
      >
        {showInactive
          ? 'Ver ativos'
          : `Ver inativos${inactiveCount ? ` (${inactiveCount})` : ''}`}
      </Button>
      <Button variant="primary" size="sm" type="button" onClick={onNew}>
        + Novo colaborador
      </Button>
    </div>
  );
}

export function CollaboratorStatusPill({ isActive }: { isActive?: boolean }) {
  const active = isActive !== false;
  return (
    <StatusPill
      status={active ? 'active' : 'inactive'}
      label={active ? 'Ativo' : 'Inativo'}
      tone={active ? 'success' : 'neutral'}
    />
  );
}
