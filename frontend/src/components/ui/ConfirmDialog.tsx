import { Modal } from './Modal';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  highlight?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
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
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
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
      <div className="admin-form-actions confirm-dialog-actions">
        <button className="secondary-button" type="button" onClick={onCancel}>{cancelLabel}</button>
        <button className={danger ? 'danger-button' : 'primary-button'} type="button" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}
