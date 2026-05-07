import { useEffect, useState } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';

interface ReasonDialogProps {
  open: boolean;
  title: string;
  description: string;
  label: string;
  confirmLabel: string;
  cancelLabel?: string;
  requiredMessage: string;
  isSubmitting?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

export function ReasonDialog({
  open,
  title,
  description,
  label,
  confirmLabel,
  cancelLabel = 'Cancelar',
  requiredMessage,
  isSubmitting = false,
  onCancel,
  onConfirm
}: ReasonDialogProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setReason('');
    setError('');
  }, [open]);

  if (!open) return null;

  function handleConfirm() {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError(requiredMessage);
      return;
    }
    onConfirm(trimmed);
  }

  return (
    <Modal open={open} onClose={onCancel} ariaLabelledBy="reason-dialog-title" ariaDescribedBy="reason-dialog-description">
        <div className="section-title" id="reason-dialog-title">{title}</div>
        <p className="placeholder-copy" id="reason-dialog-description">{description}</p>
        <div className="field-group">
          <label htmlFor="reason-dialog-text">{label}</label>
          <textarea
            id="reason-dialog-text"
            rows={4}
            value={reason}
            onChange={event => {
              setReason(event.target.value);
              if (error) setError('');
            }}
            autoFocus
          />
        </div>
        {error ? <div className="inline-error">{error}</div> : null}
        <div className="admin-form-actions">
          <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
            {cancelLabel}
          </Button>
          <Button onClick={handleConfirm} disabled={isSubmitting}>
            {confirmLabel}
          </Button>
        </div>
      </Modal>
  );
}
