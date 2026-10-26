import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GripVertical, Paperclip } from 'lucide-react';

import { canReviewRdoReports } from '../../../../shared/modules/rdo-permissions.js';
import {
  attachReportPdf, deleteReportPdfAttachment, reportPdfAttachmentUrl, reorderReportPdfAttachments,
  listReportPdfAttachments, type ReportPdfAttachment
} from '../../api/reportPdfAttachments';
import { useAuth } from '../../auth/AuthContext';
import type { ReportSummary } from '../../types/domain';
import { moveUpload } from '../../utils/uploadOrder';
import { fileToDataUrl } from '../../utils/fileToDataUrl';
import { Modal } from '../ui/Modal';
import { PdfDropzone } from '../ui/PdfDropzone';
import { UploadPreviewListItem } from '../ui/UploadField';
import { useToast } from '../ui/ToastContext';
import { Badge, Button, IconButton } from '../ui/ds';
import './ReportPdfAttachmentsButton.css';

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 20;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

interface AttachmentDrag {
  attachmentId: string;
  fileName: string;
  from: number;
  to: number;
  x: number;
  y: number;
  active: boolean;
  width: number;
}

export function ReportPdfAttachmentsButton({ report }: { report: ReportSummary }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const savedCount = report._count?.pdfAttachments ?? 0;
  const [count, setCount] = useState(savedCount);
  const countId = useId();
  useEffect(() => { setCount(savedCount); }, [savedCount, report.id]);
  if (!canReviewRdoReports(user) || (report.project.managerOnly && user?.role !== 'MANAGER')) return null;
  const countLabel = `${count} ${count === 1 ? 'anexo PDF' : 'anexos PDF'}`;

  return <span className="fv-ds report-pdf-attachment-action" onClick={event => event.stopPropagation()}>
    <IconButton variant="secondary" size="sm" icon={Paperclip} label="Anexar arquivo" aria-describedby={count > 0 ? countId : undefined}
      title={count > 0 ? `Anexar arquivo · ${countLabel}` : 'Anexar arquivo'} onClick={() => setOpen(true)} />
    {count > 0 ? <Badge id={countId} className="report-pdf-attachment-count" aria-label={countLabel} aria-live="polite">{count}</Badge> : null}
    {open ? <ReportPdfAttachmentsDialog report={report} onClose={() => setOpen(false)} onCountChange={setCount} /> : null}
  </span>;
}

function ReportPdfAttachmentsDialog({ report, onClose, onCountChange }: { report: ReportSummary; onClose: () => void; onCountChange: (count: number) => void }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ fileName: string; current: number; total: number } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [orderAnnouncement, setOrderAnnouncement] = useState('');
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const pointerDrag = useRef<AttachmentDrag | null>(null);
  const [dragging, setDragging] = useState<AttachmentDrag | null>(null);
  const operationPending = useRef(false);
  const showToast = useToast();
  const queryClient = useQueryClient();
  const queryKey = ['report-pdf-attachments', report.id];
  const attachments = useQuery({
    queryKey,
    queryFn: ({ signal }) => listReportPdfAttachments(report.id, signal),
    staleTime: 0
  });
  const disabled = busy || deletingId !== null || reordering;
  const items = attachments.data || [];
  useEffect(() => {
    if (attachments.isSuccess) onCountChange(attachments.data.length);
  }, [attachments.data, attachments.isSuccess, onCountChange]);
  const close = () => { if (!operationPending.current && !pointerDrag.current?.active) onClose(); };

  const cancelDrag = useCallback(() => {
    pointerDrag.current = null;
    setDragging(null);
  }, []);

  const updateDragTarget = useCallback((x: number, y: number) => {
    const drag = pointerDrag.current;
    if (!drag) return;
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-upload-index]');
    drag.to = row && listRef.current?.contains(row) ? Number(row.dataset.uploadIndex) : -1;
    drag.x = x;
    drag.y = y;
    setDragging({ ...drag });
  }, []);

  const dragActive = Boolean(dragging?.active);
  useEffect(() => {
    if (!dragActive) return;
    let frame: number;
    // A lista pode ser maior que o diálogo; rola o corpo sob o mouse/dedo.
    const tick = () => {
      const drag = pointerDrag.current;
      if (drag?.active) {
        let scroller = listRef.current?.parentElement || null;
        while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
        if (scroller) {
          const bounds = scroller.getBoundingClientRect();
          const distance = drag.y < bounds.top + 48 ? drag.y - bounds.top - 48 : drag.y > bounds.bottom - 48 ? drag.y - bounds.bottom + 48 : 0;
          if (distance) {
            scroller.scrollBy(0, Math.sign(distance) * Math.min(16, Math.abs(distance) / 3));
            updateDragTarget(drag.x, drag.y);
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragActive, updateDragTarget]);

  async function upload(files: File[]) {
    if (!files.length || operationPending.current || pointerDrag.current || !attachments.isSuccess) return;
    const currentItems = queryClient.getQueryData<ReportPdfAttachment[]>(queryKey) || items;
    setError('');
    if (files.some(file => !/\.pdf$/i.test(file.name))) {
      setError('Selecione apenas arquivos PDF.');
      return;
    }
    if (files.some(file => !file.size || file.size > MAX_FILE_BYTES)) {
      setError('Cada PDF deve ter conteúdo e no máximo 50 MB.');
      return;
    }
    if (currentItems.length + files.length > MAX_FILES) {
      setError('Cada relatório pode ter até 20 PDFs anexados.');
      return;
    }
    if ([...currentItems, ...files.map(file => ({ sizeBytes: file.size }))].reduce((sum, item) => sum + item.sizeBytes, 0) > MAX_TOTAL_BYTES) {
      setError('Os anexos do relatório devem somar até 200 MB.');
      return;
    }
    operationPending.current = true;
    setBusy(true);
    let currentFileName = '';
    // Publica cada confirmação na lista assim que o arquivo termina de enviar.
    try {
      for (const [index, file] of files.entries()) {
        currentFileName = file.name;
        setUploadProgress({ fileName: file.name, current: index + 1, total: files.length });
        const attachment = await attachReportPdf(report.id, file.name, await fileToDataUrl(file));
        queryClient.setQueryData<ReportPdfAttachment[]>(queryKey, current => [
          ...(current || []).filter(item => item.id !== attachment.id), attachment
        ]);
      }
      showToast('PDFs anexados ao relatório.', 'success');
    } catch (cause) {
      setError(`Não foi possível anexar ${currentFileName}. ${cause instanceof Error ? cause.message : 'Tente novamente.'} Selecione novamente os arquivos que não aparecem na lista.`);
    } finally {
      operationPending.current = false;
      setBusy(false);
      setUploadProgress(null);
      void queryClient.invalidateQueries({ queryKey });
    }
  }

  async function remove(attachment: ReportPdfAttachment) {
    if (operationPending.current || pointerDrag.current?.active) return;
    operationPending.current = true;
    setDeletingId(attachment.id);
    setError('');
    try {
      await deleteReportPdfAttachment(report.id, attachment.id);
      queryClient.setQueryData<ReportPdfAttachment[]>(queryKey, current => (current || []).filter(item => item.id !== attachment.id));
      showToast('Anexo excluído.', 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível excluir o anexo.');
    } finally {
      operationPending.current = false;
      setDeletingId(null);
      void queryClient.invalidateQueries({ queryKey });
    }
  }

  async function reorder(from: number, to: number) {
    if (operationPending.current || pointerDrag.current?.active || from === to || from < 0 || to < 0 || to >= items.length) return;
    const next = moveUpload(items, from, to);
    operationPending.current = true;
    setReordering(true);
    setError('');
    try {
      const saved = await reorderReportPdfAttachments(report.id, next.map(item => item.id));
      queryClient.setQueryData(queryKey, saved);
      setOrderAnnouncement(`${items[from].fileName}: posição ${to + 1} de ${items.length}. Ordem salva.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a ordem dos anexos.');
    } finally {
      operationPending.current = false;
      setReordering(false);
      void queryClient.invalidateQueries({ queryKey });
    }
  }

  return <Modal
    open appearance="design-system" size="md" title="Anexos PDF do relatório"
    panelClassName="report-pdf-attachments-dialog" backdropClassName="report-pdf-attachments-backdrop" ariaDescribedBy={`${id}-description`}
    onClose={close} closeOnEscape={!disabled} fullscreenOnMobile={false}
    footer={<Button variant="secondary" disabled={disabled} onClick={close}>Fechar</Button>}
  >
    <div className="report-pdf-attachments">
      <p id={`${id}-description`}>
        <strong>{report.reportType} {report.sequenceNumber ?? '—'} · {report.project.name}</strong>
        <br />Os PDFs serão incluídos ao final do relatório, na ordem da lista.
      </p>
      <div className="report-pdf-attachments__upload">
        <PdfDropzone
          appearance="design-system"
          id={`${id}-files`}
          label="Selecionar arquivos PDF"
          multiple
          fileName={uploadProgress?.fileName}
          onFile={file => { if (file) void upload([file]); }}
          onFiles={selected => void upload(selected)}
          disabled={disabled || Boolean(dragging) || !attachments.isSuccess}
          emptyHint="ou clique para selecionar os arquivos"
          selectedHint={uploadProgress ? `Enviando ${uploadProgress.current} de ${uploadProgress.total}…` : undefined}
        />
        <p id={`${id}-limits`}>Até 50 MB por arquivo, 20 anexos e 200 MB por relatório.</p>
        {uploadProgress ? <p role="status">Enviando {uploadProgress.current} de {uploadProgress.total}: {uploadProgress.fileName}</p> : null}
      </div>
      {error ? <p role="alert" className="report-pdf-attachments__error">{error}</p> : null}
      <section aria-labelledby={`${id}-list-title`}>
        <h3 id={`${id}-list-title`}>Arquivos anexados{attachments.isSuccess ? ` (${items.length})` : ''}</h3>
        {attachments.isPending ? <p role="status">Carregando anexos…</p> : null}
        {attachments.isError ? <div role="alert">
          <p>{attachments.error instanceof Error ? attachments.error.message : 'Não foi possível carregar os anexos.'}</p>
          <Button size="sm" onClick={() => void attachments.refetch()}>Tentar novamente</Button>
        </div> : null}
        {attachments.isSuccess && !items.length ? <p>Nenhum PDF anexado.</p> : null}
        <span className="visually-hidden" role="status" aria-live="polite">{orderAnnouncement}</span>
        {items.length > 1 ? <p className="upload-order-help">Arraste pelo ícone para ordenar os anexos. A ordem é salva automaticamente.</p> : null}
        {items.length ? <div ref={listRef} className="upload-list report-pdf-attachments__list" role="list" aria-label="PDFs anexados">
          {items.map((attachment, index) => <div key={attachment.id} role="listitem">
            <UploadPreviewListItem
              appearance="design-system"
              file={{ fileName: attachment.fileName, mimeType: 'application/pdf', url: reportPdfAttachmentUrl(report.id, attachment.id), label: 'Anexo PDF' }}
              index={index}
              disabled={disabled}
              dragging={dragging?.attachmentId === attachment.id}
              dropTarget={dragging?.to === index && dragging.attachmentId !== attachment.id}
              onRemove={() => void remove(attachment)}
              reorderHandle={items.length > 1 ? <button type="button" className="upload-reorder-handle"
                aria-label={`Reordenar ${attachment.fileName}, posição ${index + 1} de ${items.length}`}
                title="Arraste para reordenar ou use as setas do teclado"
                disabled={disabled}
                onKeyDown={event => {
                  if (event.key === 'Escape' && pointerDrag.current) {
                    event.preventDefault();
                    event.stopPropagation();
                    cancelDrag();
                  } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    void reorder(index, index + (event.key === 'ArrowUp' ? -1 : 1));
                  }
                }}
                onPointerDown={event => {
                  if (event.button !== 0 || operationPending.current) return;
                  const row = event.currentTarget.closest<HTMLElement>('[data-upload-index]');
                  pointerDrag.current = { attachmentId: attachment.id, fileName: attachment.fileName, from: index, to: index, x: event.clientX, y: event.clientY, active: false,
                    width: Math.min(row?.getBoundingClientRect().width || 280, 320, window.innerWidth - 16) };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={event => {
                  const drag = pointerDrag.current;
                  if (!drag || (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5)) return;
                  drag.active = true;
                  updateDragTarget(event.clientX, event.clientY);
                }}
                onPointerUp={event => {
                  if (pointerDrag.current?.active) updateDragTarget(event.clientX, event.clientY);
                  const drag = pointerDrag.current;
                  cancelDrag();
                  if (drag?.active) void reorder(items.findIndex(item => item.id === drag.attachmentId), drag.to);
                }}
                onPointerCancel={cancelDrag}
                onLostPointerCapture={cancelDrag}
              ><GripVertical aria-hidden="true" /><span aria-hidden="true">{index + 1}</span></button> : undefined}
            />
          </div>)}
        </div> : null}
      </section>
      {dragging && typeof document !== 'undefined' ? createPortal(
        <div className="upload-drag-ghost fv-ds" aria-hidden="true" style={{ width: dragging.width,
          left: Math.max(8, Math.min(dragging.x + 12, window.innerWidth - dragging.width - 8)),
          top: Math.max(8, Math.min(dragging.y + 12, window.innerHeight - 80)) }}>
          <GripVertical /><span>{dragging.fileName}</span>
        </div>, document.body
      ) : null}
    </div>
  </Modal>;
}
