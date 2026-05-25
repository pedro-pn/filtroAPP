import assert from 'node:assert/strict';
import test from 'node:test';

import { ReportStatus, ReportType } from '@prisma/client';

import {
  canClientSeeReport,
  previousRdosSignedForServiceReport,
  releasedServiceReportsAfterRdoSignature
} from '../src/routes/resources/reports.js';

function report(overrides = {}) {
  return {
    id: overrides.id || 'report-1',
    projectId: 'project-1',
    reportType: ReportType.RDO,
    status: ReportStatus.APPROVED,
    reportDate: '2026-05-20',
    deletedAt: null,
    specialConditions: {},
    project: {
      id: 'project-1',
      code: 'P-1',
      name: 'Projeto 1',
      clientCnpj: '12345678000190',
      deletedAt: null
    },
    ...overrides
  };
}

function byId(reports) {
  return new Map(reports.map(item => [item.id, item]));
}

test('service report stays hidden while any previous project RDO is not signed', () => {
  const firstRdo = report({
    id: 'rdo-1',
    status: ReportStatus.APPROVED,
    reportDate: '2026-05-20'
  });
  const finalRdo = report({
    id: 'rdo-2',
    status: ReportStatus.SIGNED,
    reportDate: '2026-05-21'
  });
  const serviceReport = report({
    id: 'rcpu-1',
    reportType: ReportType.RCPU,
    status: ReportStatus.APPROVED,
    reportDate: '2026-05-21',
    specialConditions: { parentRdoId: finalRdo.id }
  });

  const reports = byId([firstRdo, finalRdo, serviceReport]);

  assert.equal(previousRdosSignedForServiceReport(serviceReport, finalRdo, reports), false);
  assert.equal(canClientSeeReport(serviceReport, reports), false);
});

test('service report is visible when parent and all previous project RDOs are signed', () => {
  const firstRdo = report({
    id: 'rdo-1',
    status: ReportStatus.SIGNED,
    reportDate: '2026-05-20'
  });
  const finalRdo = report({
    id: 'rdo-2',
    status: ReportStatus.SIGNED,
    reportDate: '2026-05-21'
  });
  const serviceReport = report({
    id: 'rcpu-1',
    reportType: ReportType.RCPU,
    status: ReportStatus.APPROVED,
    reportDate: '2026-05-21',
    specialConditions: { parentRdoId: finalRdo.id }
  });

  const reports = byId([firstRdo, finalRdo, serviceReport]);

  assert.equal(previousRdosSignedForServiceReport(serviceReport, finalRdo, reports), true);
  assert.equal(canClientSeeReport(serviceReport, reports), true);
});

test('signing an earlier RDO reports service documents that become visible', async () => {
  const firstRdo = report({
    id: 'rdo-1',
    status: ReportStatus.SIGNED,
    reportDate: '2026-05-20'
  });
  const finalRdo = report({
    id: 'rdo-2',
    status: ReportStatus.SIGNED,
    reportDate: '2026-05-21'
  });
  const serviceReport = report({
    id: 'rcpu-1',
    reportType: ReportType.RCPU,
    sequenceNumber: 7,
    status: ReportStatus.APPROVED,
    reportDate: '2026-05-21',
    specialConditions: { parentRdoId: finalRdo.id }
  });
  const client = {
    report: {
      findMany: async () => [firstRdo, finalRdo, serviceReport]
    }
  };

  const released = await releasedServiceReportsAfterRdoSignature(firstRdo, client);

  assert.deepEqual(released.map(item => ({
    id: item.id,
    projectId: item.projectId,
    reportType: item.reportType,
    sequenceNumber: item.sequenceNumber,
    project: item.project
  })), [{
    id: 'rcpu-1',
    projectId: 'project-1',
    reportType: ReportType.RCPU,
    sequenceNumber: 7,
    project: {
      id: 'project-1',
      code: 'P-1',
      name: 'Projeto 1'
    }
  }]);
});
