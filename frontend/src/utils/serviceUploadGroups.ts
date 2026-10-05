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
