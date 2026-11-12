import prisma from '../prisma.js';

function jsonInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : String(value);
}

// Operational aggregates only. Never select names, metadata, results or errors.
// The bounded read-only transaction also protects against accidental writes in
// future changes and restores the timeout when its connection is returned.
export async function reportJobRunVolume({ days = 7, database = prisma } = {}) {
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new TypeError('A janela deve ter entre 1 e 90 dias.');
  return database.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
    const [storage] = await tx.$queryRaw`
      SELECT CURRENT_TIMESTAMP AS "observedAt", current_setting('transaction_read_only')::boolean AS "readOnly", c.reltuples AS "estimatedRows",
        pg_table_size(c.oid)::text AS "tableBytes", pg_indexes_size(c.oid)::text AS "indexBytes",
        pg_total_relation_size(c.oid)::text AS "totalBytes"
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'JobRun'
    `;
    if (storage?.readOnly !== true) throw new Error('A transação de leitura não foi confirmada.');
    const rows = await tx.$queryRaw`
      SELECT "createdAt"::date AS day,
        CASE WHEN status IN ('RUNNING', 'COMPLETED', 'SKIPPED', 'FAILED') THEN status ELSE 'OTHER' END AS status,
        COUNT(*)::text AS rows
      FROM "public"."JobRun"
      WHERE "createdAt" >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - (${days}::integer - 1)
      GROUP BY 1, 2 ORDER BY 1, 2
    `;
    return { complete: true, readOnly: true, windowDays: days,
      observedAt: storage.observedAt.toISOString(),
      storage: { estimatedRows: storage.estimatedRows >= 0 ? Math.round(storage.estimatedRows) : null,
        tableBytes: jsonInteger(storage.tableBytes), indexBytes: jsonInteger(storage.indexBytes), totalBytes: jsonInteger(storage.totalBytes) },
      rowsByUtcDayAndStatus: rows.map(row => ({ day: row.day.toISOString().slice(0, 10), status: row.status, rows: jsonInteger(row.rows) }))
    };
  }, { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 10000 });
}
