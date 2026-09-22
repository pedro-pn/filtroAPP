import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isReportApprovalPostProcessingProcessorConfigured,
  startReportApprovalPostProcessingJob
} from '../src/lib/reports/jobs.js';

test('report approval scheduler fails fast without a configured processor', () => {
  assert.equal(isReportApprovalPostProcessingProcessorConfigured(), false);
  assert.throws(
    () => startReportApprovalPostProcessingJob({ intervalMs: 60_000 }),
    /processor is not configured/
  );
});

test('report approval scheduler keeps a dedicated worker alive when requested', async () => {
  await import('../src/routes/resources/reports.js');

  const timer = startReportApprovalPostProcessingJob({
    intervalMs: 60_000,
    keepAlive: true
  });

  try {
    assert.equal(isReportApprovalPostProcessingProcessorConfigured(), true);
    assert.equal(timer.hasRef(), true);
    await new Promise(resolve => setImmediate(resolve));
  } finally {
    clearInterval(timer);
  }
});

test('report approval scheduler remains unreferenced in the API fallback', () => {
  const timer = startReportApprovalPostProcessingJob({ intervalMs: 60_000 });

  try {
    assert.equal(timer.hasRef(), false);
  } finally {
    clearInterval(timer);
  }
});
