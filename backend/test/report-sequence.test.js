import assert from 'node:assert/strict';
import test from 'node:test';

import { reserveSequence } from '../src/routes/resources/reports.js';

test('reserveSequence reserves report numbers with an atomic upsert increment', async () => {
  const calls = [];
  let nextNumber = 0;
  const tx = {
    projectReportSeq: {
      upsert: async args => {
        calls.push(args);
        if (nextNumber === 0) {
          nextNumber = args.create.nextNumber;
        } else {
          nextNumber += args.update.nextNumber.increment;
        }
        return { nextNumber };
      }
    }
  };

  const [first, second] = await Promise.all([
    reserveSequence(tx, 'project-1', 'RDO'),
    reserveSequence(tx, 'project-1', 'RDO')
  ]);

  assert.deepEqual([first, second], [1, 2]);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.deepEqual(call.where, {
      projectId_reportType: {
        projectId: 'project-1',
        reportType: 'RDO'
      }
    });
    assert.deepEqual(call.create, {
      projectId: 'project-1',
      reportType: 'RDO',
      nextNumber: 1
    });
    assert.deepEqual(call.update, {
      nextNumber: { increment: 1 }
    });
    assert.deepEqual(call.select, { nextNumber: true });
  }
});
