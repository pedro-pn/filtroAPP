// Owned by one group request. Overlapping member reads share in-flight results;
// different requests and different access scopes never share this loader.
export function createReportCostCollaboratorLoader(database) {
  const cache = new Map();
  let pending = new Map(), scheduled = false;
  async function flush() {
    const batch = pending;
    pending = new Map(); scheduled = false;
    try {
      const rows = await database.collaborator.findMany({
        where: { id: { in: [...batch.keys()] } },
        select: {
          id: true, rdoCostSimulationExcluded: true,
          jobRole: { select: { id: true, name: true } },
          jobRoleHistory: {
            select: { jobRoleId: true, effectiveDate: true, jobRole: { select: { id: true, name: true } } }
          }
        }
      });
      const byId = new Map(rows.map(row => [row.id, row]));
      for (const [id, entry] of batch) entry.resolve(byId.get(id) ?? null);
    } catch (error) {
      for (const [id, entry] of batch) { cache.delete(id); entry.reject(error); }
    }
  }
  return ids => Promise.all([...new Set(ids)].map(id => {
    if (!cache.has(id)) {
      cache.set(id, new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); }));
      if (!scheduled) { scheduled = true; queueMicrotask(flush); }
    }
    return cache.get(id);
  })).then(rows => rows.filter(Boolean));
}
