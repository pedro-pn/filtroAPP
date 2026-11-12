import prisma from '../prisma.js';

function options({ now = new Date(), minAgeHours = 24, batchSize = 500 } = {}) {
  if (!Number.isInteger(minAgeHours) || minAgeHours < 1 || minAgeHours > 8760
    || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000 || !Number.isFinite(now.getTime())) {
    throw new TypeError('Limites de manutenção de revisões inválidos.');
  }
  return { cutoff: new Date(now.getTime() - minAgeHours * 3600000), batchSize };
}

export async function previewReadRevisionCompaction({ database = prisma, ...input } = {}) {
  const { cutoff, batchSize } = options(input);
  const [row] = await database.$queryRaw`
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE "writerPid" <> 0 AND "updatedAt" < ${cutoff}
        AND "writerPid" NOT IN (SELECT pid FROM pg_stat_activity))::int AS eligible
    FROM "public"."PerformanceReadRevision"
  `;
  return { scope: 'PERFORMANCE_CACHE_METADATA', ...row, cutoff: cutoff.toISOString(), batchSize };
}

export async function compactReadRevisions({ database = prisma, ...input } = {}) {
  const { cutoff, batchSize } = options(input);
  return database.$transaction(async tx => {
    const [{ locked }] = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(2026111023::bigint) AS locked`;
    if (!locked) return { scope: 'PERFORMANCE_CACHE_METADATA', locked: false, deleted: 0 };
    const rows = await tx.$queryRaw`
      SELECT id FROM "public"."PerformanceReadRevision"
      WHERE "writerPid" <> 0 AND "updatedAt" < ${cutoff}
        AND "writerPid" NOT IN (SELECT pid FROM pg_stat_activity)
      ORDER BY "updatedAt", id LIMIT ${batchSize} FOR UPDATE SKIP LOCKED
    `;
    if (!rows.length) return { scope: 'PERFORMANCE_CACHE_METADATA', locked: true, deleted: 0 };
    // Deleting markers alone could recreate an old fingerprint. Advance an
    // epoch in the same transaction; ordinary data writers never lock it.
    await tx.performanceReadRevision.update({ where: { writerPid: 0 }, data: { revision: { increment: 1 } } });
    const result = await tx.performanceReadRevision.deleteMany({ where: { id: { in: rows.map(row => row.id) } } });
    return { scope: 'PERFORMANCE_CACHE_METADATA', locked: true, deleted: result.count, batchSize };
  });
}
