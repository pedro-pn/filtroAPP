import { BrandLoading } from '../brand/BrandLoading';
import { GripVertical, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { uploadFiles, type UploadedFile } from '../../api/uploads';
import { loadUploadAssetUrl } from '../../utils/uploadAssetUrl';
import { prepareImageForUpload } from '../../utils/imageUpload';
import { moveUpload } from '../../utils/uploadOrder';
import { AppIcon } from '../icons/AppIcon';
import { ConfirmDialog } from './ConfirmDialog';
import { PhotoCaptureButton } from './PhotoCaptureButton';
import { RemoveIconButton } from './RemoveIconButton';
import { IconButton } from './ds/Button';
import { DS_ICONS } from './ds/icons';
import { stageUploadDeletion } from './photoDeletionStaging';
import './UploadField.css';

interface UploadFieldProps {
  label: string;
  value: UploadedFile[];
  projectId?: string | null;
  disabled?: boolean;
  appearance?: 'legacy' | 'design-system';
  onChange: (files: UploadedFile[]) => void;
}

export type UploadPreviewFile = UploadedFile & {
  path?: string;
  storagePath?: string;
  dataUrl?: string;
  source?: string;
  src?: string;
  href?: string;
  publicUrl?: string;
  previouslyAdded?: boolean;
  __previouslyAdded?: boolean;
};

interface UploadPreviewListItemProps {
  disabled: boolean;
  file: UploadPreviewFile;
  index: number;
  appearance?: 'legacy' | 'design-system';
  onRemove: (index: number) => void;
  removed?: boolean;
  reorderHandle?: ReactNode;
  dragging?: boolean;
  dropTarget?: boolean;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Falha ao ler arquivo.'));
    reader.readAsDataURL(file);
  });
}

function rawFileUrl(file: UploadPreviewFile) {
  return file.url
    || file.path
    || file.storagePath
    || file.dataUrl
    || file.source
    || file.src
    || file.href
    || file.publicUrl
    || file.fileName
    || '';
}

function isImageFile(file: UploadPreviewFile) {
  if ((file.mimeType || '').startsWith('image')) return true;
  const ext = (file.fileName || rawFileUrl(file)).split('.').pop()?.toLowerCase() || '';
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext);
}

function wasPreviouslyAdded(file: UploadPreviewFile) {
  return Boolean(file.previouslyAdded || file.__previouslyAdded);
}

function uploadFileKey(file: UploadPreviewFile) {
  return rawFileUrl(file) || `${file.fileName}-${file.mimeType || ''}`;
}

export function UploadPreviewListItem({ disabled, file, index, appearance = 'legacy', onRemove, removed = false, reorderHandle, dragging = false, dropTarget = false }: UploadPreviewListItemProps) {
  const [href, setHref] = useState('');
  const source = rawFileUrl(file);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';

    loadUploadAssetUrl(source)
      .then(nextHref => {
        if (cancelled) {
          if (nextHref.startsWith('blob:')) URL.revokeObjectURL(nextHref);
          return;
        }
        objectUrl = nextHref.startsWith('blob:') ? nextHref : '';
        setHref(nextHref);
      })
      .catch(() => {
        if (!cancelled) setHref('');
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source]);

  return (
    <div className={`upload-list-item ${removed ? 'removed' : ''} ${reorderHandle ? 'upload-list-item--reorderable' : ''}`} data-upload-index={index} data-dragging={dragging || undefined} data-drop-target={dropTarget || undefined}>
      {reorderHandle}
      {href && isImageFile(file) ? (
        <a
          className="upload-list-preview"
          href={href}
          target="_blank"
          rel="noreferrer"
          aria-label={`Abrir ${file.fileName}`}
        >
          <img className="upload-list-thumb" src={href} alt="" />
        </a>
      ) : null}
      {href ? (
        <a
          className="upload-list-name"
          href={href}
          target="_blank"
          rel="noreferrer"
          title={file.fileName}
        >
          {file.fileName}
        </a>
      ) : (
        <span className="upload-list-name">{file.fileName}</span>
      )}
      {wasPreviouslyAdded(file) ? <span className="upload-previous-badge">Adicionada anteriormente</span> : null}
      {!disabled ? removed ? (
        appearance === 'design-system' ? (
          <IconButton
            className="upload-remove-button"
            icon={RotateCcw}
            label={`Restaurar ${file.fileName}`}
            variant="secondary"
            size="sm"
            onClick={() => onRemove(index)}
          />
        ) : (
          <button
            className="upload-remove-button"
            type="button"
            onClick={() => onRemove(index)}
            aria-label={`Restaurar ${file.fileName}`}
            title="Restaurar"
          >
            ↶
          </button>
        )
      ) : (
        <RemoveIconButton label={`Remover ${file.fileName}`} onClick={() => onRemove(index)} />
      ) : null}
    </div>
  );
}

export function UploadField({ label, value, projectId, disabled = false, appearance = 'legacy', onChange }: UploadFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const pointerDrag = useRef<{ from: number; to: number; x: number; y: number; active: boolean; preview: string; width: number } | null>(null);
  const [reordering, setReordering] = useState<{ from: number; to: number; x: number; y: number; preview: string; width: number } | null>(null);
  const [orderAnnouncement, setOrderAnnouncement] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ index: number; ref: string; fileName: string } | null>(null);
  const displayLabel = label.trim();
  const uploadLabel = displayLabel || 'Fotos de registro';

  function reorder(from: number, to: number) {
    if (disabled || isUploading || removeTarget || from === to || to < 0 || to >= value.length) return;
    onChange(moveUpload(value, from, to));
    setOrderAnnouncement(`${value[from].fileName}: posição ${to + 1} de ${value.length}.`);
  }

  async function handleFiles(files: ArrayLike<File> | null) {
    const selected = Array.from(files || []);
    if (!selected.length) return;

    setIsUploading(true);
    setError('');

    try {
      const items = await Promise.all(
        selected.map(async original => {
          const file = await prepareImageForUpload(original);
          return {
            label: uploadLabel,
            fileName: file.name,
            mimeType: file.type || (/\.(hei[cf])$/i.test(file.name) ? 'image/heic' : 'image/jpeg'),
            dataUrl: await fileToDataUrl(file),
            projectId
          };
        })
      );
      const uploaded = await uploadFiles(items);
      onChange([...value, ...uploaded]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível enviar as fotos.');
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function serverReference(file: UploadPreviewFile) {
    const raw = file.url || file.storagePath || file.path || file.publicUrl || file.source || file.src || file.href || '';
    return raw && !raw.startsWith('data:') ? raw : '';
  }

  function removeFile(index: number) {
    const file = value[index] as UploadPreviewFile | undefined;
    if (!file) return;
    const ref = serverReference(file);
    // A exclusão é global, mas só é efetivada ao SALVAR o relatório. Aqui apenas
    // encenamos a remoção (some da lista); se o usuário não salvar, nada é apagado.
    if (ref) {
      setRemoveTarget({ index, ref, fileName: file.fileName });
      return;
    }
    onChange(value.filter((_, itemIndex) => itemIndex !== index));
  }

  function confirmRemoveFile() {
    if (!removeTarget) return;
    stageUploadDeletion(removeTarget.ref);
    onChange(value.filter((_, itemIndex) => itemIndex !== removeTarget.index));
    setRemoveTarget(null);
  }

  const hasPreviouslyAddedFiles = value.some(file => wasPreviouslyAdded(file as UploadPreviewFile));

  function openPicker() {
    if (!disabled && !isUploading) inputRef.current?.click();
  }

  return (
    <div className={`upload-field ${appearance === 'design-system' ? 'upload-field--ds' : ''}`}>
      {displayLabel ? <label className="upload-field-label">{displayLabel}</label> : null}
      <div
        className={`upload-dropzone ${dragOver ? 'drag-over' : ''} ${isUploading ? 'busy' : ''} ${value.length ? 'has-file' : ''}`}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onClick={openPicker}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPicker(); } }}
        onDragOver={event => { if (!disabled && !isUploading) { event.preventDefault(); setDragOver(true); } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={event => { event.preventDefault(); setDragOver(false); if (!disabled && !isUploading) void handleFiles(event.dataTransfer.files); }}
      >
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          aria-label={`Selecionar imagens: ${label}`}
          accept="image/*,.heic,.heif"
          multiple
          disabled={disabled || isUploading}
          onChange={event => void handleFiles(event.target.files)}
        />
        <span className="upload-dropzone-icon" aria-hidden="true">
          {isUploading ? <BrandLoading inline size="sm" label="Enviando fotos" /> : appearance === 'design-system' ? <AppIcon icon={DS_ICONS.upload} /> : '⤓'}
        </span>
        <span className="upload-dropzone-text">
          <strong>{isUploading ? 'Enviando…' : 'Arraste as fotos aqui'}</strong>
          <small>{value.length ? `${value.length} arquivo(s) · clique ou solte para adicionar` : 'ou clique para selecionar'}</small>
        </span>
      </div>
      {!disabled ? <div className="upload-field-actions">
        <PhotoCaptureButton appearance={appearance} disabled={isUploading} onFiles={files => void handleFiles(files)} />
      </div> : null}
      {error ? <div className="inline-error">{error}</div> : null}
      {hasPreviouslyAddedFiles ? (
        <div className="upload-previous-note">Estas fotos foram adicionadas anteriormente neste serviço. Se removidas, sairão do relatório.</div>
      ) : null}
      {value.length ? (
        <div className="upload-list" ref={listRef}>
          {!disabled && value.length > 1 ? <p className="upload-order-help">Arraste pelo ícone para ordenar as fotos no relatório. Use as setas do teclado com o ícone selecionado.</p> : null}
          <span className="visually-hidden" role="status" aria-live="polite">{orderAnnouncement}</span>
          {value.map((file, index) => (
            <UploadPreviewListItem
              key={uploadFileKey(file)}
              disabled={disabled || isUploading || Boolean(reordering)}
              file={file}
              index={index}
              appearance={appearance}
              onRemove={removeFile}
              dragging={reordering?.from === index}
              dropTarget={reordering?.to === index && reordering.from !== index}
              reorderHandle={!disabled && value.length > 1 ? <button
                type="button"
                className="upload-reorder-handle"
                aria-label={`Reordenar ${file.fileName}, posição ${index + 1} de ${value.length}`}
                title="Arraste para reordenar ou use as setas do teclado"
                disabled={isUploading || Boolean(removeTarget)}
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    pointerDrag.current = null;
                    setReordering(null);
                    return;
                  }
                  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    reorder(index, index + (event.key === 'ArrowUp' ? -1 : 1));
                  }
                }}
                onPointerDown={event => {
                  if (event.button !== 0) return;
                  const row = event.currentTarget.closest<HTMLElement>('[data-upload-index]');
                  pointerDrag.current = {
                    from: index, to: index, x: event.clientX, y: event.clientY, active: false,
                    preview: row?.querySelector('img')?.currentSrc || '',
                    width: Math.min(row?.getBoundingClientRect().width || 280, 320, window.innerWidth - 16)
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={event => {
                  const drag = pointerDrag.current;
                  if (!drag) return;
                  if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
                  drag.active = true;
                  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-upload-index]');
                  if (target && listRef.current?.contains(target)) drag.to = Number(target.dataset.uploadIndex);
                  setReordering({ from: drag.from, to: drag.to, x: event.clientX, y: event.clientY, preview: drag.preview, width: drag.width });
                }}
                onPointerUp={() => {
                  const drag = pointerDrag.current;
                  pointerDrag.current = null;
                  setReordering(null);
                  if (drag?.active) reorder(drag.from, drag.to);
                }}
                onPointerCancel={() => { pointerDrag.current = null; setReordering(null); }}
                onLostPointerCapture={() => { pointerDrag.current = null; setReordering(null); }}
              ><GripVertical aria-hidden="true" /><span aria-hidden="true">{index + 1}</span></button> : undefined}
            />
          ))}
        </div>
      ) : null}
      {reordering && typeof document !== 'undefined' ? createPortal(
        <div
          className={`upload-drag-ghost ${appearance === 'design-system' ? 'fv-ds' : ''}`}
          aria-hidden="true"
          style={{
            width: reordering.width,
            left: Math.max(8, Math.min(reordering.x + 12, window.innerWidth - reordering.width - 8)),
            top: Math.max(8, Math.min(reordering.y + 12, window.innerHeight - 80))
          }}
        >
          {reordering.preview ? <img src={reordering.preview} alt="" draggable={false} /> : <GripVertical />}
          <span>{value[reordering.from]?.fileName}</span>
        </div>, document.body
      ) : null}
      <ConfirmDialog
        open={Boolean(removeTarget)}
        appearance={appearance}
        title="Remover imagem?"
        description="Ao salvar, ela será removida de todos os relatórios em que aparece e apagada do servidor."
        highlight={removeTarget?.fileName}
        confirmLabel="Remover imagem"
        onCancel={() => setRemoveTarget(null)}
        onConfirm={confirmRemoveFile}
      />
    </div>
  );
}
