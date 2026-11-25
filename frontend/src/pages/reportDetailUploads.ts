import type { UploadedFile } from '../api/uploads';
import { normalizeLocalUploadUrl } from '../utils/uploadAssetUrl';

const getString = (value: unknown) => typeof value === 'string' ? value : '';

export function asUploadedFiles(value: unknown): UploadedFile[] {
  return Array.isArray(value)
    ? value
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map(item => {
        const url = getString(item.url)
          || getString(item.path)
          || getString(item.storagePath)
          || getString(item.dataUrl)
          || getString(item.source)
          || getString(item.src)
          || getString(item.href)
          || getString(item.publicUrl)
          || getString(item.fileName);
        return {
          label: getString(item.label) || 'Arquivo',
          fileName: getString(item.fileName) || getString(item.name) || url || 'arquivo',
          mimeType: getString(item.mimeType) || getString(item.type) || 'image/jpeg',
          url: normalizeLocalUploadUrl(url)
        };
      })
      .filter((item): item is UploadedFile => Boolean(item.url))
    : [];
}
