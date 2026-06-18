import { useMemo, useState, type FormEvent } from 'react';

import type {
  CompanyEquipment,
  EquipmentCategory,
  EquipmentPayload,
  PdfUpload
} from '../../api/equipamentos';
import { Modal } from '../../components/ui/Modal';
import { PdfDropzone } from '../../components/ui/PdfDropzone';
import { dateInputValue, fileToDataUrl } from './equipmentStatus';

interface Props {
  open: boolean;
  category: EquipmentCategory;
  equipment: CompanyEquipment | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: EquipmentPayload) => void;
}

async function pdfUpload(file: File | null): Promise<PdfUpload | undefined> {
  if (!file) return undefined;
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) throw new Error('O anexo deve ser um arquivo PDF.');
  return { fileName: file.name, mimeType: 'application/pdf', dataUrl: await fileToDataUrl(file) };
}

export function EquipmentFormModal({ open, category, equipment, saving, onClose, onSubmit }: Props) {
  const fields = useMemo(
    () => [...(category.fieldSchema || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [category.fieldSchema]
  );

  const [code, setCode] = useState(equipment?.code || '');
  const [name, setName] = useState(equipment?.name || '');
  const [attributes, setAttributes] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of category.fieldSchema || []) {
      const value = equipment?.attributes?.[field.key];
      initial[field.key] = value === undefined || value === null ? '' : String(value);
    }
    return initial;
  });
  const [hasCalibration, setHasCalibration] = useState(Boolean(equipment?.hasCalibration));
  const [calibratedAt, setCalibratedAt] = useState(dateInputValue(equipment?.calibratedAt));
  const [expiresAt, setExpiresAt] = useState(dateInputValue(equipment?.expiresAt));
  const [certFile, setCertFile] = useState<File | null>(null);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [removeCert, setRemoveCert] = useState(false);
  const [removeDoc, setRemoveDoc] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setAttribute(key: string, value: string) {
    setAttributes(prev => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (hasCalibration && (!calibratedAt || !expiresAt)) {
      setError('Informe as datas de calibração e vencimento.');
      return;
    }
    try {
      const [calibrationCertificate, technicalDoc] = await Promise.all([
        category.supportsCalibration && hasCalibration ? pdfUpload(certFile) : Promise.resolve(undefined),
        category.supportsTechnicalDoc ? pdfUpload(docFile) : Promise.resolve(undefined)
      ]);
      onSubmit({
        code: code.trim(),
        name: name.trim(),
        categoryId: category.id,
        attributes,
        hasCalibration: category.supportsCalibration ? hasCalibration : false,
        calibratedAt: hasCalibration ? calibratedAt : null,
        expiresAt: hasCalibration ? expiresAt : null,
        hasTechnicalDoc: category.supportsTechnicalDoc,
        calibrationCertificate,
        technicalDoc,
        removeCalibrationCertificate: removeCert && !certFile,
        removeTechnicalDoc: removeDoc && !docFile
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível preparar o anexo.');
    }
  }

  return (
    <Modal open={open} onClose={onClose} ariaLabelledBy="equipment-form-title" panelClassName="modal-card equip-modal">
      <form className="equip-form" onSubmit={handleSubmit}>
        <header className="equip-form-head">
          <h3 id="equipment-form-title">{equipment ? 'Editar equipamento' : 'Novo equipamento'}</h3>
          <span className="equip-form-sub">{category.name}</span>
        </header>

        <div className="field-group">
          <label htmlFor="equip-code">Código *</label>
          <input id="equip-code" type="text" value={code} required onChange={e => setCode(e.target.value)} />
        </div>
        <div className="field-group">
          <label htmlFor="equip-name">Nome / Identificação *</label>
          <input id="equip-name" type="text" value={name} required onChange={e => setName(e.target.value)} />
        </div>

        {fields.map(field => (
          <div className="field-group" key={field.key}>
            <label htmlFor={`equip-attr-${field.key}`}>{field.label}{field.required ? ' *' : ''}</label>
            {field.type === 'textarea' ? (
              <textarea
                id={`equip-attr-${field.key}`}
                value={attributes[field.key] || ''}
                required={field.required}
                onChange={e => setAttribute(field.key, e.target.value)}
              />
            ) : field.type === 'select' ? (
              <select
                id={`equip-attr-${field.key}`}
                value={attributes[field.key] || ''}
                required={field.required}
                onChange={e => setAttribute(field.key, e.target.value)}
              >
                <option value="">Selecione…</option>
                {(field.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            ) : (
              <input
                id={`equip-attr-${field.key}`}
                type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                value={attributes[field.key] || ''}
                required={field.required}
                onChange={e => setAttribute(field.key, e.target.value)}
              />
            )}
          </div>
        ))}

        {category.supportsCalibration && (
          <div className="equip-toggle-block">
            <label className="equip-toggle">
              <input type="checkbox" checked={hasCalibration} onChange={e => setHasCalibration(e.target.checked)} />
              <span>Possui calibração</span>
            </label>
            {hasCalibration && (
              <>
                <div className="equip-toggle-fields">
                  <div className="field-group">
                    <label htmlFor="equip-cal-at">Data de calibração *</label>
                    <input id="equip-cal-at" type="date" value={calibratedAt} onChange={e => setCalibratedAt(e.target.value)} />
                  </div>
                  <div className="field-group">
                    <label htmlFor="equip-exp-at">Vencimento *</label>
                    <input id="equip-exp-at" type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} />
                  </div>
                </div>
                <PdfDropzone
                  id="equip-cert"
                  label="Certificado de calibração (PDF)"
                  file={certFile}
                  onFile={setCertFile}
                  currentName={equipment?.calibrationCertificate?.fileName}
                  currentUrl={equipment?.calibrationCertificate?.publicUrl}
                  currentRemoved={removeCert}
                  onCurrentRemovedChange={setRemoveCert}
                />
              </>
            )}
          </div>
        )}

        {category.supportsTechnicalDoc && (
          <div className="equip-toggle-block">
            <PdfDropzone
              id="equip-doc"
              label="Documentação técnica (PDF) — opcional"
              file={docFile}
              onFile={setDocFile}
              currentName={equipment?.technicalDoc?.fileName}
              currentUrl={equipment?.technicalDoc?.publicUrl}
              currentRemoved={removeDoc}
              onCurrentRemovedChange={setRemoveDoc}
            />
          </div>
        )}

        {error && <p className="equip-form-error">{error}</p>}

        <div className="admin-form-actions equip-form-actions">
          <button className="mini-btn alt" type="button" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="mini-btn" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </Modal>
  );
}
