import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { z } from 'zod';

import {
  PROJECT_DOCUMENT_TYPE_OPTIONS,
  type ProjectDocument,
  type ProjectDocumentAcceptanceMode,
  type ProjectDocumentCreateInput,
  type ProjectDocumentRequirementStage,
  type ProjectDocumentType,
  type ProjectDocumentUpdateInput
} from '../../../api/projectDocuments';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';

const requirementOptions: Array<{ key: ProjectDocumentRequirementStage | ''; label: string }> = [
  { key: '', label: 'Não bloquear o fluxo' },
  { key: 'HANDOVER', label: 'Obrigatório para handover' },
  { key: 'MOBILIZATION', label: 'Obrigatório para mobilização' },
  { key: 'CLOSEOUT', label: 'Obrigatório para encerramento' }
];
const acceptanceOptions: Array<{ key: ProjectDocumentAcceptanceMode; label: string }> = [
  { key: 'NONE', label: 'Sem aceite' },
  { key: 'INTERNAL', label: 'Aceite interno' },
  { key: 'CLIENT', label: 'Aceite do cliente' },
  { key: 'SIGNATURE', label: 'Assinatura eletrônica' }
];
const fileAccept = '.pdf,.docx,.xlsx,.png,.jpg,.jpeg,.dwg,.dxf';

const documentSchema = z.object({
  type: z.enum(PROJECT_DOCUMENT_TYPE_OPTIONS.map(item => item.key)),
  title: z.string().trim().min(1, 'Informe o título.').max(160),
  description: z.string().trim().max(2000, 'A descrição deve ter no máximo 2000 caracteres.'),
  responsibleUserId: z.string(),
  requirementStage: z.enum(['', 'HANDOVER', 'MOBILIZATION', 'CLOSEOUT']),
  acceptanceMode: z.enum(['NONE', 'INTERNAL', 'CLIENT', 'SIGNATURE']),
  versionLabel: z.string().trim().max(80, 'A versão deve ter no máximo 80 caracteres.'),
  file: z.any()
});
type DocumentValues = z.infer<typeof documentSchema>;

const versionSchema = z.object({
  versionLabel: z.string().trim().max(80, 'A versão deve ter no máximo 80 caracteres.'),
  file: z.any().refine(value => value?.length === 1, 'Selecione o arquivo da nova versão.')
});
type VersionValues = z.infer<typeof versionSchema>;

const acceptanceSchema = z.object({
  status: z.enum(['ACCEPTED', 'REJECTED']),
  occurredOn: z.string().min(1, 'Informe a data da decisão.'),
  reference: z.string().trim().max(500),
  note: z.string().trim().max(2000)
});
type AcceptanceValues = z.infer<typeof acceptanceSchema>;

function fieldClass(error?: unknown) {
  return `field-group ${error ? 'field-invalid' : ''}`;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo selecionado.'));
    reader.readAsDataURL(file);
  });
}

export function ProjectDocumentForm({ document, allowedTypes, users, saving, onClose, onCreate, onUpdate }: {
  document?: ProjectDocument | null;
  allowedTypes: ProjectDocumentType[];
  users: Array<{ id: string; name: string }>;
  saving: boolean;
  onClose: () => void;
  onCreate: (input: ProjectDocumentCreateInput) => void;
  onUpdate: (documentId: string, input: ProjectDocumentUpdateInput) => void;
}) {
  const editing = Boolean(document);
  const { register, handleSubmit, reset, setError, formState: { errors, isDirty } } = useForm<DocumentValues>({
    resolver: zodResolver(documentSchema) as Resolver<DocumentValues>,
    defaultValues: {
      type: document?.type || allowedTypes[0] || 'OTHER',
      title: document?.title || '',
      description: document?.description || '',
      responsibleUserId: document?.responsible?.id || '',
      requirementStage: document?.requirementStage || '',
      acceptanceMode: document?.acceptanceMode || 'NONE',
      versionLabel: '',
      file: undefined
    }
  });
  useEffect(() => reset({
    type: document?.type || allowedTypes[0] || 'OTHER',
    title: document?.title || '',
    description: document?.description || '',
    responsibleUserId: document?.responsible?.id || '',
    requirementStage: document?.requirementStage || '',
    acceptanceMode: document?.acceptanceMode || 'NONE',
    versionLabel: '',
    file: undefined
  }), [allowedTypes, document, reset]);

  const submit = handleSubmit(async values => {
    const common = {
      type: values.type,
      title: values.title,
      description: values.description || null,
      responsibleUserId: values.responsibleUserId || null,
      requirementStage: values.requirementStage || null,
      acceptanceMode: values.acceptanceMode
    };
    if (document) {
      onUpdate(document.id, { expectedVersion: document.version, ...common });
      return;
    }
    const file = values.file?.[0] as File | undefined;
    if (file?.size && file.size > 20 * 1024 * 1024) {
      setError('file', { message: 'O arquivo deve ter no máximo 20 MB.' });
      return;
    }
    onCreate({
      ...common,
      ...(file ? { initialVersion: { versionLabel: values.versionLabel || null, fileName: file.name, dataUrl: await fileToDataUrl(file) } } : {})
    });
  });

  return <Modal open onClose={onClose} closeOnEscape={!saving} ariaLabelledBy="project-document-form-title" panelClassName="modal-card project-document-form-modal">
    <form className="project-document-form" noValidate onSubmit={submit}>
      <header><div><h3 id="project-document-form-title">{editing ? 'Editar documento' : 'Adicionar documento'}</h3><p>Defina a finalidade no fluxo e mantenha a versão vigente no próprio projeto.</p></div><button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="Fechar">×</button></header>
      <div className="project-document-form-body">
        <div className={fieldClass(errors.type)}><label htmlFor="project-document-type">Tipo *</label><select id="project-document-type" disabled={saving} aria-invalid={Boolean(errors.type)} {...register('type')}>{PROJECT_DOCUMENT_TYPE_OPTIONS.filter(item => allowedTypes.includes(item.key) || item.key === document?.type).map(item => <option value={item.key} key={item.key}>{item.label}</option>)}</select>{errors.type ? <span className="field-error">{errors.type.message}</span> : null}</div>
        <div className={fieldClass(errors.title)}><label htmlFor="project-document-title">Título *</label><input id="project-document-title" disabled={saving} aria-invalid={Boolean(errors.title)} {...register('title')} />{errors.title ? <span className="field-error">{errors.title.message}</span> : null}</div>
        <div className={fieldClass(errors.responsibleUserId)}><label htmlFor="project-document-responsible">Responsável</label><select id="project-document-responsible" disabled={saving} {...register('responsibleUserId')}><option value="">Não definido</option>{users.map(user => <option value={user.id} key={user.id}>{user.name}</option>)}</select></div>
        <div className={fieldClass(errors.requirementStage)}><label htmlFor="project-document-requirement">Exigência no fluxo</label><select id="project-document-requirement" disabled={saving} {...register('requirementStage')}>{requirementOptions.map(item => <option value={item.key} key={item.key || 'NONE'}>{item.label}</option>)}</select><small>O documento só bloqueará o Kanban se uma etapa obrigatória for escolhida.</small></div>
        <div className={fieldClass(errors.acceptanceMode)}><label htmlFor="project-document-acceptance">Aceite necessário</label><select id="project-document-acceptance" disabled={saving} {...register('acceptanceMode')}>{acceptanceOptions.map(item => <option value={item.key} key={item.key}>{item.label}</option>)}</select></div>
        <div className={`${fieldClass(errors.description)} project-document-wide-field`}><label htmlFor="project-document-description">Descrição</label><textarea id="project-document-description" rows={3} disabled={saving} aria-invalid={Boolean(errors.description)} {...register('description')} />{errors.description ? <span className="field-error">{errors.description.message}</span> : null}</div>
        {!editing ? <><div className={fieldClass(errors.file)}><label htmlFor="project-document-file">Arquivo inicial</label><input id="project-document-file" type="file" accept={fileAccept} disabled={saving} aria-invalid={Boolean(errors.file)} {...register('file')} />{errors.file ? <span className="field-error">{String(errors.file.message || '')}</span> : null}<small>PDF, DOCX, XLSX, PNG, JPEG, DWG ou DXF, até 20 MB.</small></div><div className={fieldClass(errors.versionLabel)}><label htmlFor="project-document-version-label">Identificação da versão</label><input id="project-document-version-label" placeholder="Ex.: Rev. 01" disabled={saving} {...register('versionLabel')} /></div></> : null}
      </div>
      <footer><Button type="button" variant="secondary" disabled={saving} onClick={onClose}>Cancelar</Button><Button type="submit" disabled={saving || (editing && !isDirty)}>{saving ? 'Salvando…' : 'Salvar documento'}</Button></footer>
    </form>
  </Modal>;
}

export function ProjectDocumentVersionForm({ document, saving, onClose, onSubmit }: { document: ProjectDocument; saving: boolean; onClose: () => void; onSubmit: (input: { expectedVersion: number; versionLabel?: string | null; fileName: string; dataUrl: string }) => void }) {
  const { register, handleSubmit, setError, formState: { errors } } = useForm<VersionValues>({ resolver: zodResolver(versionSchema) as Resolver<VersionValues>, defaultValues: { versionLabel: '', file: undefined } });
  return <Modal open onClose={onClose} closeOnEscape={!saving} ariaLabelledBy="project-document-version-title" panelClassName="modal-card project-document-form-modal is-compact"><form className="project-document-form" noValidate onSubmit={handleSubmit(async values => {
    const file = values.file[0] as File;
    if (file.size > 20 * 1024 * 1024) return setError('file', { message: 'O arquivo deve ter no máximo 20 MB.' });
    onSubmit({ expectedVersion: document.version, versionLabel: values.versionLabel || null, fileName: file.name, dataUrl: await fileToDataUrl(file) });
  })}><header><div><h3 id="project-document-version-title">Nova versão</h3><p>{document.title}</p></div><button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="Fechar">×</button></header><div className="project-document-form-body"><div className={fieldClass(errors.file)}><label htmlFor="project-document-new-file">Arquivo *</label><input id="project-document-new-file" type="file" accept={fileAccept} disabled={saving} aria-invalid={Boolean(errors.file)} {...register('file')} />{errors.file ? <span className="field-error">{String(errors.file.message || '')}</span> : null}</div><div className={fieldClass(errors.versionLabel)}><label htmlFor="project-document-new-version-label">Identificação da versão</label><input id="project-document-new-version-label" placeholder="Ex.: Rev. 02" disabled={saving} {...register('versionLabel')} /></div></div><footer><Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? 'Enviando…' : 'Adicionar versão'}</Button></footer></form></Modal>;
}

export function ProjectDocumentAcceptanceForm({ document, saving, onClose, onSubmit }: { document: ProjectDocument; saving: boolean; onClose: () => void; onSubmit: (input: { expectedVersion: number; versionId: string; status: 'ACCEPTED' | 'REJECTED'; occurredOn: string; reference?: string | null; note?: string | null }) => void }) {
  const version = document.currentVersion!;
  const { register, handleSubmit, formState: { errors } } = useForm<AcceptanceValues>({ resolver: zodResolver(acceptanceSchema), defaultValues: { status: version.acceptanceStatus === 'REJECTED' ? 'REJECTED' : 'ACCEPTED', occurredOn: new Date().toISOString().slice(0, 10), reference: version.acceptanceReference || '', note: version.acceptanceNote || '' } });
  return <Modal open onClose={onClose} closeOnEscape={!saving} ariaLabelledBy="project-document-acceptance-title" panelClassName="modal-card project-document-form-modal is-compact"><form className="project-document-form" noValidate onSubmit={handleSubmit(values => onSubmit({ expectedVersion: document.version, versionId: version.id, status: values.status, occurredOn: values.occurredOn, reference: values.reference || null, note: values.note || null }))}><header><div><h3 id="project-document-acceptance-title">Registrar decisão</h3><p>{document.title} · versão {version.versionLabel || version.sequence}</p></div><button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="Fechar">×</button></header><div className="project-document-form-body"><div className={fieldClass(errors.status)}><label htmlFor="project-document-decision">Decisão *</label><select id="project-document-decision" disabled={saving} aria-invalid={Boolean(errors.status)} {...register('status')}><option value="ACCEPTED">Aceito</option><option value="REJECTED">Rejeitado</option></select></div><div className={fieldClass(errors.occurredOn)}><label htmlFor="project-document-decision-date">Data *</label><input id="project-document-decision-date" type="date" disabled={saving} aria-invalid={Boolean(errors.occurredOn)} {...register('occurredOn')} />{errors.occurredOn ? <span className="field-error">{errors.occurredOn.message}</span> : null}</div><div className={fieldClass(errors.reference)}><label htmlFor="project-document-decision-reference">Referência</label><input id="project-document-decision-reference" disabled={saving} {...register('reference')} /></div><div className={`${fieldClass(errors.note)} project-document-wide-field`}><label htmlFor="project-document-decision-note">Observação</label><textarea id="project-document-decision-note" rows={3} disabled={saving} {...register('note')} /></div></div><footer><Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Registrar decisão'}</Button></footer></form></Modal>;
}
