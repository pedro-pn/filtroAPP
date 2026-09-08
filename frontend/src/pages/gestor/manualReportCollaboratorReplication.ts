export type ManualReportCollaboratorField = 'collaboratorIds' | 'noturnoCollaboratorIds';

export interface ManualReportCollaboratorReplicationPrompt {
  sourceFileId: string;
  field: ManualReportCollaboratorField;
  collaboratorIds: string[];
}

interface ManualReportCollaboratorFile {
  id: string;
  collaboratorIds: string[];
  noturnoCollaboratorIds: string[];
}

export function replicateManualReportCollaborators<T extends ManualReportCollaboratorFile>(
  files: T[],
  sourceFileId: string,
  field: ManualReportCollaboratorField,
  collaboratorIds: string[]
): T[] {
  const idsToApply = Array.from(new Set(collaboratorIds.filter(Boolean)));
  if (!idsToApply.length) return files;

  let changed = false;
  const replicatedFiles = files.map(file => {
    if (file.id === sourceFileId) return file;

    const currentIds = file[field];
    const nextIds = Array.from(new Set([...currentIds, ...idsToApply]));
    if (nextIds.length === currentIds.length) return file;

    changed = true;
    return { ...file, [field]: nextIds };
  });

  return changed ? replicatedFiles : files;
}
