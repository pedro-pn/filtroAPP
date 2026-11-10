import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, FolderOpen } from 'lucide-react';

import { listEquipmentDocuments, removeEquipmentDocument, uploadEquipmentDocument, type CompanyEquipment, type EquipmentAttachment, type EquipmentCategory } from '../../api/equipamentos';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { RemoveIconButton } from '../../components/ui/RemoveIconButton';
import { PdfDropzone } from '../../components/ui/PdfDropzone';
import { Alert, Button, EmptyState, Skeleton } from '../../components/ui/ds';
import { useToast } from '../../components/ui/ToastContext';
import { fileToDataUrl } from './equipmentStatus';
import './EquipmentDocuments.css';

export function EquipmentDocuments({ item, category, isManager }: {
  item: CompanyEquipment; category: EquipmentCategory; isManager: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<EquipmentAttachment | null>(null);
  const queryClient = useQueryClient();
  const showToast = useToast();
  const queryKey = ['equipamentos', 'documents', item.id];
  const documentsQuery = useQuery({ queryKey, queryFn: () => listEquipmentDocuments(item.id), enabled: open });
  const documents = documentsQuery.data || item.documents || [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['equipamentos'] });
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        if (!(file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) || file.size > 20 * 1024 * 1024 || file.size === 0) {
          throw new Error('Selecione PDFs de até 20 MB cada.');
        }
      }
      for (const file of files) {
        await uploadEquipmentDocument(item.id, { fileName: file.name, mimeType: 'application/pdf', dataUrl: await fileToDataUrl(file) });
      }
    },
    onSuccess: () => showToast('Documentos anexados.', 'success'),
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível anexar os documentos.', 'error'),
    onSettled: refresh
  });
  const remove = useMutation({
    mutationFn: (documentId: string) => removeEquipmentDocument(item.id, documentId),
    onSuccess: () => { setRemoving(null); showToast('Documento removido.', 'success'); },
    onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível remover o documento.', 'error'),
    onSettled: refresh
  });
  const busy = upload.isPending || remove.isPending;

  if (!category.attachmentsEnabled && !documents.length) return null;

  return <>
    <Button size="sm" variant="secondary" multiline onClick={() => setOpen(true)} aria-label={`Documentos de ${item.code}`}>
      <FolderOpen size={16} aria-hidden="true" /> Documentos ({documents.length})
    </Button>
    <Modal open={open} onClose={() => { if (!busy) setOpen(false); }} title={`Documentos · ${item.code}`}
      appearance="design-system" size="lg" showCloseButton={!busy} panelClassName="equip-documents-modal">
      <p className="equip-documents-equipment">{item.name}</p>
      {isManager && category.attachmentsEnabled ? <div className="equip-documents-upload">
        <PdfDropzone
          appearance="design-system"
          id={`equipment-documents-${item.id}`}
          label={`Anexar documentos a ${item.code}`}
          multiple
          onFile={file => { if (file) upload.mutate([file]); }}
          onFiles={files => { if (files.length) upload.mutate(files); }}
          disabled={busy}
          emptyText={upload.isPending ? 'Enviando documentos…' : 'Arraste os PDFs aqui'}
          emptyHint="ou clique para selecionar. Até 20 MB por arquivo."
          error={upload.isError ? upload.error.message : undefined}
        />
      </div> : null}
      {!category.attachmentsEnabled ? <Alert tone="info">Os documentos existentes estão preservados. Ative “Anexar documentos” na categoria para enviar novos arquivos.</Alert> : null}
      {documentsQuery.isLoading ? <Skeleton lines={3} /> : documentsQuery.isError ? <Alert tone="danger">
        Não foi possível carregar os documentos. <Button size="sm" variant="secondary" onClick={() => void documentsQuery.refetch()}>Tentar novamente</Button>
      </Alert> : documents.length ? <ul className="equip-documents-list">
        {documents.map(document => <li key={document.id}>
          <FileText size={22} aria-hidden="true" />
          <div className="equip-documents-info"><strong>{document.fileName}</strong><span>Adicionado em {new Date(document.createdAt).toLocaleDateString('pt-BR')}</span></div>
          <div className="equip-documents-actions">
            <a className="fv-button fv-button--secondary fv-button--sm" href={document.publicUrl} target="_blank" rel="noreferrer" aria-label={`Abrir ${document.fileName}`}>Abrir PDF</a>
            {isManager ? <RemoveIconButton label={`Remover ${document.fileName}`} disabled={busy} onClick={() => { remove.reset(); setRemoving(document); }} /> : null}
          </div>
        </li>)}
      </ul> : <EmptyState title="Nenhum documento anexado" description={isManager && category.attachmentsEnabled ? 'Anexe os documentos técnicos para reunir os arquivos deste equipamento aqui.' : 'Os documentos deste equipamento aparecerão aqui.'} />}
    </Modal>
    <ConfirmDialog open={Boolean(removing)} title="Remover documento" description="O arquivo será removido da pasta deste equipamento."
      highlight={removing?.fileName} appearance="design-system" confirmDisabled={busy}
      errorMessage={remove.isError ? 'Não foi possível remover. Tente novamente.' : null}
      onCancel={() => { if (!busy) setRemoving(null); }} onConfirm={() => { if (removing) remove.mutate(removing.id); }} />
  </>;
}
