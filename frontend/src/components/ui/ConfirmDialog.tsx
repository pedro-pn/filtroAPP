import { useEffect, useState } from 'react';

import { Modal } from './Modal';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  highlight?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  confirmationText?: string;
  confirmationLabel?: string;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  highlight,
  confirmLabel = 'Remover',
  cancelLabel = 'Cancelar',
  danger = true,
  confirmationText,
  confirmationLabel = 'Digite para confirmar',
  confirmDisabled = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const [typedConfirmation, setTypedConfirmation] = useState('');
  useEffect(() => {
    if (!open) setTypedConfirmation('');
  }, [open]);
  const confirmationMatches = !confirmationText || typedConfirmation === confirmationText;
  return (
    <Modal
      open={open}
      onClose={onCancel}
      ariaLabelledBy="confirm-dialog-title"
      ariaDescribedBy="confirm-dialog-description"
      panelClassName="modal-card confirm-dialog"
    >
      <div className="section-title" id="confirm-dialog-title">{title}</div>
      {description ? <p className="placeholder-copy" id="confirm-dialog-description">{description}</p> : null}
      {highlight ? <div className="confirm-dialog-item"><strong>{highlight}</strong></div> : null}
      {confirmationText ? <div className={`field-group ${typedConfirmation && !confirmationMatches ? 'field-invalid' : ''}`}>
        <label htmlFor="confirm-dialog-text">{confirmationLabel}</label>
        <input id="confirm-dialog-text" value={typedConfirmation} aria-invalid={Boolean(typedConfirmation && !confirmationMatches)} onChange={event => setTypedConfirmation(event.target.value)} autoComplete="off" />
        {typedConfirmation && !confirmationMatches ? <div className="field-error">O texto informado não confere.</div> : null}
      </div> : null}
      <div className="admin-form-actions confirm-dialog-actions">
        <button className="secondary-button" type="button" onClick={onCancel}>{cancelLabel}</button>
        <button className={danger ? 'danger-button' : 'primary-button'} type="button" onClick={onConfirm} disabled={!confirmationMatches || confirmDisabled}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}
