function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

function dateOnly(value) {
  return iso(value)?.slice(0, 10) || null;
}

export function publicQualityEvidence(evidence) {
  return {
    id: evidence.id,
    kind: evidence.kind,
    label: evidence.label ?? null,
    fileName: evidence.fileName ?? null,
    mimeType: evidence.mimeType ?? null,
    position: Number(evidence.position) || 0,
    createdAt: iso(evidence.createdAt),
    downloadAvailable: evidence.kind === 'ATTACHMENT' && Boolean(evidence.storagePath)
  };
}

export function publicQualityRecord(record, { scopes = new Set(), recurrence = {} } = {}) {
  const result = {
    id: record.id,
    number: record.number,
    type: record.type,
    registeredAt: iso(record.registeredAt),
    origin: record.origin ?? null,
    project: record.project ? { id: record.project.id, code: record.project.code, name: record.project.name } : null,
    eventDate: dateOnly(record.eventDate),
    nature: record.nature ? { id: record.nature.id, name: record.nature.name, isActive: Boolean(record.nature.isActive) } : null,
    description: record.description ?? null,
    impact: record.impact ?? null,
    recurrence: {
      occurrences12m: Number(recurrence.occurrences12m) || 0,
      recurrent: Boolean(recurrence.recurrent)
    },
    linkedRnc: record.linkedRnc ?? null,
    disposition: record.disposition ?? null,
    definedAction: record.definedAction ?? null,
    actionOwner: record.actionOwner ?? null,
    actionDeadline: dateOnly(record.actionDeadline),
    evidenceSummary: record.evidences?.length
      ? `${record.evidences.length} evidência(s)`
      : record.evidence ? 'Evidência vinculada' : null,
    resultVerification: record.resultVerification ?? null,
    status: record.status ?? null,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt)
  };
  if (scopes.has('qualidade.evidencias.metadata.read')) {
    result.evidences = (record.evidences || []).map(publicQualityEvidence);
  }
  if (scopes.has('qualidade.excluidos.read')) result.deletedAt = iso(record.deletedAt);
  return result;
}

export function publicQualityNature(nature) {
  return {
    id: nature.id,
    name: nature.name,
    isActive: Boolean(nature.isActive),
    position: Number(nature.position) || 0,
    createdAt: iso(nature.createdAt),
    updatedAt: iso(nature.updatedAt)
  };
}
