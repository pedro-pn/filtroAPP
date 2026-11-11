import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeLaborReportOrder } from '../scripts/fixtures/labor-query-profile.js';

test('report diagnostics distinguish order changes from changed source data using only digests', () => {
  const rows = [{ projectId: 'private-project', reportType: 'RDO', sequenceNumber: 1, reportDate: new Date('2026-09-01'), daytimeWorkedMinutes: 480 },
    { projectId: 'private-project', reportType: 'RDO', sequenceNumber: 2, reportDate: new Date('2026-09-01'), daytimeWorkedMinutes: 480 }];
  const original = structuredClone(rows);
  const first = summarizeLaborReportOrder(rows), reversed = summarizeLaborReportOrder([...rows].reverse());
  assert.equal(first.contentHash, reversed.contentHash);
  assert.notEqual(first.orderHash, reversed.orderHash);
  assert.deepEqual(rows, original);
  const changed = summarizeLaborReportOrder([rows[0], { ...rows[1], daytimeWorkedMinutes: 481 }]);
  assert.notEqual(first.contentHash, changed.contentHash);
  assert.deepEqual(Object.keys(first), ['rows','orderHash','contentHash']);
  assert.equal(JSON.stringify(first).includes('private-project'), false);
});
