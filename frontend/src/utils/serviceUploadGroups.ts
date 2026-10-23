import type { UploadedFile } from '../api/uploads';

export function serviceUploadLabels(label: string): string[] {
  return label === 'Foto do laudo' ? ['Foto do laudo', 'Foto do laudo do contador'] : [label];
}

/** O editor e os documentos usam os mesmos arquivos, inclusive nos campos antigos. */
export function updateServiceUploadGroup(data: Record<string, unknown>, label: string, files: UploadedFile[]) {
  const labels = serviceUploadLabels(label);
  const groups = Array.isArray(data.__uploads__) ? data.__uploads__ as Array<{ label: string; files: UploadedFile[] }> : [];
  const filtered = groups.filter(group => !labels.includes(group.label));
  return {
    __uploads__: files.length ? [...filtered, { label, files }] : filtered,
    ...Object.fromEntries(labels.map(itemLabel => [itemLabel, files]))
  };
}

type UploadGroup = { label: string; files: UploadedFile[] };

type StoredUploadRecord = UploadedFile & {
  name?: string;
  path?: string;
  storagePath?: string;
  dataUrl?: string;
  source?: string;
  src?: string;
  href?: string;
  publicUrl?: string;
};

function uploadFileNameFromUrl(value: string) {
  const pathPart = value.split('?')[0].split('#')[0].replace(/\\/g, '/');
  const name = pathPart.split('/').filter(Boolean).pop();
  if (!name) return '';
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

function normalizeUploadFile(value: unknown, label: string): UploadedFile | null {
  if (typeof value === 'string') {
    const url = value.trim();
    if (!url) return null;
    return {
      label,
      fileName: uploadFileNameFromUrl(url) || 'arquivo',
      mimeType: 'image/jpeg',
      url
    };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const record = value as Partial<StoredUploadRecord>;
  const url = String(
    record.url
    || record.path
    || record.storagePath
    || record.dataUrl
    || record.source
    || record.src
    || record.href
    || record.publicUrl
    || record.fileName
    || ''
  ).trim();
  if (!url) return null;

  const explicitFileName = String(record.fileName || record.name || '').trim();
  const fileName = (explicitFileName && explicitFileName !== url ? explicitFileName : uploadFileNameFromUrl(url)) || 'arquivo';
  const mimeType = String(record.mimeType || 'image/jpeg').trim();
  const nextLabel = String(record.label || label).trim();

  if (record.url === url && record.fileName === fileName && record.mimeType === mimeType && record.label === nextLabel) {
    return record as UploadedFile;
  }

  return {
    ...record,
    label: nextLabel,
    fileName,
    mimeType,
    url
  } as UploadedFile;
}

function normalizeUploadFiles(value: unknown, label: string): UploadedFile[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => normalizeUploadFile(item, label))
    .filter((item): item is UploadedFile => Boolean(item));
}

export function getServiceUploadGroup(data: Record<string, unknown>, label: string): UploadedFile[] {
  const groups = Array.isArray(data.__uploads__) ? (data.__uploads__ as UploadGroup[]) : [];
  const labels = serviceUploadLabels(label);
  const group = groups.find(g => labels.includes(g.label));
  if (group) return normalizeUploadFiles(group.files, group.label || label);

  for (const itemLabel of labels) {
    const files = normalizeUploadFiles(data[itemLabel], label);
    if (files.length) return files;
  }
  return [];
}
