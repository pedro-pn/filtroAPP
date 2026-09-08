import { useEffect, useState } from 'react';

import {
  createStockItemDocument,
  removeStockItemDocument,
  type PdfUpload,
  type StockItem
} from '../../api/estoque';
import { Modal } from '../../components/ui/Modal';
import { PdfDropzone } from '../../components/ui/PdfDropzone';
import { useToast } from '../../components/ui/ToastContext';

interface Props {
  open: boolean;
  item: StockItem;
  onClose: () => void;
  onChanged: () => void;
}

const MAX_PDF_BYTES = 20 * 1024 * 1024;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Não foi possível ler o PDF.'));
    reader.readAsDataURL(file);
  });
}

async function toUpload(file: File): Promise<PdfUpload> {
  return { fileName: file.name, dataUrl: await fileToDataUrl(file) };
}

function documentLabel(item: StockItem) {
  return item.type === 'PRODUTO_QUIMICO'
    ? 'Documentos relacionados, como FDSs e fichas técnicas'
    : 'Documentação técnica do filtro';
}

export function StockItemDocumentsModal({ open, item, onClose, onChanged }: Props) {
  const showToast = useToast();
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPendingFiles([]);
    setError(null);
  }, [item.id]);

  function selectFiles(files: File[]) {
    setError(null);
    if (!files.length) {
      setPendingFiles([]);
      return;
    }
    const invalid = files.find(file => file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf'));
    if (invalid) {
      setError(`${invalid.name} não é um arquivo PDF.`);
      return;
    }
    const oversized = files.find(file => file.size > MAX_PDF_BYTES);
    if (oversized) {
      setError(`${oversized.name} é maior que 20 MB.`);
      return;
    }
    setPendingFiles(current => [...current, ...files]);
  }

  async function uploadDocuments() {
    if (!pendingFiles.length) return;
    setUploading(true);
    setError(null);
    let completed = 0;
    try {
      for (const file of pendingFiles) {
        // Um PDF por requisição evita ultrapassar o limite ao selecionar vários documentos.
        await createStockItemDocument(item.id, await toUpload(file));
        completed += 1;
      }
      setPendingFiles([]);
      onChanged();
      showToast(`${completed} documento(s) anexado(s).`, 'success');
    } catch (uploadError) {
      setPendingFiles(current => current.slice(completed));
      if (completed) onChanged();
      setError(uploadError instanceof Error ? uploadError.message : 'Não foi possível enviar os documentos.');
    } finally {
      setUploading(false);
    }
  }

  async function removeDocument(documentId: string, fileName: string) {
    if (!window.confirm(`Remover o documento “${fileName}”?`)) return;
    setRemovingId(documentId);
    setError(null);
    try {
      await removeStockItemDocument(item.id, documentId);
      onChanged();
      showToast('Documento removido.', 'success');
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Não foi possível remover o documento.');
    } finally {
      setRemovingId(null);
    }
  }

  const busy = uploading || Boolean(removingId);

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeOnEscape={!busy}
      ariaLabelledBy="stock-documents-title"
      panelClassName="modal-card equip-modal stock-modal"
    >
      <button
        className="equip-modal-close-float icon-button"
        type="button"
        aria-label="Fechar documentos do item"
        title="Fechar"
        onClick={onClose}
        disabled={busy}
      >
        ×
      </button>

      <div className="equip-form">
        <header className="equip-form-head has-float-close">
          <h3 id="stock-documents-title">Documentos do item</h3>
          <span className="equip-form-sub">{item.code} — {item.name}</span>
        </header>

        <p className="rel-meta stock-documents-description">{documentLabel(item)}. Somente arquivos PDF, com até 20 MB cada.</p>

        {item.documents.length ? (
          <div className="upload-list" aria-label="Documentos anexados">
            {item.documents.map(document => (
              <div className="upload-list-item" key={document.id}>
                <a className="upload-list-name" href={document.publicUrl} target="_blank" rel="noreferrer">
                  {document.fileName}
                </a>
                <button
                  className="upload-remove-button"
                  type="button"
                  aria-label={`Remover ${document.fileName}`}
                  title="Remover"
                  disabled={busy}
                  onClick={() => void removeDocument(document.id, document.fileName)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="placeholder-copy">Nenhum documento anexado.</p>
        )}

        <PdfDropzone
          id="stock-item-documents"
          label="Adicionar documentos"
          fileName={pendingFiles.length ? `${pendingFiles.length} PDF(s) selecionado(s)` : ''}
          onFile={() => {}}
          multiple
          onFiles={selectFiles}
          disabled={busy}
          emptyText="Arraste os PDFs aqui"
          selectedHint="Clique ou solte para adicionar mais"
        />

        {pendingFiles.length ? (
          <div className="upload-list" aria-label="Documentos selecionados para envio">
            {pendingFiles.map((file, index) => (
              <div className="upload-list-item" key={`${file.name}-${file.size}-${file.lastModified}-${index}`}>
                <span className="upload-list-name">{file.name}</span>
                <button
                  className="upload-remove-button"
                  type="button"
                  aria-label={`Retirar ${file.name} da seleção`}
                  title="Retirar da seleção"
                  disabled={busy}
                  onClick={() => setPendingFiles(current => current.filter((_, currentIndex) => currentIndex !== index))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {error ? <p className="equip-form-error">{error}</p> : null}

        <div className="admin-form-actions equip-form-actions">
          <button className="mini-btn alt" type="button" onClick={onClose} disabled={busy}>Fechar</button>
          <button className="mini-btn" type="button" onClick={() => void uploadDocuments()} disabled={busy || !pendingFiles.length}>
            {uploading ? 'Enviando…' : 'Anexar selecionados'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
