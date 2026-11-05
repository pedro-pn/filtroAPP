import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { apiSimulationDatabase } from './helpers/api-simulation-db.js';

test('PostgreSQL WASM keeps a pooled read outside a transaction that rolls back', { timeout: 30_000 }, async t => {
  const database = await apiSimulationDatabase();
  t.after(() => database.close());
  const prisma = database.client;
  const project = await prisma.project.create({ data: {
    code: 'status-isolation', name: 'Persisted', clientName: '', clientCnpj: '', contractCode: '', location: ''
  } });
  let enter, finish;
  const entered = new Promise(resolve => { enter = resolve; });
  const proceed = new Promise(resolve => { finish = resolve; });
  const rollback = assert.rejects(prisma.$transaction(async tx => {
    await tx.project.update({ where: { id: project.id }, data: { name: 'Uncommitted' } });
    enter();
    await proceed;
    throw new Error('Rollback isolation test');
  }), /Rollback isolation test/);
  await entered;
  const concurrentRead = prisma.project.findUnique({ where: { id: project.id } }).then(row => row);
  // Give the read a turn while the transaction still owns its connection.
  await setImmediate();
  finish();
  await rollback;
  assert.equal((await concurrentRead).name, 'Persisted');
});
