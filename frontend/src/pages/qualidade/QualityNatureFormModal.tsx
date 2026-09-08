import { useEffect, useState, type FormEvent } from 'react';

import type { QualityNature, QualityNaturePayload } from '../../api/qualidade';
import { Modal } from '../../components/ui/Modal';

interface Props {
  open: boolean;
  nature: QualityNature | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: QualityNaturePayload) => void;
}

export function QualityNatureFormModal({ open, nature, saving, onClose, onSubmit }: Props) {
  const [name, setName] = useState(nature?.name || '');
  const [submitted, setSubmitted] = useState(false);
  const nameError = submitted && !name.trim() ? 'Informe o nome da Natureza.' : '';

  useEffect(() => {
    if (!open) return;
    setName(nature?.name || '');
    setSubmitted(false);
  }, [nature, open]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (!name.trim()) return;
    onSubmit({ name: name.trim() });
  }

  return (
    <Modal open={open} onClose={onClose} ariaLabelledBy="quality-nature-form-title" panelClassName="modal-card equip-modal stock-modal">
      <form className="equip-form" onSubmit={handleSubmit} noValidate>
        <header className="equip-form-head equip-form-head-with-close">
          <h3 id="quality-nature-form-title">{nature ? 'Editar Natureza' : 'Nova Natureza'}</h3>
          <button
            className="equip-modal-close icon-button"
            type="button"
            aria-label="Fechar Natureza"
            title="Fechar"
            onClick={onClose}
            disabled={saving}
          >
            ×
          </button>
        </header>

        <div className={nameError ? 'field-group field-invalid' : 'field-group'}>
          <label htmlFor="quality-nature-name">Nome *</label>
          <input
            id="quality-nature-name"
            type="text"
            value={name}
            aria-invalid={Boolean(nameError) || undefined}
            aria-describedby={nameError ? 'quality-nature-name-error' : undefined}
            disabled={saving}
            onChange={event => setName(event.target.value)}
          />
          {nameError ? <small id="quality-nature-name-error" className="field-error">{nameError}</small> : null}
        </div>

        <div className="admin-form-actions equip-form-actions">
          <button className="mini-btn alt" type="button" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="mini-btn" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </Modal>
  );
}
