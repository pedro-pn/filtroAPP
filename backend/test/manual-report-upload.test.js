import assert from 'node:assert/strict';
import test from 'node:test';

import { ReportType } from '@prisma/client';

import {
  buildManualReportOperationalFields,
  manualReportOperationalDataSchema,
  manualReportOperationalSpecialConditions
} from '../src/lib/reports/manual-operational-data.js';

const project = {
  workdayHours: '09:00',
  weekendWorkdayHours: '08:00',
  includesSaturday: false,
  includesSunday: false
};

function txWithCollaborators(ids) {
  return {
    workforceHoliday: { findMany: async () => [] },
    workforceCalendarState: { findUnique: async () => ({ id: 'global', revision: 1 }) },
    collaborator: {
      findMany: async ({ where }) => ids
        .filter(id => where.id.in.includes(id))
        .map(id => ({ id, name: `Colaborador ${id}`, jobRole: { id: 'role-tech', name: 'Técnico' } }))
    }
  };
}

test('manual report operational data calculates minutes and collaborator links', async () => {
  const operationalData = manualReportOperationalDataSchema.parse({
    arrivalTime: '07:00',
    departureTime: '17:00',
    lunchBreak: '01:00:00',
    collaboratorIds: ['col-1', 'col-2', 'col-1']
  });

  const fields = await buildManualReportOperationalFields(
    txWithCollaborators(['col-1', 'col-2']),
    project,
    '2026-07-13',
    operationalData
  );

  assert.equal(fields.data.arrivalTime, '07:00');
  assert.equal(fields.data.departureTime, '17:00');
  assert.equal(fields.data.lunchBreak, '01:00:00');
  assert.equal(fields.data.daytimeCount, 2);
  assert.equal(fields.data.daytimeWorkedMinutes, 540);
  assert.deepEqual(fields.collaboratorIds, ['col-1', 'col-2']);
});

test('manual report operational data supports daytime crossing midnight', async () => {
  const operationalData = manualReportOperationalDataSchema.parse({
    arrivalTime: '19:00',
    departureTime: '03:00',
    lunchBreak: '01:00:00',
    collaboratorIds: ['col-1']
  });

  const fields = await buildManualReportOperationalFields(
    txWithCollaborators(['col-1']),
    project,
    '2026-07-13',
    operationalData
  );

  assert.equal(fields.data.daytimeWorkedMinutes, 420);
});

test('empty manual report operational data keeps current zero defaults', async () => {
  const operationalData = manualReportOperationalDataSchema.parse({});
  const fields = await buildManualReportOperationalFields(
    txWithCollaborators([]),
    project,
    '2026-07-13',
    operationalData
  );

  assert.equal(operationalData, undefined);
  assert.deepEqual(fields.data, {
    arrivalTime: '00:00',
    departureTime: '00:00',
    lunchBreak: '00:00:00',
    daytimeCount: 0,
    daytimeWorkedMinutes: 0,
    nighttimeWorkedMinutes: 0,
    daytimeOvertimeMinutes: 0,
    nighttimeOvertimeMinutes: 0,
    totalOvertimeMinutes: 0
  });
  assert.deepEqual(fields.collaboratorIds, []);
  assert.deepEqual(fields.specialConditions, {});
});

test('manual report operational data rejects invalid and incomplete times', () => {
  assert.throws(() => manualReportOperationalDataSchema.parse({
    arrivalTime: '7pm',
    departureTime: '17:00'
  }));
  assert.throws(() => manualReportOperationalDataSchema.parse({
    arrivalTime: '07:00'
  }));
});

test('manual report operational data rejects missing collaborators', async () => {
  const operationalData = manualReportOperationalDataSchema.parse({
    arrivalTime: '07:00',
    departureTime: '17:00',
    collaboratorIds: ['col-404']
  });

  await assert.rejects(
    buildManualReportOperationalFields(txWithCollaborators([]), project, '2026-07-13', operationalData),
    /Colaborador não encontrado/
  );
});

test('manual report operational data calculates and snapshots night shift', async () => {
  const operationalData = manualReportOperationalDataSchema.parse({
    noturno: {
      enabled: true,
      inicio: '22:00',
      termino: '05:00',
      intervalo: '01:00:00',
      collaboratorIds: ['night-1']
    }
  });

  const fields = await buildManualReportOperationalFields(
    txWithCollaborators(['night-1']),
    project,
    '2026-07-13',
    operationalData
  );

  assert.equal(fields.data.nighttimeWorkedMinutes, 360);
  assert.equal(fields.specialConditions.noturno, true);
  assert.deepEqual(fields.specialConditions.noturnoDetails.collaboratorIds, ['night-1']);
  assert.deepEqual(fields.specialConditions.noturnoDetails.colaboradores, [
    { id: 'night-1', name: 'Colaborador night-1', role: 'Técnico' }
  ]);
});

test('manual report operational data stores standby for manual RDO', async () => {
  const operationalData = manualReportOperationalDataSchema.parse({
    arrivalTime: '07:00',
    departureTime: '17:00',
    collaboratorIds: ['col-1'],
    standby: {
      enabled: true,
      total: '02:00:00',
      motivo: 'Aguardando liberação da área'
    }
  });

  const fields = await buildManualReportOperationalFields(
    txWithCollaborators(['col-1']),
    project,
    '2026-07-13',
    operationalData,
    ReportType.RDO
  );

  assert.equal(fields.specialConditions.standby, true);
  assert.deepEqual(fields.specialConditions.standbyDetails, {
    total: '02:00:00',
    motivo: 'Aguardando liberação da área'
  });
});

test('manual report operational data validates standby fields', async () => {
  assert.throws(() => manualReportOperationalDataSchema.parse({
    standby: {
      enabled: true,
      total: '02:00:00'
    }
  }));
  assert.throws(() => manualReportOperationalDataSchema.parse({
    standby: {
      enabled: true,
      motivo: 'Aguardando liberação da área'
    }
  }));

  const operationalData = manualReportOperationalDataSchema.parse({
    standby: {
      enabled: true,
      total: '02:00:00',
      motivo: 'Aguardando liberação da área'
    }
  });

  await assert.rejects(
    buildManualReportOperationalFields(
      txWithCollaborators([]),
      project,
      '2026-07-13',
      operationalData,
      ReportType.RTP
    ),
    /Stand-by está disponível apenas para RDO manual/
  );
});

test('manual report operational data requires night shift start and end when enabled', () => {
  assert.throws(() => manualReportOperationalDataSchema.parse({
    noturno: {
      enabled: true,
      inicio: '22:00'
    }
  }));
});

test('disabled night shift is not stored', async () => {
  const operationalData = manualReportOperationalDataSchema.parse({
    arrivalTime: '07:00',
    departureTime: '17:00',
    noturno: {
      enabled: false,
      inicio: '22:00',
      termino: '05:00',
      collaboratorIds: ['night-1']
    }
  });

  const fields = await buildManualReportOperationalFields(
    txWithCollaborators(['night-1']),
    project,
    '2026-07-13',
    operationalData
  );

  assert.equal(fields.data.nighttimeWorkedMinutes, 0);
  assert.equal(fields.specialConditions.noturno, undefined);
  assert.equal(fields.specialConditions.noturnoDetails, undefined);
});

test('manual data special conditions preserve upload metadata and service fields', () => {
  const existing = {
    source: 'MANUAL_UPLOAD',
    serviceOnly: true,
    serviceData: { Equipamento: 'Bomba', Sistema: 'Linha A' },
    noturno: true,
    noturnoDetails: { enabled: true, inicio: '21:00', termino: '04:00' },
    overtimeSummary: { daytimeWorkedMinutes: 120 },
    __manualUpload: {
      originalFileName: 'RTP.pdf',
      uploadedAt: '2026-07-01T00:00:00.000Z',
      uploadedByUserId: 'manager-old'
    }
  };
  const next = manualReportOperationalSpecialConditions(
    existing,
    {
      noturno: true,
      noturnoDetails: { enabled: true, inicio: '22:00', termino: '05:00' },
      overtimeSummary: { nighttimeWorkedMinutes: 360 }
    },
    'manager-new',
    new Date('2026-07-13T12:00:00.000Z')
  );

  assert.equal(next.source, 'MANUAL_UPLOAD');
  assert.equal(next.serviceOnly, true);
  assert.deepEqual(next.serviceData, existing.serviceData);
  assert.equal(next.noturnoDetails.inicio, '22:00');
  assert.equal(next.overtimeSummary.nighttimeWorkedMinutes, 360);
  assert.equal(next.__manualUpload.originalFileName, 'RTP.pdf');
  assert.equal(next.__manualUpload.uploadedAt, '2026-07-01T00:00:00.000Z');
  assert.equal(next.__manualUpload.operationalDataUpdatedAt, '2026-07-13T12:00:00.000Z');
  assert.equal(next.__manualUpload.operationalDataUpdatedByUserId, 'manager-new');
});

test('manual data special conditions update and clear standby without touching observations or uploads', () => {
  const existing = {
    source: 'MANUAL_UPLOAD',
    standby: true,
    standbyDetails: {
      total: '01:00:00',
      motivo: 'Aguardando equipamento'
    },
    generalUploads: [{ url: '/foto.jpg', name: 'foto.jpg' }],
    __manualUpload: {
      originalFileName: 'RDO.pdf',
      uploadedAt: '2026-07-01T00:00:00.000Z'
    }
  };

  const updated = manualReportOperationalSpecialConditions(
    existing,
    {
      standby: true,
      standbyDetails: {
        total: '02:00:00',
        motivo: 'Aguardando liberação da área'
      }
    },
    'manager-new',
    new Date('2026-07-13T12:00:00.000Z')
  );

  assert.equal(updated.standby, true);
  assert.deepEqual(updated.standbyDetails, {
    total: '02:00:00',
    motivo: 'Aguardando liberação da área'
  });
  assert.deepEqual(updated.generalUploads, existing.generalUploads);

  const cleared = manualReportOperationalSpecialConditions(
    updated,
    { standby: false },
    'manager-new',
    new Date('2026-07-13T13:00:00.000Z')
  );

  assert.equal(cleared.standby, undefined);
  assert.equal(cleared.standbyDetails, undefined);
  assert.deepEqual(cleared.generalUploads, existing.generalUploads);
  assert.equal(cleared.__manualUpload.operationalDataUpdatedAt, '2026-07-13T13:00:00.000Z');
});

test('manual data special conditions clear operational blocks when fields are emptied', () => {
  const next = manualReportOperationalSpecialConditions(
    {
      source: 'MANUAL_UPLOAD',
      noturno: true,
      noturnoDetails: { enabled: true },
      overtimeSummary: { nighttimeWorkedMinutes: 360 },
      __manualUpload: { uploadedAt: '2026-07-01T00:00:00.000Z' }
    },
    {},
    'manager-new',
    new Date('2026-07-13T12:00:00.000Z')
  );

  assert.equal(next.noturno, undefined);
  assert.equal(next.noturnoDetails, undefined);
  assert.equal(next.overtimeSummary, undefined);
  assert.equal(next.__manualUpload.uploadedAt, '2026-07-01T00:00:00.000Z');
  assert.equal(next.__manualUpload.operationalDataUpdatedByUserId, 'manager-new');
});
