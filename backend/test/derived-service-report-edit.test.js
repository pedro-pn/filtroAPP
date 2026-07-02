import assert from 'node:assert/strict';
import test from 'node:test';

import { ReportSignatureStatus, ReportStatus, ReportType } from '@prisma/client';

import {
  MANUAL_DERIVED_SERVICE_REPORT_EDIT_KEY,
  canDirectEditDerivedServiceReport,
  markManualDerivedServiceReportEdit,
  shouldSkipDerivedServiceAutoSync
} from '../src/routes/resources/reports.js';

const manager = { id: 'manager-1', role: 'MANAGER' };
const coordinator = { id: 'coordinator-1', role: 'COORDINATOR' };
const signedParentRdo = {
  id: 'rdo-1',
  reportType: ReportType.RDO,
  status: ReportStatus.SIGNED,
  deletedAt: null
};
const approvedParentRdo = {
  ...signedParentRdo,
  status: ReportStatus.APPROVED
};

function linkedServiceReport(overrides = {}) {
  return {
    id: 'rcpu-1',
    reportType: ReportType.RCPU,
    status: ReportStatus.APPROVED,
    specialConditions: {
      parentRdoId: 'rdo-1',
      serviceId: 'service-1',
      serviceLinkKey: 'service-link-1'
    },
    reportSignatures: [],
    ...overrides
  };
}

test('direct derived service report edit is limited to manager after parent RDO signature', () => {
  assert.equal(canDirectEditDerivedServiceReport(manager, linkedServiceReport(), signedParentRdo), true);
  assert.equal(canDirectEditDerivedServiceReport(coordinator, linkedServiceReport(), signedParentRdo), false);
  assert.equal(canDirectEditDerivedServiceReport(manager, linkedServiceReport(), approvedParentRdo), false);
  assert.equal(canDirectEditDerivedServiceReport(manager, linkedServiceReport({ status: ReportStatus.SIGNED }), signedParentRdo), false);
  assert.equal(canDirectEditDerivedServiceReport(
    manager,
    linkedServiceReport({
      reportSignatures: [{ status: ReportSignatureStatus.SIGNED }]
    }),
    signedParentRdo
  ), false);
});

test('manual derived service edits opt the report out of parent RDO auto-sync', () => {
  const specialConditions = markManualDerivedServiceReportEdit({
    parentRdoId: 'rdo-1',
    serviceId: 'service-1',
    serviceLinkKey: 'service-link-1'
  }, manager.id);

  assert.equal(typeof specialConditions[MANUAL_DERIVED_SERVICE_REPORT_EDIT_KEY].editedAt, 'string');
  assert.equal(specialConditions[MANUAL_DERIVED_SERVICE_REPORT_EDIT_KEY].editedByUserId, manager.id);
  assert.equal(shouldSkipDerivedServiceAutoSync(linkedServiceReport({ specialConditions })), true);
  assert.equal(shouldSkipDerivedServiceAutoSync(linkedServiceReport({
    specialConditions: {
      ...specialConditions,
      serviceOnly: true
    }
  })), false);
  assert.equal(shouldSkipDerivedServiceAutoSync({
    ...linkedServiceReport({ specialConditions }),
    reportType: ReportType.RDO
  }), false);
});
