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
      {status === 'saving' ? <Spinner size="sm" decorative /> : null}
      {STATUS_LABELS[status] ? (
        <StatusPill
          status={status}
          label={STATUS_LABELS[status]}
          dot={status !== 'saving'}
          tone={
            status === 'saved'
              ? 'success'
              : status === 'error'
                ? 'danger'
                : 'info'
          }
        />
      ) : null}
    </div>
  );
}
import { Spinner, StatusPill } from '../ui/ds';
