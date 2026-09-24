import { useState, type FormEvent } from 'react';

import { Modal } from '../../components/ui/Modal';
import { PdfDropzone } from '../../components/ui/PdfDropzone';
import { useToast } from '../../components/ui/ToastContext';
import type { ReportSummary } from '../../types/domain';
import { fileToDataUrl } from '../../utils/fileToDataUrl';

interface Props {
  report: ReportSummary;
  onClose: () => void;
  upload: (payload: { id: string; fileName: string; pdfDataUrl: string }) => Promise<unknown>;
  uploadPending: boolean;
}

export function PhysicalSignatureDialog({ report, onClose, upload, uploadPending }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const showToast = useToast();
  const close = () => { if (!uploadPending) onClose(); };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      showToast('O PDF assinado deve ter até 20 MB.', 'error');
      return;
    }
    try {
      await upload({ id: report.id, fileName: file.name, pdfDataUrl: await fileToDataUrl(file) });
      onClose();
      showToast('RDO assinado em papel registrado. Relatórios de serviço vinculados foram atualizados.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível registrar o PDF assinado.', 'error');
    }
  }

  return <Modal open onClose={close} ariaLabelledBy="physical-signature-title" ariaDescribedBy="physical-signature-description">
    <form className="admin-form" onSubmit={event => void submit(event)}>
      <h2 className="section-title" id="physical-signature-title">Registrar RDO assinado em papel</h2>
      <p className="placeholder-copy" id="physical-signature-description">
        Envie a digitalização assinada de {report.reportType} {report.sequenceNumber || '—'}.
        O PDF enviado será a versão final, o RDO ficará bloqueado e os relatórios de serviço vinculados seguirão a liberação por assinatura.
      </p>
      <PdfDropzone id="physical-signature-pdf" label="PDF assinado pelo cliente" file={file} onFile={setFile} disabled={uploadPending} emptyHint="PDF de até 20 MB" />
      <div className="admin-form-actions physical-signature-actions">
        <button className="secondary-button" type="button" disabled={uploadPending} onClick={close}>Cancelar</button>
        <button className="primary-button" type="submit" disabled={!file || uploadPending}>
          {uploadPending ? 'Enviando...' : 'Registrar assinatura física'}
        </button>
      </div>
    </form>
  </Modal>;
}
