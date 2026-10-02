import assert from 'node:assert/strict';
import test from 'node:test';
import { ReportStatus, ReportType } from '@prisma/client';

import { clientReportTypeTabs } from '../src/lib/reports/client-tabs.js';

test('client tabs include only existing approved types and mark unreleased types as locked', () => {
  const reports = [
    { id: 'rdo', projectId: 'one', reportType: ReportType.RDO, status: ReportStatus.SIGNED },
    { id: 'rlq-locked', projectId: 'one', reportType: ReportType.RLQ, status: ReportStatus.APPROVED },
    { id: 'rlq-released', projectId: 'two', reportType: ReportType.RLQ, status: ReportStatus.APPROVED },
    { id: 'rtp-draft', projectId: 'one', reportType: ReportType.RTP, status: ReportStatus.PENDING }
  ];
  const visibleIds = new Set(['rdo', 'rlq-released']);
  assert.deepEqual(clientReportTypeTabs(reports, report => visibleIds.has(report.id)), [
    { projectId: 'one', reportType: ReportType.RDO, available: true },
    { projectId: 'one', reportType: ReportType.RLQ, available: false },
    { projectId: 'two', reportType: ReportType.RLQ, available: true }
  ]);
});

test('a released report unlocks its type without revealing report details', () => {
  const reports = [
    { id: 'locked', projectId: 'one', reportType: ReportType.RCPU, status: ReportStatus.APPROVED },
    { id: 'released', projectId: 'one', reportType: ReportType.RCPU, status: ReportStatus.APPROVED }
  ];
  assert.deepEqual(clientReportTypeTabs(reports, report => report.id === 'released'), [
    { projectId: 'one', reportType: ReportType.RCPU, available: true }
  ]);
});
