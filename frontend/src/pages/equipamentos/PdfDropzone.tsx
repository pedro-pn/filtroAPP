import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';

interface Props {
  id: string;
  label: string;
  file: File | null;
  onFile: (file: File | null) => void;
  currentName?: string;
  currentUrl?: string;
  currentRemoved?: boolean;
  onCurrentRemovedChange?: (removed: boolean) => void;
}

export function PdfDropzone({ id, label, file, onFile, currentName, currentUrl, currentRemoved = false, onCurrentRemovedChange }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function pick(files: FileList | null) {
    onFile(files?.[0] || null);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    pick(event.dataTransfer.files);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      inputRef.current?.click();
    }
  }

  return (
    <div className="field-group">
      <label htmlFor={id}>{label}</label>
      <div
        className={`pdf-dropzone ${dragOver ? 'drag-over' : ''} ${file ? 'has-file' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={handleKeyDown}
        onDragOver={event => { event.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <input ref={inputRef} id={id} type="file" accept="application/pdf" className="visually-hidden" onChange={event => pick(event.target.files)} />
        <span className="pdf-dropzone-icon" aria-hidden="true">⤓</span>
        <span className="pdf-dropzone-text">
          <strong>{file ? file.name : 'Arraste o PDF aqui'}</strong>
          <small>{file ? 'Clique ou solte outro para substituir' : 'ou clique para selecionar'}</small>
        </span>
        {file && (
          <button
            type="button"
            className="pdf-dropzone-clear"
            aria-label="Remover arquivo selecionado"
            onClick={event => { event.stopPropagation(); onFile(null); }}
          >
            ×
          </button>
        )}
      </div>
      {currentName && !file && !currentRemoved && (
        <div className="pdf-dropzone-current">
          {currentUrl
            ? <a className="equip-link" href={currentUrl} target="_blank" rel="noreferrer">Atual: {currentName}</a>
            : <span className="equip-muted">Atual: {currentName}</span>}
          {onCurrentRemovedChange && (
            <button
              type="button"
              className="mini-btn alt pdf-dropzone-remove-current"
              onClick={() => onCurrentRemovedChange(true)}
            >
              Remover
            </button>
          )}
        </div>
      )}
      {currentName && !file && currentRemoved && (
        <div className="pdf-dropzone-current">
          <span className="equip-muted equip-removed">Documento será removido ao salvar</span>
          {onCurrentRemovedChange && (
            <button
              type="button"
              className="mini-btn alt pdf-dropzone-undo-current"
              onClick={() => onCurrentRemovedChange(false)}
            >
              Desfazer
            </button>
          )}
        </div>
      )}
    </div>
  );
}
