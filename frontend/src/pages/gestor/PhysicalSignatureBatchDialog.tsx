import { useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';

import { listReports } from '../../api/reports';
import type { Project } from '../../types/domain';
import { Modal } from '../../components/ui/Modal';
import { PdfDropzone } from '../../components/ui/PdfDropzone';
import { RemoveIconButton } from '../../components/ui/RemoveIconButton';
import { useToast } from '../../components/ui/ToastContext';
import { Alert, Button, Field, Select } from '../../components/ui/ds';
import {
  canReceivePhysicalSignature, physicalSignatureBatchErrors, suggestPhysicalSignatureReport,
  uploadPhysicalSignatureBatch, validatePhysicalSignatureFile,
  type PhysicalSignatureBatchFile, type PhysicalSignatureUpload
} from './physicalSignatureBatch';
import './PhysicalSignatureBatchDialog.css';

interface Props {
  projects: Project[];
  onClose: () => void;
  upload: (payload: PhysicalSignatureUpload) => Promise<unknown>;
}

export function PhysicalSignatureBatchDialog({ projects, onClose, upload }: Props) {
  const [projectId, setProjectId] = useState('');
  const [files, setFiles] = useState<PhysicalSignatureBatchFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const showToast = useToast();
  const candidates = useQuery({
    queryKey: ['physical-signature-candidates', projectId],
    queryFn: ({ signal }) => listReports({ projectId, status: 'APPROVED', reportType: 'RDO', summary: true }, signal),
    enabled: Boolean(projectId),
    select: reports => reports.filter(report => report.projectId === projectId && canReceivePhysicalSignature(report)),
    // Keep the chosen targets visible throughout the batch, including saved rows.
    staleTime: Infinity,
    gcTime: 0
  });
  const reports = [...(candidates.data || [])].sort((a, b) => (a.sequenceNumber || 0) - (b.sequenceNumber || 0));
  const errors = physicalSignatureBatchErrors(files, reports, projectId);
  const remaining = files.filter(file => file.status !== 'success');
  const savedCount = files.length - remaining.length;

  function updateFile(id: string, patch: Partial<PhysicalSignatureBatchFile>) {
    setFiles(current => current.map(file => file.id === id ? { ...file, ...patch } : file));
  }

  function addFiles(selected: File[]) {
    if (submittingRef.current || !projectId || !candidates.isSuccess) return;
    if (!selected.length) { setFiles(current => current.filter(file => file.status === 'success')); return; }
    const valid = selected.filter(file => !validatePhysicalSignatureFile(file));
    const invalid = selected.filter(file => validatePhysicalSignatureFile(file));
    if (invalid.length) showToast(invalid.map(file => `${file.name}: ${validatePhysicalSignatureFile(file)}`).join(' '), 'error');
    setFiles(current => {
      const available = reports.filter(report => !current.some(file => file.status === 'success' && file.reportId === report.id));
      const added = valid.filter(file => !current.some(entry => entry.file.name === file.name && entry.file.size === file.size && entry.file.lastModified === file.lastModified));
      return [...current, ...added.map(file => {
        const suggestion = suggestPhysicalSignatureReport(file.name, available, projectId);
        return { id: crypto.randomUUID(), file, ...suggestion, suggested: Boolean(suggestion.reportId), status: 'pending' as const };
      })];
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || !projectId || !remaining.length || Object.keys(errors).length) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const result = await uploadPhysicalSignatureBatch(files, reports, projectId, upload, updateFile);
      showToast(`${result.saved} PDF(s) registrado(s).${result.failed ? ` ${result.failed} arquivo(s) com erro; revise e tente novamente.` : ' Os RDOs e os relatórios de serviço vinculados foram atualizados.'}`, result.failed ? 'error' : 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível enviar o lote.', 'error');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return <Modal open onClose={() => { if (!submittingRef.current) onClose(); }} closeOnEscape={!submitting}
    showCloseButton={!submitting} appearance="design-system" size="lg"
    panelClassName="physical-signature-batch-dialog" title="Enviar RDOs assinados em lote"
    ariaDescribedBy="physical-signature-batch-description"
    footer={<>
      <Button variant="secondary" type="button" disabled={submitting} onClick={onClose}>{savedCount ? 'Fechar' : 'Cancelar'}</Button>
      {remaining.length || !savedCount ? <Button variant="primary" type="submit" form="physical-signature-batch-form"
        disabled={submitting || !projectId || candidates.isPending || candidates.isError || !remaining.length || Boolean(Object.keys(errors).length)} loading={submitting}>
        {submitting ? 'Enviando lote…' : `Enviar ${remaining.length || ''} PDF${remaining.length === 1 ? '' : 's'} vinculado${remaining.length === 1 ? '' : 's'}`}
      </Button> : null}
    </>}
  >
    <form id="physical-signature-batch-form" className="physical-signature-batch-form" onSubmit={event => void submit(event)}>
      <p id="physical-signature-batch-description">
        Selecione o projeto e adicione os PDFs assinados. O app tenta associar cada arquivo aos RDOs desse projeto pelo número e pela data no nome.
        Revise os vínculos sugeridos antes de enviar.
        Ao enviar, cada PDF será a versão final do RDO, que ficará bloqueado para edição.
      </p>
      <Field label="Projeto" required disabled={submitting || files.length > 0}
        helperText={files.length ? 'Este lote pertence ao projeto selecionado. Para outro projeto, abra um novo lote.' : 'Escolha o projeto antes de adicionar os PDFs.'}>
        <Select value={projectId} placeholder="Selecione o projeto" onChange={event => setProjectId(event.target.value)}
          options={projects.map(project => ({ value: project.id, label: `${project.code} — ${project.name}` }))} />
      </Field>
      {projectId && candidates.isPending ? <p role="status">Carregando RDOs aprovados do projeto…</p> : null}
      {projectId && candidates.isError ? <Alert tone="danger">Não foi possível carregar os RDOs deste projeto. <Button variant="secondary" size="sm" type="button" onClick={() => void candidates.refetch()}>Tentar novamente</Button></Alert> : null}
      {projectId && candidates.isSuccess && !reports.length ? <Alert tone="info">Este projeto não possui RDOs aprovados disponíveis para receber um PDF assinado.</Alert> : null}
      {projectId ? <PdfDropzone appearance="design-system" id="physical-signature-batch-pdfs" label="PDFs assinados pelo cliente"
        multiple onFile={() => {}} onFiles={addFiles} disabled={submitting || !candidates.isSuccess || !reports.length}
        emptyHint="Selecione vários PDFs deste projeto, de até 20 MB cada" /> : null}
      {files.length ? <p role="status" aria-live="polite">{files.length} arquivo(s) · {savedCount} enviado(s) · {remaining.length} restante(s)</p> : null}
      {files.length ? <ul className="physical-signature-batch-list">{files.map(entry => {
        const complete = entry.status === 'success';
        return <li key={entry.id} className="physical-signature-batch-file">
          <div className="physical-signature-batch-file__heading">
            <strong>{entry.file.name}</strong>
            {!complete ? <RemoveIconButton label={`Remover ${entry.file.name}`} disabled={submitting}
              onClick={() => setFiles(current => current.filter(file => file.id !== entry.id))} /> : null}
          </div>
          <Field label="RDO" required disabled={submitting || complete}
            errorText={!complete ? errors[entry.id] : undefined}>
            <Select aria-label={`RDO de ${entry.file.name}`} value={entry.reportId} placeholder="Selecione o RDO" onChange={event => updateFile(entry.id, { reportId: event.target.value, suggested: false, status: 'pending', error: undefined })}
              options={reports.map(report => ({ value: report.id, label: `RDO ${report.sequenceNumber || '—'} · ${new Date(`${report.reportDate.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')}`,
                disabled: files.some(other => other.id !== entry.id && other.reportId === report.id) }))} />
          </Field>
          <div aria-live="polite">
            {complete ? <span>PDF registrado com sucesso.</span> : entry.status === 'uploading' ? <span>Enviando PDF…</span> : entry.error ? <Alert tone="danger">{entry.error}</Alert>
              : <span>{entry.suggested ? 'Vínculo sugerido pelo nome. Confira antes de enviar.' : entry.reportId ? 'Vínculo selecionado manualmente.' : 'Selecione o RDO para associar este arquivo.'}</span>}
          </div>
        </li>;
      })}</ul> : null}
    </form>
  </Modal>;
}
