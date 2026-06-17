import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';

interface ImageDropzoneProps {
  onFile: (file: File | null) => void;
  previewSrc?: string;
  accept?: string;
  disabled?: boolean;
  placeholder?: string;
  hint?: string;
  ariaLabel?: string;
}

export function ImageDropzone({
  onFile,
  previewSrc,
  accept = 'image/*',
  disabled = false,
  placeholder = 'Arraste a imagem aqui',
  hint = 'ou clique para selecionar',
  ariaLabel = 'Carregar imagem'
}: ImageDropzoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function pick(files: FileList | null) {
    onFile(files?.[0] || null);
  }

  function open() {
    if (!disabled) inputRef.current?.click();
  }

  return (
    <div
      className={`upload-dropzone image-dropzone ${dragOver ? 'drag-over' : ''} ${previewSrc ? 'has-file' : ''}`}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={ariaLabel}
      onClick={open}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
      }}
      onDragOver={(event: DragEvent<HTMLDivElement>) => { if (!disabled) { event.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragOver(false); if (!disabled) pick(event.dataTransfer.files); }}
    >
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={event => { pick(event.target.files); event.currentTarget.value = ''; }}
      />
      {previewSrc ? (
        <img className="image-dropzone-preview" src={previewSrc} alt="Prévia" />
      ) : (
        <span className="upload-dropzone-icon" aria-hidden="true">⤓</span>
      )}
      <span className="upload-dropzone-text">
        <strong>{previewSrc ? 'Imagem carregada' : placeholder}</strong>
        <small>{previewSrc ? 'Clique ou solte outra para substituir' : hint}</small>
      </span>
      {previewSrc && !disabled && (
        <button type="button" className="pdf-dropzone-clear" aria-label="Remover imagem" onClick={event => { event.stopPropagation(); onFile(null); }}>×</button>
      )}
    </div>
  );
}
