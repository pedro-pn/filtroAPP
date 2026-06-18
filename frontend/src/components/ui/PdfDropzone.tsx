import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';

interface Props {
  id: string;
  label: string;
  file?: File | null;
  fileName?: string;
  onFile: (file: File | null) => void;
  currentName?: string;
  currentUrl?: string;
  currentRemoved?: boolean;
  onCurrentRemovedChange?: (removed: boolean) => void;
  accept?: string;
  disabled?: boolean;
}

export function PdfDropzone({
  id,
  label,
  file = null,
  fileName = '',
  onFile,
  currentName,
  currentUrl,
  currentRemoved = false,
  onCurrentRemovedChange,
  accept = 'application/pdf,.pdf',
  disabled = false
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const selectedName = file?.name || fileName;

  function pick(files: FileList | null) {
    onFile(files?.[0] || null);
  }

  function open() {
    if (!disabled) inputRef.current?.click();
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    if (!disabled) pick(event.dataTransfer.files);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  }

  return (
    <div className="field-group">
      <label htmlFor={id}>{label}</label>
      <div
        className={`pdf-dropzone ${dragOver ? 'drag-over' : ''} ${selectedName ? 'has-file' : ''}`}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onClick={open}
        onKeyDown={handleKeyDown}
        onDragOver={event => {
          if (!disabled) {
            event.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={accept}
          className="visually-hidden"
          disabled={disabled}
          onChange={event => {
            pick(event.target.files);
            event.currentTarget.value = '';
          }}
        />
        <span className="pdf-dropzone-icon" aria-hidden="true">⤓</span>
        <span className="pdf-dropzone-text">
          <strong>{selectedName || 'Arraste o PDF aqui'}</strong>
          <small>{selectedName ? 'Clique ou solte outro para substituir' : 'ou clique para selecionar'}</small>
        </span>
        {selectedName && !disabled ? (
          <button
            type="button"
            className="pdf-dropzone-clear"
            aria-label="Remover arquivo selecionado"
            onClick={event => {
              event.stopPropagation();
              onFile(null);
            }}
          >
            ×
          </button>
        ) : null}
      </div>
      {currentName && !selectedName && !currentRemoved ? (
        <div className="pdf-dropzone-current">
          {currentUrl
            ? <a className="equip-link" href={currentUrl} target="_blank" rel="noreferrer">Atual: {currentName}</a>
            : <span className="equip-muted">Atual: {currentName}</span>}
          {onCurrentRemovedChange ? (
            <button
              type="button"
              className="mini-btn alt pdf-dropzone-remove-current"
              onClick={() => onCurrentRemovedChange(true)}
            >
              Remover
            </button>
          ) : null}
        </div>
      ) : null}
      {currentName && !selectedName && currentRemoved ? (
        <div className="pdf-dropzone-current">
          <span className="equip-muted equip-removed">Documento será removido ao salvar</span>
          {onCurrentRemovedChange ? (
            <button
              type="button"
              className="mini-btn alt pdf-dropzone-undo-current"
              onClick={() => onCurrentRemovedChange(false)}
            >
              Desfazer
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
