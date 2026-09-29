import { useMemo, useState, type FormEvent } from 'react';

import type {
  CompanyEquipment,
  EquipmentCategory,
  EquipmentPayload,
  PdfUpload
} from '../../api/equipamentos';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Modal } from '../../components/ui/Modal';
import { PdfDropzone } from '../../components/ui/PdfDropzone';
import { Button } from '../../components/ui/ds';
import { dateInputValue, fileToDataUrl, formatDate } from './equipmentStatus';
import { ChecklistItemsEditor } from './ChecklistItemsEditor';

interface Props {
  open: boolean;
  category: EquipmentCategory;
  equipment: CompanyEquipment | null;
  saving: boolean;
  isManager: boolean;
  onClose: () => void;
  onSubmit: (payload: EquipmentPayload) => void;
}

async function pdfUpload(file: File | null): Promise<PdfUpload | undefined> {
  if (!file) return undefined;
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) throw new Error('O anexo deve ser um arquivo PDF.');
  return { fileName: file.name, mimeType: 'application/pdf', dataUrl: await fileToDataUrl(file) };
}

export function EquipmentFormModal({ open, category, equipment, saving, isManager, onClose, onSubmit }: Props) {
  const fields = useMemo(
    () => [...(category.fieldSchema || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [category.fieldSchema]
  );
  const canShowCalibrationHistory = Boolean(isManager && equipment && category.supportsCalibration);
  const [activeTab, setActiveTab] = useState<'dados' | 'historico'>('dados');

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
  const [hasChecklistOverride, setHasChecklistOverride] = useState(equipment?.checklistItems != null);
  const [checklistItems, setChecklistItems] = useState<string[]>(
    equipment?.checklistItems != null ? equipment.checklistItems : category.checklistItems || []
  );
  const [restoreChecklistConfirm, setRestoreChecklistConfirm] = useState(false);
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
        checklistItems: category.checklistEnabled
          ? (hasChecklistOverride ? checklistItems.map(item => item.trim()).filter(Boolean) : null)
          : undefined,
        calibrationCertificate,
        technicalDoc,
        removeCalibrationCertificate: removeCert,
        removeTechnicalDoc: removeDoc && !docFile
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível preparar o anexo.');
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { if (!saving) onClose(); }}
      appearance="design-system"
      title={equipment ? 'Editar equipamento' : 'Novo equipamento'}
      size="lg"
      panelClassName="equip-entity-modal"
      showCloseButton={!saving}
      closeOnEscape={!saving}
      footer={(
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" size="sm" type="submit" form="equipment-form" loading={saving}>Salvar</Button>
        </>
      )}
    >
      <form id="equipment-form" className="equip-form equip-entity-form" onSubmit={handleSubmit}>
        <p className="equip-entity-subtitle">{category.name}</p>

        {canShowCalibrationHistory && (
          <div className="equip-entity-tabs" role="tablist" aria-label="Seções do equipamento">
            <button
              className={activeTab === 'dados' ? 'active' : ''}
              type="button"
              role="tab"
              aria-selected={activeTab === 'dados'}
              onClick={() => setActiveTab('dados')}
            >
              Dados
            </button>
            <button
              className={activeTab === 'historico' ? 'active' : ''}
              type="button"
              role="tab"
              aria-selected={activeTab === 'historico'}
              onClick={() => setActiveTab('historico')}
            >
              Histórico de calibração
            </button>
          </div>
        )}

        {activeTab === 'dados' ? (
          <>
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
                      appearance="design-system"
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
                  appearance="design-system"
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

            {category.checklistEnabled && (
              <div className="equip-toggle-block">
                <div className="admin-toolbar">
                  <div>
                    <div className="sec">Checklist</div>
                    <div className="rel-meta">{hasChecklistOverride ? 'Lista própria do equipamento' : 'Herdado da categoria'}</div>
                  </div>
                  <Button
                    variant="secondary" size="sm"
                    disabled={!hasChecklistOverride || !isManager}
                    onClick={() => setRestoreChecklistConfirm(true)}
                  >
                    Restaurar padrão
                  </Button>
                </div>
                <ChecklistItemsEditor
                  appearance="design-system"
                  value={hasChecklistOverride ? checklistItems : category.checklistItems || []}
                  disabled={!isManager}
                  onChange={items => {
                    setHasChecklistOverride(true);
                    setChecklistItems(items);
                  }}
                />
              </div>
            )}
          </>
        ) : (
          <div className="equip-calibration-history" role="tabpanel" aria-label="Histórico de certificados de calibração">
            {[equipment?.calibrationCertificate, ...(equipment?.calibrationCertificateArchive || [])].filter(Boolean).map((certificate, index) => (
              <div className="equip-history-row" key={certificate!.id}>
                <div className="equip-history-meta">
                  <strong>{index === 0 ? 'Certificado atual' : `Certificado arquivado #${index}`}</strong>
                  <span>{formatDate(certificate!.createdAt)} · {certificate!.fileName}</span>
                </div>
                <a className="fv-button fv-button--secondary fv-button--sm equip-history-download" href={certificate!.publicUrl} target="_blank" rel="noreferrer">
                  Abrir PDF
                </a>
              </div>
            ))}
            {!equipment?.calibrationCertificate && !(equipment?.calibrationCertificateArchive || []).length && (
              <p className="rel-meta">Nenhum certificado de calibração cadastrado.</p>
            )}
          </div>
        )}

        {error && <p className="equip-form-error">{error}</p>}

      </form>
      <ConfirmDialog
        open={restoreChecklistConfirm}
        appearance="design-system"
        title="Restaurar checklist"
        description="A lista própria deste equipamento será substituída pelo padrão da categoria."
        confirmLabel="Restaurar"
        danger={false}
        onConfirm={() => {
          setHasChecklistOverride(false);
          setChecklistItems(category.checklistItems || []);
          setRestoreChecklistConfirm(false);
        }}
        onCancel={() => setRestoreChecklistConfirm(false)}
      />
    </Modal>
  );
}
