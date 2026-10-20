export function isRdoDraftPayload(payload) {
  return !payload || typeof payload !== 'object' || payload.__module !== 'romaneio';
}

// Run inside the report creation transaction so cleanup failure rolls back
// submission instead of leaving an apparently unsent draft.
export async function removeSubmittedRdoDrafts(tx, userId, { draftId, projectId, reportDate, serviceOnly = false }) {
  // Share the autosave lock, including saves from other API instances.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rdo-drafts:${userId}`}))`;
  const drafts = await tx.reportDraft.findMany({
    where: { userId },
    select: { id: true, projectId: true, reportDate: true, payload: true }
  });
  const ids = drafts.filter(draft => {
    if (!isRdoDraftPayload(draft.payload)) return false;
    if (draft.id === draftId) return true;
    const payload = draft.payload || {};
    return (draft.projectId || payload.projectId) === projectId
      && String(draft.reportDate || payload.reportDate || '').slice(0, 10) === reportDate.slice(0, 10)
      && (payload.serviceOnly === true) === serviceOnly;
  }).map(draft => draft.id);

  if (ids.length) {
    await tx.reportDraft.deleteMany({ where: { userId, id: { in: ids } } });
  }
}
