import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { AppIcon } from '../../../components/icons/AppIcon';
import { Button, Field, Input } from '../../../components/ui/ds';
import { DS_ICONS } from '../../../components/ui/ds/icons';
import { Modal } from '../../../components/ui/Modal';
import { PdfDropzone } from '../../../components/ui/PdfDropzone';

const schema = z.object({ title: z.string().trim().max(180) });
type FormValues = z.infer<typeof schema>;

function readDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Não foi possível ler o PDF.'));
    reader.readAsDataURL(file);
  });
}

export function NewDocumentModal({
  open,
  submitting,
  onClose,
  onSubmit
}: {
  open: boolean;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: { fileName: string; pdfDataUrl: string; title?: string }) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { title: '' } });
  const saving = submitting || form.formState.isSubmitting;

  useEffect(() => {
    if (!open) {
      setFile(null);
      setFileError('');
      form.reset({ title: '' });
    }
  }, [form, open]);

  async function submit(values: FormValues) {
    if (!file) {
      setFileError('Selecione um arquivo PDF.');
      return;
    }
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setFileError('Envie um arquivo PDF válido.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setFileError('O PDF deve ter no máximo 20 MB.');
      return;
    }
    setFileError('');
    let pdfDataUrl: string;
    try {
      pdfDataUrl = await readDataUrl(file);
    } catch {
      setFileError('Não foi possível ler o PDF. Selecione o arquivo novamente.');
      return;
    }
    await onSubmit({
      fileName: file.name,
      pdfDataUrl,
      ...(values.title ? { title: values.title } : {})
    });
  }

  return (
    <Modal open={open} onClose={onClose} appearance="design-system" title="Novo documento" size="md"
      fullscreenOnMobile={false} backdropClassName="assinaturas-dialog-backdrop" panelClassName="assinaturas-upload-dialog"
      closeOnEscape={!saving} showCloseButton={!saving}
      footer={<>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button variant="primary" type="submit" form="signature-new-document-form" size="sm" loading={saving} disabled={saving} iconLeft={<AppIcon icon={DS_ICONS.upload} size="sm" />}>{saving ? 'Enviando...' : 'Enviar PDF'}</Button>
      </>}
    >
      <form id="signature-new-document-form" className="signature-new-document-form" onSubmit={form.handleSubmit(submit)} aria-busy={saving || undefined}>
        <p className="assinaturas-upload-dialog__hint">Envie um PDF de até 20 MB. Depois, adicione os assinantes e posicione os campos no documento.</p>
        <Field id="signature-title" label="Título" helperText="Se ficar vazio, será usado o nome do arquivo." errorText={form.formState.errors.title?.message} disabled={saving}>
          <Input size="sm" {...form.register('title')} />
        </Field>
        <PdfDropzone appearance="design-system" id="signature-pdf" label="Arquivo PDF" file={file} onFile={next => { setFile(next); setFileError(''); }} disabled={saving} error={fileError} />
      </form>
    </Modal>
  );
}
