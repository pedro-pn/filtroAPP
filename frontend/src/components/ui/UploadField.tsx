import { useRef, useState } from 'react';

import { uploadFiles, type UploadedFile } from '../../api/uploads';

interface UploadFieldProps {
  label: string;
  value: UploadedFile[];
  projectId?: string | null;
  disabled?: boolean;
  onChange: (files: UploadedFile[]) => void;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Falha ao ler arquivo.'));
    reader.readAsDataURL(file);
  });
}

export function UploadField({ label, value, projectId, disabled = false, onChange }: UploadFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');

  async function handleFiles(files: FileList | null) {
    const selected = Array.from(files || []);
    if (!selected.length) return;

    setIsUploading(true);
    setError('');

    try {
      const items = await Promise.all(
        selected.map(async file => ({
          label,
          fileName: file.name,
          mimeType: file.type || 'image/jpeg',
          dataUrl: await fileToDataUrl(file),
          projectId
        }))
      );
      const uploaded = await uploadFiles(items);
      onChange([...value, ...uploaded]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'N\u00e3o foi poss\u00edvel enviar as fotos.');
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function removeFile(index: number) {
    onChange(value.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <div className="upload-field">
      <div className="upload-field-head">
        <div>
          <label className="upload-field-label">{label}</label>
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
      {value.length ? (
        <div className="upload-list">
          {value.map((file, index) => (
            <div className="upload-list-item" key={`${file.url}-${index}`}>
              <span>{file.fileName}</span>
              {!disabled ? (
                <button className="secondary-button" type="button" onClick={() => removeFile(index)}>
                  Remover
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
