export function autosaveDraftTargetId(
  activeDraftId?: string | null,
  matchingDraftIds: Array<string | null | undefined> = []
) {
  const active = String(activeDraftId || '').trim();
  if (active) return active;
  return matchingDraftIds.map(id => String(id || '').trim()).find(Boolean) || '';
}
