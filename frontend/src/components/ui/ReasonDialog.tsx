import { useEffect, useRef, useState } from 'react';

import { Button as LegacyButton } from './Button';
import { Button, Field, Textarea } from './ds';
import { Modal } from './Modal';

export type ReasonDialogAppearance = 'legacy' | 'design-system';

interface ReasonDialogProps {
  open: boolean;
  title: string;
  description: string;
  label: string;
  confirmLabel: string;
  cancelLabel?: string;
  requiredMessage: string;
  isSubmitting?: boolean;
  appearance?: ReasonDialogAppearance;
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
  appearance = 'legacy',
  onCancel,
  onConfirm
}: ReasonDialogProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const reasonInputRef = useRef<HTMLTextAreaElement>(null);

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

  function handleReasonChange(value: string) {
    setReason(value);
    if (error) setError('');
  }

  if (appearance === 'design-system') {
    return (
      <Modal
        open={open}
        onClose={onCancel}
        appearance={appearance}
        size="sm"
        title={title}
        ariaLabelledBy="reason-dialog-title"
        ariaDescribedBy="reason-dialog-description"
        panelClassName="reason-dialog reason-dialog--design-system"
        initialFocusRef={reasonInputRef}
        footer={
          <>
            <Button
              variant="secondary"
              size="lg"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              {cancelLabel}
            </Button>
            <Button
              variant="primary"
              size="lg"
              onClick={handleConfirm}
              disabled={isSubmitting}
            >
              {confirmLabel}
            </Button>
          </>
        }
      >
        <div className="reason-dialog__content">
          <p
            className="reason-dialog__description"
            id="reason-dialog-description"
          >
            {description}
          </p>
          <Field
            id="reason-dialog-text"
            label={label}
            required
            errorText={error || undefined}
          >
            <Textarea
              ref={reasonInputRef}
              size="lg"
              rows={4}
              value={reason}
              onChange={(event) => handleReasonChange(event.target.value)}
            />
          </Field>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onCancel}
      ariaLabelledBy="reason-dialog-title"
      ariaDescribedBy="reason-dialog-description"
      panelClassName="modal-card reason-dialog"
    >
      <div className="section-title" id="reason-dialog-title">
        {title}
      </div>
      <p className="placeholder-copy" id="reason-dialog-description">
        {description}
      </p>
      <div className="field-group">
        <label htmlFor="reason-dialog-text">{label}</label>
        <textarea
          ref={reasonInputRef}
          id="reason-dialog-text"
          rows={4}
          value={reason}
          onChange={(event) => handleReasonChange(event.target.value)}
          autoFocus
        />
      </div>
      {error ? <div className="inline-error">{error}</div> : null}
      <div className="admin-form-actions reason-dialog-actions">
        <LegacyButton
          variant="secondary"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          {cancelLabel}
        </LegacyButton>
        <LegacyButton onClick={handleConfirm} disabled={isSubmitting}>
          {confirmLabel}
        </LegacyButton>
      </div>
    </Modal>
  );
}
