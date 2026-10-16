import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { AppIcon } from '../../../components/icons/AppIcon';
import { Button, Field, Input } from '../../../components/ui/ds';
import { DS_ICONS } from '../../../components/ui/ds/icons';
import { Modal } from '../../../components/ui/Modal';
import { PdfDropzone } from '../../../components/ui/PdfDropzone';
import { RemoveIconButton } from '../../../components/ui/RemoveIconButton';
import { validateSignatureFiles } from '../utils/batch';

const schema = z.object({ title: z.string().trim().max(180) });
type FormValues = z.infer<typeof schema>;

export function NewDocumentModal({ open, submitting, onClose, onSubmit }: {
  open: boolean;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (files: File[], title: string | undefined, onProgress: (message: string) => void) => Promise<void>;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState('');
  const [progress, setProgress] = useState('');
  const [started, setStarted] = useState(false);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { title: '' } });
  const saving = submitting || form.formState.isSubmitting;

  useEffect(() => {
    if (!open) {
      setFiles([]);
      setFileError('');
      setProgress('');
      setStarted(false);
      form.reset({ title: '' });
    }
  }, [form, open]);

  async function submit(values: FormValues) {
    const error = validateSignatureFiles(files);
    if (error) { setFileError(error); return; }
    setFileError('');
    setStarted(true);
    try {
      await onSubmit(files, files.length === 1 ? values.title || undefined : undefined, setProgress);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Não foi possível enviar os PDFs. Tente novamente.');
    }
  }

  return (
    <Modal open={open} onClose={() => { if (!saving) onClose(); }} appearance="design-system" title="Novos documentos" size="md"
      fullscreenOnMobile={false} backdropClassName="assinaturas-dialog-backdrop" panelClassName="assinaturas-upload-dialog"
      closeOnEscape={!saving} showCloseButton={!saving}
      footer={<>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button variant="primary" type="submit" form="signature-new-document-form" size="sm" loading={saving} disabled={saving} iconLeft={<AppIcon icon={DS_ICONS.upload} size="sm" />}>{saving ? 'Enviando...' : 'Enviar e avançar'}</Button>
      </>}
    >
      <form id="signature-new-document-form" className="signature-new-document-form" onSubmit={form.handleSubmit(submit)} aria-busy={saving || undefined}>
        <p className="assinaturas-upload-dialog__hint">Selecione quantos PDFs precisar, com até 200 MB por arquivo. Depois, posicione as assinaturas em cada documento.</p>
        {files.length <= 1 ? <Field id="signature-title" label="Título" helperText="Se ficar vazio, será usado o nome do arquivo." errorText={form.formState.errors.title?.message} disabled={saving || started}>
          <Input size="sm" {...form.register('title')} />
        </Field> : null}
        <PdfDropzone appearance="design-system" id="signature-pdf" label="Arquivos PDF" multiple fileName={files.length ? `${files.length} arquivo(s) selecionado(s)` : ''}
          onFile={() => {}} onFiles={next => {
            const selected = next.length ? [...files, ...next] : [];
            setFiles(selected);
            if (selected.length > 1) form.setValue('title', '', { shouldValidate: true });
            setFileError('');
          }} disabled={saving || started} error={fileError} />
        {files.length ? <ul className="signature-upload-files" aria-label="Arquivos selecionados">{files.map((file, index) => <li key={index}>
          <span>{file.name} <small>({(file.size / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB)</small></span>
          <RemoveIconButton label={`Remover ${file.name}`} disabled={saving || started} onClick={() => setFiles(current => current.filter((_, position) => position !== index))} />
        </li>)}</ul> : null}
        {progress ? <p role="status">{progress}</p> : null}
        {started && !saving && fileError ? <p>Ao tentar novamente, os arquivos já enviados serão preservados. Os rascunhos também estão disponíveis na biblioteca.</p> : null}
      </form>
    </Modal>
  );
}
