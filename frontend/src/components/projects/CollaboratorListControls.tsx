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
    <div className="admin-toolbar-actions">
      <button className="mini-btn alt" type="button" onClick={onToggleInactive}>
        {showInactive ? 'Ver ativos' : `Ver inativos${inactiveCount ? ` (${inactiveCount})` : ''}`}
      </button>
      <button className="mini-btn" type="button" onClick={onNew}>
        + Novo colaborador
      </button>
    </div>
  );
}

export function CollaboratorStatusPill({ isActive }: { isActive?: boolean }) {
  const active = isActive !== false;
  return <span className={`status-pill ${active ? 'status-approved' : 'status-returned'}`}>{active ? 'Ativo' : 'Inativo'}</span>;
}
