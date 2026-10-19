export function autosaveDraftTargetId(
  activeDraftId?: string | null,
  matchingDraftIds: Array<string | null | undefined> = []
) {
  const active = String(activeDraftId || '').trim();
  if (active) return active;
  return matchingDraftIds.map(id => String(id || '').trim()).find(Boolean) || '';
}

export function createDraftSaveQueue() {
  let pending: Promise<boolean> = Promise.resolve(true);
  let paused = false;

  return {
    enqueue(save: () => Promise<boolean>) {
      if (paused) return Promise.resolve(false);
      const result = pending.then(() => paused ? false : save());
      pending = result.catch(() => false);
      return result;
    },
    async pause() {
      paused = true;
      await pending;
    },
    resume() {
      paused = false;
    }
  };
}
