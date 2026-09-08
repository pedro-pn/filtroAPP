import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '../../../components/ui/Button';
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
    await onSubmit({
      fileName: file.name,
      pdfDataUrl: await readDataUrl(file),
      ...(values.title ? { title: values.title } : {})
    });
  }

  return (
    <Modal open={open} onClose={onClose} ariaLabelledBy="signature-new-title">
      <form className="signature-new-document-form" onSubmit={form.handleSubmit(submit)}>
        <h2 id="signature-new-title">Novo documento</h2>
        <div className={`field-group ${form.formState.errors.title ? 'field-invalid' : ''}`}>
          <label htmlFor="signature-title">Título opcional</label>
          <input id="signature-title" aria-invalid={Boolean(form.formState.errors.title)} {...form.register('title')} />
          {form.formState.errors.title ? <div className="field-error">{form.formState.errors.title.message}</div> : null}
        </div>
        <PdfDropzone id="signature-pdf" label="Arquivo PDF" file={file} onFile={next => { setFile(next); setFileError(''); }} disabled={submitting} error={fileError} />
        {submitting ? <div className="signature-upload-progress" role="progressbar" aria-label="Enviando PDF"><span /></div> : null}
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>Cancelar</Button>
          <Button type="submit" disabled={submitting}>{submitting ? 'Enviando...' : 'Enviar PDF'}</Button>
        </div>
      </form>
    </Modal>
  );
}
