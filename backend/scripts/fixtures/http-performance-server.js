import { AsyncLocalStorage } from 'node:async_hooks';
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertLocalPerformanceDatabase, createActivePoolReport } from '../lib/http-performance-report.js';

assertLocalPerformanceDatabase(process.env.DATABASE_URL);
const requestContext = new AsyncLocalStorage();
const databaseCalls = new Map();
const originalQuery = pg.Pool.prototype.query;
pg.Pool.prototype.query = function (...args) {
  const id = requestContext.getStore();
  if (Number.isInteger(id)) databaseCalls.set(id, (databaseCalls.get(id) || 0) + 1);
  return originalQuery.apply(this, args);
};
const originalInfo = console.info;
console.info = (...args) => {
  if (args[0] === '[HTTP PERFORMANCE]') {
    const id = requestContext.getStore();
    process.send({ type: 'metric', id,
      record: { ...JSON.parse(args[1]), databaseCalls: databaseCalls.get(id) || 0 } });
    databaseCalls.delete(id);
  }
};
const sourceRoot = process.argv[2] || fileURLToPath(new URL('../../', import.meta.url));
const { default: app } = await import(pathToFileURL(path.join(sourceRoot, 'src/app.js')));
const { default: database, getDatabasePoolMetrics } = await import(pathToFileURL(path.join(sourceRoot, 'src/lib/prisma.js')));
let active = 0, report = createActivePoolReport();
const sampler = setInterval(() => report.add(getDatabasePoolMetrics(), performance.now(), active), 10);
sampler.unref();
const server = http.createServer((req, res) => {
  active++;
  let complete = false;
  const end = () => { if (!complete) { complete = true; active--; } };
  res.once('finish', end); res.once('close', end);
  requestContext.run(Number(req.headers['x-http-benchmark-id']), () => app(req, res));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
process.send({ type: 'ready', port: server.address().port, poolLimit: getDatabasePoolMetrics().max });
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  clearInterval(sampler);
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  console.info = originalInfo;
  pg.Pool.prototype.query = originalQuery;
  await database.$disconnect();
  process.disconnect();
}
process.on('message', async message => {
  if (message.type === 'begin') {
    report = createActivePoolReport();
    process.send({ type: 'reply', id: message.id, result: true });
  }
  if (message.type === 'pool') process.send({ type: 'reply', id: message.id, result: report.result() });
  if (message.type === 'stop') await close();
});
process.on('disconnect', close);
