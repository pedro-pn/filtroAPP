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
import { Button, Field, Input, Select, Textarea } from '../../../components/ui/ds';
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

  return <Modal open onClose={onClose} closeOnEscape={!saving} appearance="design-system" title={editing ? 'Editar documento' : 'Adicionar documento'} size="lg" fullscreenOnMobile={false} panelClassName="efetivo-dialog project-document-form-modal" footer={<><Button variant="secondary" disabled={saving} onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="project-document-form" loading={saving} disabled={editing && !isDirty}>Salvar documento</Button></>}>
    <form id="project-document-form" className="project-document-form" noValidate onSubmit={submit}>
      <p className="efetivo-dialog-description">Defina a finalidade no fluxo e mantenha a versão vigente no próprio projeto.</p>
      <div className="project-document-form-body">
        <Field id="project-document-type" label="Tipo" required errorText={errors.type?.message}><Select disabled={saving} {...register('type')}>{PROJECT_DOCUMENT_TYPE_OPTIONS.filter(item => allowedTypes.includes(item.key) || item.key === document?.type).map(item => <option value={item.key} key={item.key}>{item.label}</option>)}</Select></Field>
        <Field id="project-document-title" label="Título" required errorText={errors.title?.message}><Input disabled={saving} {...register('title')} /></Field>
        <Field id="project-document-responsible" label="Responsável"><Select disabled={saving} {...register('responsibleUserId')}><option value="">Não definido</option>{users.map(user => <option value={user.id} key={user.id}>{user.name}</option>)}</Select></Field>
        <Field id="project-document-requirement" label="Exigência no fluxo" helperText="O documento só bloqueará o Kanban se uma etapa obrigatória for escolhida."><Select disabled={saving} {...register('requirementStage')}>{requirementOptions.map(item => <option value={item.key} key={item.key || 'NONE'}>{item.label}</option>)}</Select></Field>
        <Field id="project-document-acceptance" label="Aceite necessário"><Select disabled={saving} {...register('acceptanceMode')}>{acceptanceOptions.map(item => <option value={item.key} key={item.key}>{item.label}</option>)}</Select></Field>
        <Field id="project-document-description" label="Descrição" className="project-document-wide-field" errorText={errors.description?.message}><Textarea rows={3} disabled={saving} {...register('description')} /></Field>
        {!editing ? <>
          <Field id="project-document-file" label="Arquivo inicial" helperText="PDF, DOCX, XLSX, PNG, JPEG, DWG ou DXF, até 20 MB." errorText={errors.file ? String(errors.file.message || '') : undefined}><Input type="file" accept={fileAccept} disabled={saving} {...register('file')} /></Field>
          <Field id="project-document-version-label" label="Identificação da versão"><Input id="project-document-version-label-control" placeholder="Ex.: Rev. 01" disabled={saving} {...register('versionLabel')} /></Field>
        </> : null}
      </div>
    </form>
  </Modal>;
}

export function ProjectDocumentVersionForm({ document, saving, onClose, onSubmit }: { document: ProjectDocument; saving: boolean; onClose: () => void; onSubmit: (input: { expectedVersion: number; versionLabel?: string | null; fileName: string; dataUrl: string }) => void }) {
  const { register, handleSubmit, setError, formState: { errors } } = useForm<VersionValues>({ resolver: zodResolver(versionSchema) as Resolver<VersionValues>, defaultValues: { versionLabel: '', file: undefined } });
  return <Modal open onClose={onClose} closeOnEscape={!saving} appearance="design-system" title="Nova versão" size="md" fullscreenOnMobile={false} panelClassName="efetivo-dialog project-document-form-modal is-compact" footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button><Button variant="primary" type="submit" form="project-document-version-form" loading={saving}>Adicionar versão</Button></>}><form id="project-document-version-form" className="project-document-form" noValidate onSubmit={handleSubmit(async values => {
    const file = values.file[0] as File;
    if (file.size > 20 * 1024 * 1024) return setError('file', { message: 'O arquivo deve ter no máximo 20 MB.' });
    onSubmit({ expectedVersion: document.version, versionLabel: values.versionLabel || null, fileName: file.name, dataUrl: await fileToDataUrl(file) });
  })}>
    <p className="efetivo-dialog-description">{document.title}</p>
    <div className="project-document-form-body">
      <Field id="project-document-new-file" label="Arquivo" required errorText={errors.file ? String(errors.file.message || '') : undefined}><Input type="file" accept={fileAccept} disabled={saving} {...register('file')} /></Field>
      <Field id="project-document-new-version-label" label="Identificação da versão"><Input id="project-document-new-version-label-control" placeholder="Ex.: Rev. 02" disabled={saving} {...register('versionLabel')} /></Field>
    </div>
  </form></Modal>;
}

export function ProjectDocumentAcceptanceForm({ document, saving, onClose, onSubmit }: { document: ProjectDocument; saving: boolean; onClose: () => void; onSubmit: (input: { expectedVersion: number; versionId: string; status: 'ACCEPTED' | 'REJECTED'; occurredOn: string; reference?: string | null; note?: string | null }) => void }) {
  const version = document.currentVersion!;
  const { register, handleSubmit, formState: { errors } } = useForm<AcceptanceValues>({ resolver: zodResolver(acceptanceSchema), defaultValues: { status: version.acceptanceStatus === 'REJECTED' ? 'REJECTED' : 'ACCEPTED', occurredOn: new Date().toISOString().slice(0, 10), reference: version.acceptanceReference || '', note: version.acceptanceNote || '' } });
  return <Modal open onClose={onClose} closeOnEscape={!saving} appearance="design-system" title="Registrar decisão" size="md" fullscreenOnMobile={false} panelClassName="efetivo-dialog project-document-form-modal is-compact" footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button><Button variant="primary" type="submit" form="project-document-acceptance-form" loading={saving}>Registrar decisão</Button></>}><form id="project-document-acceptance-form" className="project-document-form" noValidate onSubmit={handleSubmit(values => onSubmit({ expectedVersion: document.version, versionId: version.id, status: values.status, occurredOn: values.occurredOn, reference: values.reference || null, note: values.note || null }))}>
    <p className="efetivo-dialog-description">{document.title} · versão {version.versionLabel || version.sequence}</p>
    <div className="project-document-form-body">
      <Field id="project-document-decision" label="Decisão" required errorText={errors.status?.message}><Select disabled={saving} {...register('status')}><option value="ACCEPTED">Aceito</option><option value="REJECTED">Rejeitado</option></Select></Field>
      <Field id="project-document-decision-date" label="Data" required errorText={errors.occurredOn?.message}><Input type="date" disabled={saving} {...register('occurredOn')} /></Field>
      <Field id="project-document-decision-reference" label="Referência"><Input disabled={saving} {...register('reference')} /></Field>
      <Field id="project-document-decision-note" label="Observação" className="project-document-wide-field"><Textarea rows={3} disabled={saving} {...register('note')} /></Field>
    </div>
  </form></Modal>;
}
