import { useRef, useState } from 'react';

import { uploadFiles, type UploadedFile } from '../../api/uploads';
import { TOKEN_STORAGE_KEY } from '../../api/client';

const assetsBaseUrl = (import.meta.env.VITE_ASSETS_BASE_URL || '').replace(/\/$/, '');

interface UploadFieldProps {
  label: string;
  value: UploadedFile[];
  projectId?: string | null;
  disabled?: boolean;
  onChange: (files: UploadedFile[]) => void;
}

type UploadValue = UploadedFile & {
  path?: string;
  dataUrl?: string;
};

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
      setError(err instanceof Error ? err.message : 'Não foi possível enviar as fotos.');
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function removeFile(index: number) {
    onChange(value.filter((_, itemIndex) => itemIndex !== index));
  }

  function rawFileUrl(file: UploadValue) {
    return file.url || file.path || file.dataUrl || '';
  }

  function assetUrl(url: string) {
    if (!url) return '';
    if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url;
    // Normaliza: URLs sem barra inicial são caminhos relativos ao diretório de relatórios
    // (formato legado anterior a ter /relatorios/ como prefixo explícito)
    const normalized = url.startsWith('/') ? url : `/relatorios/${url}`;
    const protectedPath = normalized.startsWith('/relatorios/')
      ? normalized.slice('/relatorios/'.length)
      : (normalized.startsWith('/uploads/') ? normalized.slice('/uploads/'.length) : '');
    // Não precisamos do prefixo do assets para caminhos de relatórios autenticados
    const isPublic = normalized.startsWith('/assets/');
    const resolved = protectedPath
      ? `/api/uploads/file/${protectedPath}`
      : (isPublic && assetsBaseUrl ? `${assetsBaseUrl}${normalized}` : normalized);
    if (isPublic) return resolved;
    // Caminho de backend protegido: adiciona token como query param para suportar <img> e <a>
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!token) return resolved;
    const separator = resolved.includes('?') ? '&' : '?';
    return `${resolved}${separator}token=${encodeURIComponent(token)}`;
  }

  function isImageFile(file: UploadValue) {
    if ((file.mimeType || '').startsWith('image')) return true;
    const ext = (file.fileName || rawFileUrl(file)).split('.').pop()?.toLowerCase() || '';
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext);
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
          {value.map((file, index) => {
            const href = assetUrl(rawFileUrl(file));
            return (
            <div className="upload-list-item" key={`${rawFileUrl(file)}-${index}`}>
              {href && isImageFile(file) ? (
                <img className="upload-list-thumb" src={href} alt={file.fileName} />
              ) : null}
              {href ? (
                <a className="upload-list-name" href={href} target="_blank" rel="noreferrer">
                  {file.fileName}
                </a>
              ) : (
                <span className="upload-list-name">{file.fileName}</span>
              )}
              {!disabled ? (
                <button className="secondary-button" type="button" onClick={() => removeFile(index)}>
                  Remover
                </button>
              ) : null}
            </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
