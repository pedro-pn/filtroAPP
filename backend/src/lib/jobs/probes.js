// Aggregate only explicitly empty checks. Work, errors and skipped lock attempts
// keep their normal JobRun records. No existing history is removed.
const WINDOW_MS = 15 * 60_000;
const clients = new WeakMap();
export async function recordEmptyJobProbe(name, { prismaClient, now, metadata }) {
  let slots = clients.get(prismaClient);
  if (!slots) { slots = new Map(); clients.set(prismaClient, slots); }
  const slot = slots.get(name);
  const result = (checks, first = now) => ({ noop: true, checks, windowStartedAt: first.toISOString(), lastCheckedAt: now.toISOString() });
  if (slot && now.getTime() >= slot.startedAt && now.getTime() - slot.startedAt < WINDOW_MS) {
    const checks = slot.checks + 1;
    // The row represents the latest sampled check; the result retains the window
    // start and count. Existing (name, startedAt) indexes still serve latest status.
    await prismaClient.jobRun.update({ where: { id: slot.id }, data: { startedAt: now, finishedAt: now, result: result(checks, new Date(slot.startedAt)) } });
    slot.checks = checks;
    return;
  }
  const run = await prismaClient.jobRun.create({ data: {
    name, status: 'COMPLETED', startedAt: now, finishedAt: now, durationMs: null,
    metadata, result: result(1)
  } });
  if (slots.size >= 128 && !slots.has(name)) slots.delete(slots.keys().next().value);
  slots.set(name, { id: run.id, checks: 1, startedAt: now.getTime() });
}
