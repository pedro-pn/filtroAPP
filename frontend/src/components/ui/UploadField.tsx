import { useEffect, useRef, useState } from 'react';

import { uploadFiles, type UploadedFile } from '../../api/uploads';
import { loadUploadAssetUrl } from '../../utils/uploadAssetUrl';

interface UploadFieldProps {
  label: string;
  value: UploadedFile[];
  projectId?: string | null;
  disabled?: boolean;
  onChange: (files: UploadedFile[]) => void;
}

type UploadValue = UploadedFile & {
  path?: string;
  storagePath?: string;
  dataUrl?: string;
  previouslyAdded?: boolean;
  __previouslyAdded?: boolean;
};

interface UploadListItemProps {
  disabled: boolean;
  file: UploadValue;
  index: number;
  onRemove: (index: number) => void;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Falha ao ler arquivo.'));
    reader.readAsDataURL(file);
  });
}

function rawFileUrl(file: UploadValue) {
  return file.url || file.path || file.storagePath || file.dataUrl || '';
}

function isImageFile(file: UploadValue) {
  if ((file.mimeType || '').startsWith('image')) return true;
  const ext = (file.fileName || rawFileUrl(file)).split('.').pop()?.toLowerCase() || '';
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext);
}

function wasPreviouslyAdded(file: UploadValue) {
  return Boolean(file.previouslyAdded || file.__previouslyAdded);
}

function UploadListItem({ disabled, file, index, onRemove }: UploadListItemProps) {
  const [href, setHref] = useState('');

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';

    loadUploadAssetUrl(rawFileUrl(file))
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
  }, [file]);

  return (
    <div className="upload-list-item">
      {href && isImageFile(file) ? (
        <a href={href} target="_blank" rel="noreferrer" aria-label={`Abrir ${file.fileName}`}>
          <img className="upload-list-thumb" src={href} alt={file.fileName} />
        </a>
      ) : null}
      {href ? (
        <a className="upload-list-name" href={href} target="_blank" rel="noreferrer">
          {file.fileName}
        </a>
      ) : (
        <span className="upload-list-name">{file.fileName}</span>
      )}
      {wasPreviouslyAdded(file) ? <span className="upload-previous-badge">Adicionada anteriormente</span> : null}
      {!disabled ? (
        <button
          className="upload-remove-button"
          type="button"
          onClick={() => onRemove(index)}
          aria-label={`Remover ${file.fileName}`}
          title="Remover"
        >
          X
        </button>
      ) : null}
    </div>
  );
}

export function UploadField({ label, value, projectId, disabled = false, onChange }: UploadFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const displayLabel = label.trim();
  const uploadLabel = displayLabel || 'Fotos de registro';

  async function handleFiles(files: FileList | null) {
    const selected = Array.from(files || []);
    if (!selected.length) return;

    setIsUploading(true);
    setError('');

    try {
      const items = await Promise.all(
        selected.map(async file => ({
          label: uploadLabel,
          fileName: file.name,
          mimeType: file.type || 'image/jpeg',
          dataUrl: await fileToDataUrl(file),
          projectId
        }))
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

  function removeFile(index: number) {
    const file = value[index] as UploadValue | undefined;
    if (file && wasPreviouslyAdded(file)) {
      const confirmed = window.confirm('Esta foto foi adicionada anteriormente. Se você excluir, ela sairá do relatório. Deseja excluir mesmo assim?');
      if (!confirmed) return;
    }
    onChange(value.filter((_, itemIndex) => itemIndex !== index));
  }

  const hasPreviouslyAddedFiles = value.some(file => wasPreviouslyAdded(file as UploadValue));

  return (
    <div className="upload-field">
      <div className="upload-field-head">
        <div>
          {displayLabel ? <label className="upload-field-label">{displayLabel}</label> : null}
          <div className="upload-field-count">{value.length ? `${value.length} arquivo(s)` : 'Nenhum arquivo'}</div>
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={disabled || isUploading}
          onClick={() => inputRef.current?.click()}
        >
          {isUploading ? 'Enviando...' : 'Adicionar fotos'}
        </button>
      </div>
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        multiple
        disabled={disabled || isUploading}
        onChange={event => void handleFiles(event.target.files)}
      />
      {error ? <div className="inline-error">{error}</div> : null}
      {hasPreviouslyAddedFiles ? (
        <div className="upload-previous-note">Estas fotos foram adicionadas anteriormente neste serviço. Se removidas, sairão do relatório.</div>
      ) : null}
      {value.length ? (
        <div className="upload-list">
          {value.map((file, index) => (
            <UploadListItem
              key={`${rawFileUrl(file)}-${index}`}
              disabled={disabled}
              file={file}
              index={index}
              onRemove={removeFile}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
