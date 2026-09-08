import { useEffect, useMemo, useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { z } from 'zod';

import type {
  QualityEvidence,
  QualityEvidenceUpload,
  QualityEvidencePayload,
  QualityNature,
  QualityRecord,
  QualityRecordPayload,
  QualityRecordUpdatePayload,
  QualityRecordType,
  QualityImpact,
  QualityDisposition,
  QualityStatus,
  QualityProjectOption
} from '../../api/qualidade';
import { Modal } from '../../components/ui/Modal';
import { PdfDropzone } from '../../components/ui/PdfDropzone';
import { makeQualidadeSchemas } from '../../../../shared/schemas/qualidade.js';

interface Props {
  open: boolean;
  record: QualityRecord | null;
  projects: QualityProjectOption[];
  natures: QualityNature[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: QualityRecordPayload | QualityRecordUpdatePayload) => void;
}

interface QualityRecordFormValues {
  type: QualityRecordType;
  registeredAt: string;
  origin: string;
  projectId: string;
  eventDate: string;
  natureId: string;
  description: string;
  impact: QualityImpact | '';
  linkedRnc: string;
  disposition: QualityDisposition | '';
  definedAction: string;
  actionOwner: string;
  actionDeadline: string;
  resultVerification: string;
  status: QualityStatus | '';
}

type EvidenceLinkDraft = {
  id?: string;
  url: string;
  label?: string | null;
};

type EvidenceFileDraft = {
  id: string;
  file: File;
};

const schemas = makeQualidadeSchemas(z);

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function optionalValue(value: string) {
  const text = String(value || '').trim();
  return text || null;
}

function mimeTypeFor(file: File) {
  const explicit = String(file.type || '').trim();
  if (explicit) return explicit;
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.webp')) return 'image/webp';
  return '';
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const mimeType = mimeTypeFor(file);
      if (mimeType && /^data:(?:application\/octet-stream)?;base64,/i.test(result)) {
        resolve(result.replace(/^data:(?:application\/octet-stream)?;base64,/i, `data:${mimeType};base64,`));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function evidenceUpload(file: File | null): Promise<QualityEvidenceUpload | undefined> {
  if (!file) return undefined;
  const mimeType = mimeTypeFor(file);
  const name = file.name.toLowerCase();
  const allowed = mimeType === 'application/pdf'
    || mimeType.startsWith('image/')
    || /\.(pdf|png|jpe?g|webp)$/i.test(name);
  if (!allowed) throw new Error('A evidência deve ser uma imagem ou PDF.');
  return { kind: 'ATTACHMENT', fileName: file.name, mimeType, dataUrl: await fileToDataUrl(file) };
}

function isEvidenceFile(file: File) {
  const mimeType = mimeTypeFor(file);
  return mimeType === 'application/pdf'
    || mimeType.startsWith('image/')
    || /\.(pdf|png|jpe?g|webp)$/i.test(file.name);
}

function evidenceLinksFor(record: QualityRecord | null): EvidenceLinkDraft[] {
  const links = (record?.evidences || [])
    .filter(evidence => evidence.kind === 'LINK' && evidence.url)
    .map(evidence => ({ id: evidence.id, url: evidence.url || '', label: evidence.label }))
    .filter(evidence => validEvidenceUrl(evidence.url));
  if (!links.length && record?.evidence && validEvidenceUrl(record.evidence)) {
    return [{ url: record.evidence, label: 'Evidência' }];
  }
  return links;
}

function evidenceFileDraftId(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`;
}

function validEvidenceUrl(value: string) {
  const text = String(value || '').trim();
  if (!text) return false;
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function valuesToPayload(values: QualityRecordFormValues): QualityRecordPayload {
  return {
    type: values.type,
    registeredAt: values.registeredAt,
    origin: optionalValue(values.origin),
    projectId: optionalValue(values.projectId),
    eventDate: values.eventDate,
    natureId: optionalValue(values.natureId),
    description: optionalValue(values.description),
    impact: values.impact || null,
    linkedRnc: optionalValue(values.linkedRnc),
    disposition: values.disposition || null,
    definedAction: optionalValue(values.definedAction),
    actionOwner: optionalValue(values.actionOwner),
    actionDeadline: optionalValue(values.actionDeadline),
    evidence: null,
    resultVerification: optionalValue(values.resultVerification),
    status: values.status || null
  };
}

function zodErrorToFormErrors(error: z.ZodError) {
  return error.issues.reduce<Record<string, { type: string; message: string }>>((acc, issue) => {
    const key = String(issue.path[0] || 'form');
    if (!acc[key]) acc[key] = { type: 'manual', message: issue.message };
    return acc;
  }, {});
}

function withoutRecordType(payload: QualityRecordPayload): QualityRecordUpdatePayload {
  const updatePayload: Partial<QualityRecordPayload> = { ...payload };
  delete updatePayload.type;
  return updatePayload as QualityRecordUpdatePayload;
}

function resolverFor(record: QualityRecord | null): Resolver<QualityRecordFormValues> {
  return async values => {
    const payload = valuesToPayload(values);
    const candidate = record ? withoutRecordType(payload) : payload;
    const schema = record ? schemas.recordUpdateForType(record.type) : schemas.recordCreate;
    const result = schema.safeParse(candidate);
    if (result.success) return { values, errors: {} };
    return { values: {}, errors: zodErrorToFormErrors(result.error) };
  };
}

function fieldClass(
  errors: Partial<Record<keyof QualityRecordFormValues, unknown>>,
  name: keyof QualityRecordFormValues,
  extraClass = ''
) {
  return ['field-group', errors[name] ? 'field-invalid' : '', extraClass].filter(Boolean).join(' ');
}

export function QualityRecordFormModal({ open, record, projects, natures, saving, onClose, onSubmit }: Props) {
  const [evidenceLinks, setEvidenceLinks] = useState<EvidenceLinkDraft[]>(() => evidenceLinksFor(record));
  const [newEvidenceFiles, setNewEvidenceFiles] = useState<EvidenceFileDraft[]>([]);
  const [removedEvidenceIds, setRemovedEvidenceIds] = useState<Set<string>>(() => new Set());
  const [submitError, setSubmitError] = useState<string | null>(null);

  const defaultValues = useMemo<QualityRecordFormValues>(() => ({
    type: record?.type || 'DESVIO',
    registeredAt: record?.registeredAt || todayDate(),
    origin: record?.origin || '',
    projectId: record?.projectId || '',
    eventDate: record?.eventDate || todayDate(),
    natureId: record?.natureId || '',
    description: record?.description || '',
    impact: record ? (record.impact || '') : 'BAIXO',
    linkedRnc: record?.linkedRnc || '',
    disposition: record ? (record.disposition || '') : 'MONITORAR',
    definedAction: record?.definedAction || '',
    actionOwner: record?.actionOwner || '',
    actionDeadline: record?.actionDeadline || '',
    resultVerification: record?.resultVerification || '',
    status: record ? (record.status || '') : 'ABERTO'
  }), [record]);

  const { register, handleSubmit, formState: { errors }, watch, clearErrors } = useForm<QualityRecordFormValues>({
    defaultValues,
    resolver: resolverFor(record)
  });
  const recordType = watch('type');
  const isDeviation = recordType === 'DESVIO';
  const disposition = watch('disposition');

  useEffect(() => {
    if (!open) return;
    setEvidenceLinks(evidenceLinksFor(record));
    setNewEvidenceFiles([]);
    setRemovedEvidenceIds(new Set());
    setSubmitError(null);
    clearErrors();
  }, [clearErrors, open, record]);

  const existingAttachments = (record?.evidences || [])
    .filter((evidence): evidence is QualityEvidence => evidence.kind === 'ATTACHMENT' && !removedEvidenceIds.has(evidence.id));

  function updateEvidenceLink(index: number, url: string) {
    setEvidenceLinks(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, url } : item));
    setSubmitError(null);
  }

  function addEvidenceLink() {
    setEvidenceLinks(current => [...current, { url: '' }]);
  }

  function removeEvidenceLink(index: number) {
    setEvidenceLinks(current => current.filter((_, itemIndex) => itemIndex !== index));
    setSubmitError(null);
  }

  function appendEvidenceFiles(files: File[]) {
    const invalid = files.find(file => !isEvidenceFile(file));
    if (invalid) {
      setSubmitError(`Arquivo inválido: ${invalid.name}. Use imagem ou PDF.`);
      return;
    }
    setNewEvidenceFiles(current => [
      ...current,
      ...files.map(file => ({ id: evidenceFileDraftId(file), file }))
    ]);
    setSubmitError(null);
  }

  function removeExistingEvidence(id: string) {
    setRemovedEvidenceIds(current => new Set([...current, id]));
    setSubmitError(null);
  }

  function removeNewEvidenceFile(id: string) {
    setNewEvidenceFiles(current => current.filter(item => item.id !== id));
    setSubmitError(null);
  }

  async function submit(values: QualityRecordFormValues) {
    setSubmitError(null);
    const payload = valuesToPayload(values);

    try {
      const evidences: QualityEvidencePayload[] = [];
      for (const link of evidenceLinks) {
        const url = optionalValue(link.url);
        if (!url) continue;
        if (!validEvidenceUrl(url)) {
          setSubmitError('Informe links de evidência válidos começando com http:// ou https://.');
          return;
        }
        evidences.push({ kind: 'LINK', id: link.id, label: link.label || null, url });
      }
      evidences.push(...existingAttachments.map(evidence => ({
        kind: 'ATTACHMENT' as const,
        id: evidence.id,
        label: evidence.label || null
      })));
      for (const draft of newEvidenceFiles) {
        const upload = await evidenceUpload(draft.file);
        if (upload) evidences.push(upload);
      }
      payload.evidences = evidences;
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Não foi possível preparar as evidências.');
      return;
    }

    if (record) {
      onSubmit(withoutRecordType(payload));
      return;
    }
    onSubmit(payload);
  }

  const availableNatures = natures.filter(nature => nature.isActive || nature.id === record?.natureId);

  return (
    <Modal open={open} onClose={onClose} ariaLabelledBy="quality-record-form-title" panelClassName="modal-card equip-modal stock-modal quality-modal">
      <button
        className="equip-modal-close-float icon-button"
        type="button"
        aria-label="Fechar registro"
        title="Fechar"
        onClick={onClose}
        disabled={saving}
      >
        ×
      </button>
      <form className="equip-form quality-form" onSubmit={handleSubmit(submit)} noValidate>
        <header className="equip-form-head has-float-close">
          <h3 id="quality-record-form-title">{record ? 'Editar registro' : 'Novo registro'}</h3>
          <span className="equip-form-sub">Qualidade</span>
        </header>

        {record ? (
          <div className="quality-readonly-strip">
            <div><span>Nº Registro</span><strong>{record.number}</strong></div>
            <div><span>Ocorrências 12m</span><strong>{record.occurrences12m}</strong></div>
            <div><span>Recorrente?</span><strong>{record.recurrent ? 'SIM' : 'não'}</strong></div>
          </div>
        ) : null}

        <div className="quality-form-grid">
          <div className={fieldClass(errors, 'type')}>
            <label htmlFor="quality-record-type">Tipo *</label>
            <select id="quality-record-type" disabled={Boolean(record) || saving} aria-invalid={Boolean(errors.type) || undefined} {...register('type')}>
              {schemas.typeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            {record ? <small className="rel-meta">Tipo imutável após a criação.</small> : null}
            {errors.type ? <small className="field-error">{errors.type.message}</small> : null}
          </div>

          <div className={fieldClass(errors, 'registeredAt')}>
            <label htmlFor="quality-registered-at">Data do Registro *</label>
            <input id="quality-registered-at" type="date" disabled={saving} aria-invalid={Boolean(errors.registeredAt) || undefined} {...register('registeredAt')} />
            {errors.registeredAt ? <small className="field-error">{errors.registeredAt.message}</small> : null}
          </div>

          <div className={fieldClass(errors, 'eventDate')}>
            <label htmlFor="quality-event-date">Data do Evento *</label>
            <input id="quality-event-date" type="date" disabled={saving} aria-invalid={Boolean(errors.eventDate) || undefined} {...register('eventDate')} />
            {errors.eventDate ? <small className="field-error">{errors.eventDate.message}</small> : null}
          </div>

          <div className={fieldClass(errors, 'projectId')}>
            <label htmlFor="quality-project">Obra/Projeto</label>
            <select id="quality-project" disabled={saving} aria-invalid={Boolean(errors.projectId) || undefined} {...register('projectId')}>
              <option value="">Interno/SGQ</option>
              {projects.map(project => (
                <option key={project.id} value={project.id}>{project.code} - {project.name}</option>
              ))}
            </select>
            {errors.projectId ? <small className="field-error">{errors.projectId.message}</small> : null}
          </div>

          <div className={fieldClass(errors, 'origin')}>
            <label htmlFor="quality-origin">Origem{isDeviation ? ' *' : ''}</label>
            <input id="quality-origin" type="text" disabled={saving} aria-invalid={Boolean(errors.origin) || undefined} {...register('origin')} />
            {errors.origin ? <small className="field-error">{errors.origin.message}</small> : null}
          </div>

          <div className={fieldClass(errors, 'natureId')}>
            <label htmlFor="quality-nature">Natureza{isDeviation ? ' *' : ''}</label>
            <select id="quality-nature" disabled={saving} aria-invalid={Boolean(errors.natureId) || undefined} {...register('natureId')}>
              <option value="">Selecione</option>
              {availableNatures.map(nature => (
                <option key={nature.id} value={nature.id}>
                  {nature.name}{nature.isActive ? '' : ' (inativa)'}
                </option>
              ))}
            </select>
            {errors.natureId ? <small className="field-error">{errors.natureId.message}</small> : null}
          </div>

          <div className={fieldClass(errors, 'impact')}>
            <label htmlFor="quality-impact">Impacto{isDeviation ? ' *' : ''}</label>
            <select id="quality-impact" disabled={saving} aria-invalid={Boolean(errors.impact) || undefined} {...register('impact')}>
              <option value="">Não informado</option>
              {schemas.impactOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            {errors.impact ? <small className="field-error">{errors.impact.message}</small> : null}
          </div>

          <div className={fieldClass(errors, 'status')}>
            <label htmlFor="quality-status">Status{isDeviation ? ' *' : ''}</label>
            <select id="quality-status" disabled={saving} aria-invalid={Boolean(errors.status) || undefined} {...register('status')}>
              <option value="">Não informado</option>
              {schemas.statusOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            {errors.status ? <small className="field-error">{errors.status.message}</small> : null}
          </div>

          <div className={fieldClass(errors, 'disposition')}>
            <label htmlFor="quality-disposition">Disposição{isDeviation ? ' *' : ''}</label>
            <select id="quality-disposition" disabled={saving} aria-invalid={Boolean(errors.disposition) || undefined} {...register('disposition')}>
              <option value="">Não informada</option>
              {schemas.dispositionOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            {errors.disposition ? <small className="field-error">{errors.disposition.message}</small> : null}
          </div>

          <div className={fieldClass(errors, 'actionDeadline')}>
            <label htmlFor="quality-action-deadline">Prazo da ação</label>
            <input id="quality-action-deadline" type="date" disabled={saving} aria-invalid={Boolean(errors.actionDeadline) || undefined} {...register('actionDeadline')} />
            {errors.actionDeadline ? <small className="field-error">{errors.actionDeadline.message}</small> : null}
          </div>

          <div className={fieldClass(errors, 'description', 'field-group-wide')}>
            <label htmlFor="quality-description">Descrição do evento{isDeviation ? ' *' : ''}</label>
            <textarea id="quality-description" rows={4} disabled={saving} aria-invalid={Boolean(errors.description) || undefined} {...register('description')} />
            {errors.description ? <small className="field-error">{errors.description.message}</small> : null}
          </div>

          <div className={fieldClass(errors, 'definedAction', 'field-group-wide')}>
            <label htmlFor="quality-defined-action">Ação definida{isDeviation && disposition === 'TRATAR' ? ' *' : ''}</label>
            <textarea id="quality-defined-action" rows={3} disabled={saving} aria-invalid={Boolean(errors.definedAction) || undefined} {...register('definedAction')} />
            {errors.definedAction ? <small className="field-error">{errors.definedAction.message}</small> : null}
          </div>

          <div className="field-group">
            <label htmlFor="quality-action-owner">Responsável pela ação</label>
            <input id="quality-action-owner" type="text" disabled={saving} {...register('actionOwner')} />
          </div>

          <div className="field-group">
            <label htmlFor="quality-rnc">RNC vinculada</label>
            <input id="quality-rnc" type="text" disabled={saving} {...register('linkedRnc')} />
          </div>

          <div className="field-group field-group-wide quality-evidence-block">
            <div className="quality-evidence-head">
              <label>Evidências</label>
              <button className="mini-btn alt quality-evidence-add-link" type="button" disabled={saving} onClick={addEvidenceLink}>Adicionar link</button>
            </div>
            <div className="quality-evidence-links-editor">
              {evidenceLinks.map((link, index) => (
                <div className="quality-evidence-link-row" key={link.id || `link-${index}`}>
                  <input
                    type="url"
                    placeholder="https://..."
                    value={link.url}
                    disabled={saving}
                    aria-label={`Link de evidência ${index + 1}`}
                    onChange={event => updateEvidenceLink(index, event.target.value)}
                  />
                  <button
                    className="mini-btn alt"
                    type="button"
                    disabled={saving}
                    onClick={() => removeEvidenceLink(index)}
                  >
                    Remover
                  </button>
                </div>
              ))}
            </div>

            <PdfDropzone
              id="quality-evidence-files"
              label="Anexos da evidência (imagens/PDFs)"
              file={null}
              onFile={file => { if (file) appendEvidenceFiles([file]); }}
              multiple
              onFiles={appendEvidenceFiles}
              accept="application/pdf,image/*,.pdf,.png,.jpg,.jpeg,.webp"
              emptyText="Arraste imagens ou PDFs aqui"
              emptyHint="ou clique para selecionar vários"
              disabled={saving}
            />

            {existingAttachments.length || newEvidenceFiles.length ? (
              <div className="quality-evidence-file-list">
                {existingAttachments.map(evidence => (
                  <div className="quality-evidence-file-row" key={evidence.id}>
                    {evidence.publicUrl ? (
                      <a className="equip-link" href={evidence.publicUrl} target="_blank" rel="noreferrer">
                        {evidence.fileName || 'Anexo'}
                      </a>
                    ) : (
                      <span>{evidence.fileName || 'Anexo'}</span>
                    )}
                    <button className="mini-btn alt" type="button" disabled={saving} onClick={() => removeExistingEvidence(evidence.id)}>
                      Remover
                    </button>
                  </div>
                ))}
                {newEvidenceFiles.map(draft => (
                  <div className="quality-evidence-file-row" key={draft.id}>
                    <span>{draft.file.name}</span>
                    <button className="mini-btn alt" type="button" disabled={saving} onClick={() => removeNewEvidenceFile(draft.id)}>
                      Remover
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            {submitError ? <small className="field-error">{submitError}</small> : null}
          </div>

          <div className="field-group field-group-wide">
            <label htmlFor="quality-result">Verificação do resultado</label>
            <textarea id="quality-result" rows={3} disabled={saving} {...register('resultVerification')} />
          </div>
        </div>

        <div className="admin-form-actions equip-form-actions">
          <button className="mini-btn alt" type="button" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="mini-btn" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </Modal>
  );
}
