import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Digests only: diagnostics can distinguish changed parent data from a changed
// return order without retaining report IDs, names, hours or database payloads.
export function summarizeLaborReportOrder(rows) {
  const records = rows.map(row => JSON.stringify([
    row.projectId, row.reportType, row.sequenceNumber, row.reportDate,
    row.daytimeWorkedMinutes, row.nighttimeWorkedMinutes
  ]));
  const digest = values => createHash('sha256').update(JSON.stringify(values)).digest('hex');
  return { rows: rows.length, orderHash: digest(records), contentHash: digest([...records].sort()) };
}

// Used only by the loopback-only synthetic benchmark, outside timed samples.
export function captureLaborQueries() {
  const queries = [];
  const original = pg.Pool.prototype.query;
  pg.Pool.prototype.query = function (...args) {
    const startedAt = performance.now();
    const pending = original.apply(this, args);
    if (!pending?.then) return pending;
    return pending.then(result => {
      const config = typeof args[0] === 'string' ? { text: args[0], values: args[1] } : args[0];
      queries.push({ startedAt, durationMs: performance.now() - startedAt,
        text: config.text, values: config.values || [], rows: result.rowCount });
      return result;
    });
  };
  const restore = () => { pg.Pool.prototype.query = original; };
  return { restore, async finish(startedAt) {
    restore();
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    const summarize = node => ({ type: node['Node Type'], relation: node['Relation Name'], index: node['Index Name'],
      rows: node['Actual Rows'], loops: node['Actual Loops'], durationMs: node['Actual Total Time'],
      sharedHitBlocks: node['Shared Hit Blocks'], sharedReadBlocks: node['Shared Read Blocks'],
      ...(node.Plans ? { children: node.Plans.map(summarize) } : {}) });
    try {
      return await Promise.all(queries.map(async query => {
        const result = { startedAt: query.startedAt - startedAt, durationMs: query.durationMs, rows: query.rows,
          sqlHash: createHash('sha256').update(query.text).digest('hex'), sqlSnippet: query.text.slice(0, 180), parameterCount: query.values.length };
        if (/^\s*SELECT\b/i.test(query.text)) {
          const explained = await pool.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + query.text, query.values);
          const plan = explained.rows[0]['QUERY PLAN'][0];
          result.explain = { planningMs: plan['Planning Time'], executionMs: plan['Execution Time'], plan: summarize(plan.Plan) };
        }
        return result;
      }));
    } finally { await pool.end(); }
  } };
}

// Separate fresh-process diagnostic. It does not warm any timed calculation.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = new URL(process.env.DATABASE_URL || 'invalid:');
  assert.ok(['postgresql:', 'postgres:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /_test$/.test(url.pathname));
  const importStartedAt = performance.now();
  const { default: database } = await import(pathToFileURL(path.join(process.argv[2], 'src/lib/prisma.js')));
  const prismaImportMs = performance.now() - importStartedAt;
  try {
    const connectStartedAt = performance.now();
    await database.$connect();
    const prismaConnectMs = performance.now() - connectStartedAt;
    const firstStartedAt = performance.now();
    await database.$queryRaw`SELECT 1`;
    const firstSqlMs = performance.now() - firstStartedAt;
    const secondStartedAt = performance.now();
    await database.$queryRaw`SELECT 1`;
    console.log(JSON.stringify({ prismaImportMs, prismaConnectMs, firstSqlMs, secondSqlMs: performance.now() - secondStartedAt }));
  } finally { await database.$disconnect(); }
}
