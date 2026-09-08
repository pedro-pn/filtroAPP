export type DraftSaveStatusValue = 'idle' | 'saving' | 'saved' | 'error';

const STATUS_LABELS: Record<DraftSaveStatusValue, string> = {
  idle: '',
  saving: 'Salvando rascunho...',
  saved: 'Rascunho salvo na nuvem',
  error: 'Falha ao salvar o rascunho'
};

export function DraftSaveStatus({
  status,
  visible
}: {
  status: DraftSaveStatusValue;
  visible: boolean;
}) {
  if (!visible) return null;
  return (
    <div className={`rdo-draft-save-status ${status}`} role="status" aria-live="polite">
      {STATUS_LABELS[status]}
    </div>
  );
}
