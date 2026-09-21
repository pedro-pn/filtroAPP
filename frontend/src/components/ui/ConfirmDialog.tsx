import { type ReactNode, useEffect, useState } from 'react';

import { Alert, Button, Field, Input } from './ds';
import { Modal, type ModalAppearance } from './Modal';

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
  children?: ReactNode;
  errorMessage?: string | null;
  appearance?: ModalAppearance;
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
  confirmationLabel,
  confirmDisabled = false,
  errorMessage,
  children,
  appearance = 'legacy',
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const [typedConfirmation, setTypedConfirmation] = useState('');
  useEffect(() => {
    if (!open) setTypedConfirmation('');
  }, [open]);
  const confirmationMatches = !confirmationText || typedConfirmation === confirmationText;
  const designSystem = appearance === 'design-system';
  const descriptionContent = description ? (
    <p className="placeholder-copy" id="confirm-dialog-description">{description}</p>
  ) : null;
  const highlightContent = highlight ? (
    <div className="confirm-dialog-item"><strong>{highlight}</strong></div>
  ) : null;
  const confirmationContent = confirmationText ? designSystem ? (
    <Field
      id="confirm-dialog-text"
      label={confirmationLabel ?? <>Digite <strong>{confirmationText}</strong> para confirmar</>}
      errorText={typedConfirmation && !confirmationMatches ? 'O texto informado não confere.' : undefined}
      optionalText={null}
    >
      <Input
        id="confirm-dialog-text-control"
        value={typedConfirmation}
        aria-invalid={Boolean(typedConfirmation && !confirmationMatches)}
        onChange={event => setTypedConfirmation(event.target.value)}
        autoComplete="off"
      />
    </Field>
  ) : (
    <div className={`field-group ${typedConfirmation && !confirmationMatches ? 'field-invalid' : ''}`}>
      <label htmlFor="confirm-dialog-text">{confirmationLabel ?? <>Digite <strong>{confirmationText}</strong> para confirmar</>}</label>
      <input id="confirm-dialog-text" value={typedConfirmation} aria-invalid={Boolean(typedConfirmation && !confirmationMatches)} onChange={event => setTypedConfirmation(event.target.value)} autoComplete="off" />
      {typedConfirmation && !confirmationMatches ? <div className="field-error">O texto informado não confere.</div> : null}
    </div>
  ) : null;
  const footer = designSystem ? (
    <>
      <Button variant="secondary" size="sm" type="button" onClick={onCancel}>{cancelLabel}</Button>
      <Button variant={danger ? 'danger' : 'primary'} size="sm" type="button" onClick={onConfirm} disabled={!confirmationMatches || confirmDisabled}>{confirmLabel}</Button>
    </>
  ) : undefined;
  const dialog = (
    <Modal
      open={open}
      onClose={onCancel}
      appearance={appearance}
      title={designSystem ? title : undefined}
      size="sm"
      fullscreenOnMobile={false}
      footer={footer}
      ariaLabelledBy="confirm-dialog-title"
      ariaDescribedBy={description ? 'confirm-dialog-description' : undefined}
      backdropClassName={designSystem ? 'confirm-dialog-backdrop' : 'modal-backdrop confirm-dialog-backdrop'}
      panelClassName={designSystem ? 'confirm-dialog' : 'modal-card confirm-dialog'}
    >
      {!designSystem ? <div className="section-title" id="confirm-dialog-title">{title}</div> : null}
      {descriptionContent}
      {highlightContent}
      {confirmationContent}
      {children}
      {errorMessage ? designSystem ? <Alert tone="danger">{errorMessage}</Alert> : <div className="form-error" role="alert">{errorMessage}</div> : null}
      {!designSystem ? (
        <div className="admin-form-actions confirm-dialog-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>{cancelLabel}</button>
          <button className={danger ? 'danger-button' : 'primary-button'} type="button" onClick={onConfirm} disabled={!confirmationMatches || confirmDisabled}>{confirmLabel}</button>
        </div>
      ) : null}
    </Modal>
  );
  return dialog;
}
