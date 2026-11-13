import assert from 'node:assert/strict';
import test from 'node:test';
import { fitsMonthlySnapshotBudget } from '../src/lib/acompanhamento/monthly-snapshot-admission.js';

test('admission accepts small trusted graphs with Dates, Maps, sets, aliases and cycles', () => {
  const row = { total: .1 + .2, date: new Date('2026-09-01') };
  const value = { rows: [row], byId: new Map([['p', row]]), set: new Set([row]), bytes: new Uint8Array([1, 2]) };
  value.self = value;
  assert.equal(fitsMonthlySnapshotBudget(value, 4096), true);
  assert.equal(value.rows[0], value.byId.get('p'));
  assert.equal(value.self, value);
  assert.equal(fitsMonthlySnapshotBudget(Object.assign(Object.create(null), { value: 3 }), 1000), true);
});

test('large strings, arrays and buffers are rejected without visiting their contents', () => {
  assert.equal(fitsMonthlySnapshotBudget({ text: 'x'.repeat(32 * 1024 * 1024) }, 2 * 1024 * 1024), false);
  const rows = new Array(1000000);
  Object.defineProperty(rows, 0, { enumerable: true, get: () => assert.fail('must stop at array budget') });
  assert.equal(fitsMonthlySnapshotBudget(rows, 1000), false);
  assert.equal(fitsMonthlySnapshotBudget(Buffer.alloc(4096), 1000), false);
});

test('visit/depth bounds and unsupported values conservatively bypass admission without invoking getters', () => {
  let deep = {};
  for (let i = 0; i < 1000; i++) deep = { nested: deep };
  assert.equal(fitsMonthlySnapshotBudget(deep, 1024 * 1024), false);
  assert.equal(fitsMonthlySnapshotBudget(Array.from({ length: 50 }, () => ({})), 1024 * 1024, { maxVisits: 10 }), false);
  assert.equal(fitsMonthlySnapshotBudget({ get secret() { assert.fail('getter must not be called'); } }, 4096), false);
  assert.equal(fitsMonthlySnapshotBudget(new (class Unknown {})(), 4096), false);
  assert.equal(fitsMonthlySnapshotBudget({ callback() {} }, 4096), false);
});
