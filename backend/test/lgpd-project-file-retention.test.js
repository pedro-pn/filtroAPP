import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  isProjectImagePath,
  previewProjectFileRetention,
  projectClosedAt,
  projectFileRetentionCutoff,
  runProjectFileRetention,
  stripProjectImageReferences
} from '../src/lib/privacy/project-file-retention.js';
import { retentionHoldInputSchema, setRetentionHold } from '../src/lib/privacy/retention-holds.js';

const NOW = new Date('2026-11-18T12:00:00.000Z');
const FOLDER = 'Missão 1234 - Plataforma P-1';

test('closure uses the most recent of report finalization, end date and last RDO', () => {
  assert.equal(projectFileRetentionCutoff(NOW).toISOString(), '2016-11-18T12:00:00.000Z');
  const closed = projectClosedAt({ acompanhamentoReportArchivedAt: new Date('2015-01-01'), endDate: new Date('2014-06-01') },
    new Date('2015-03-10'));
  assert.equal(closed.toISOString(), '2015-03-10T00:00:00.000Z');
  assert.equal(projectClosedAt({ acompanhamentoReportArchivedAt: null, endDate: null }, null), null);
});

test('only image files inside the project folder are retention targets', () => {
  assert.equal(isProjectImagePath(`${FOLDER}/RDO 01/foto.jpg`, '1234'), true);
  assert.equal(isProjectImagePath(`${FOLDER}/RDO 01/relatorio.pdf`, '1234'), false);
  assert.equal(isProjectImagePath('certificados-calibracao/manometro.jpg', '1234'), false);
  assert.equal(isProjectImagePath('Missão 9999 - Outro/foto.jpg', '1234'), false);
});

test('photo references are stripped from lists and scalar fields, everything else stays', () => {
  const removed = new Set();
  const { value } = stripProjectImageReferences({
    generalUploads: [`/relatorios/${encodeURI(FOLDER)}/a.jpg`, { url: `${FOLDER}/b.png`, label: 'B' }, 'texto comum'],
    capa: `${FOLDER}/capa.webp`,
    certificado: { publicUrl: '/certificados-calibracao/x.pdf' },
    assinatura: 'data:image/png;base64,AAAA',
    nested: { __uploads__: [{ label: 'g', files: [`${FOLDER}/c.jpeg`] }] }
  }, '1234', removed);
  assert.deepEqual(value, {
    generalUploads: ['texto comum'],
    capa: null,
    certificado: { publicUrl: '/certificados-calibracao/x.pdf' },
    assinatura: 'data:image/png;base64,AAAA',
    nested: { __uploads__: [{ label: 'g', files: [] }] }
  });
  assert.deepEqual([...removed].sort(), [`${FOLDER}/a.jpg`, `${FOLDER}/b.png`, `${FOLDER}/c.jpeg`, `${FOLDER}/capa.webp`].sort());
});

function projectClient({ projects, report, latestReportDate = new Date('2014-05-01'), onHoldRecheck = false, heldIds = [] }) {
  const calls = [];
  const client = {
    project: {
      findMany: async args => { calls.push(['project.findMany', args]); return projects; },
      findFirst: async args => { calls.push(['project.findFirst', args]); return { id: args.where.id }; },
      update: async args => { calls.push(['project.update', args]); return {}; }
    },
    dataRetentionHold: {
      findMany: async () => heldIds.map(targetId => ({ targetId })),
      findUnique: async () => (onHoldRecheck ? { id: 'hold' } : null),
      count: async () => heldIds.length
    },
    report: {
      groupBy: async () => projects.map(project => ({ projectId: project.id, _max: { reportDate: latestReportDate } })),
      findMany: async () => [{ id: 'r1' }],
      findUnique: async () => report,
      update: async args => { calls.push(['report.update', args]); return {}; }
    },
    reportService: { update: async args => { calls.push(['reportService.update', args]); return {}; } },
    reportPdfAttachment: {
      deleteMany: async args => { calls.push(['reportPdfAttachment.deleteMany', args]); return { count: 1 }; },
      count: async () => 1
    },
    reportAttachment: {
      findMany: async () => [{ id: 'idx1', reportId: 'r1', reportServiceId: null, storagePath: `${FOLDER}/a.jpg` }],
      createMany: async args => { calls.push(['reportAttachment.createMany', args]); return { count: 0 }; },
      deleteMany: async args => { calls.push(['reportAttachment.deleteMany', args]); return { count: 1 }; },
      count: async () => 2
    }
  };
  client.$transaction = async callback => callback(client);
  return { client, calls };
}

test('purge removes photo references, PDF attachments and files; keeps the report and marks the project', async () => {
  const { client, calls } = projectClient({
    projects: [{ id: 'p1', code: '1234', endDate: null, acompanhamentoReportArchivedAt: new Date('2015-01-10') }],
    report: {
      id: 'r1',
      specialConditions: { generalUploads: [`${FOLDER}/a.jpg`], observacao: 'ok' },
      services: [{ id: 's1', extraData: null }, { id: 's2', extraData: { __uploads__: [{ files: [`${FOLDER}/b.jpg`] }] } }],
      pdfAttachments: [{ id: 'pa1', storagePath: 'report-pdf-attachments/r1/anexo.pdf' }]
    }
  });
  const removedFiles = [];
  const fsImpl = { rm: async target => { removedFiles.push(target); if (target.endsWith('b.jpg')) throw Object.assign(new Error('x'), { code: 'ENOENT' }); } };
  const reportsDir = '/data/relatorios';
  const totals = await runProjectFileRetention({ prismaClient: client, now: NOW, reportsDir, fsImpl, logger: { warn() {} } });

  assert.deepEqual(totals, { projectsFilesPurged: 1, reportsUpdated: 1, imageReferencesRemoved: 2, pdfAttachmentsRemoved: 1,
    filesDeleted: 2, filesMissing: 1, filesFailed: 0 });
  const reportUpdate = calls.find(([name]) => name === 'report.update')[1];
  assert.deepEqual(reportUpdate.data.specialConditions, { generalUploads: [], observacao: 'ok' });
  const serviceUpdates = calls.filter(([name]) => name === 'reportService.update').map(([, args]) => args.where.id);
  assert.deepEqual(serviceUpdates, ['s2'], 'service without photos (and null JSON) is not rewritten');
  assert.ok(calls.some(([name, args]) => name === 'reportPdfAttachment.deleteMany' && args.where.reportId === 'r1'));
  assert.ok(calls.some(([name]) => name === 'reportAttachment.deleteMany'), 'file index rows are resynced');
  const mark = calls.find(([name]) => name === 'project.update')[1];
  assert.deepEqual(mark.data, { filesRetentionPurgedAt: NOW });
  assert.deepEqual(removedFiles.sort(), [
    path.resolve(reportsDir, FOLDER, 'a.jpg'),
    path.resolve(reportsDir, FOLDER, 'b.jpg'),
    path.resolve(reportsDir, 'report-pdf-attachments/r1/anexo.pdf')
  ].sort());
  const selection = calls.find(([name]) => name === 'project.findMany')[1].where;
  assert.equal(selection.isActive, false);
  assert.equal(selection.filesRetentionPurgedAt, null);
});

test('projects closed less than 10 years ago, without dates, or put on hold meanwhile are left alone', async () => {
  const recent = projectClient({
    projects: [{ id: 'p1', code: '1234', endDate: new Date('2020-01-01'), acompanhamentoReportArchivedAt: null }],
    report: null,
    latestReportDate: null
  });
  const none = await runProjectFileRetention({ prismaClient: recent.client, now: NOW, reportsDir: '/data' });
  assert.equal(none.projectsFilesPurged, 0);
  assert.equal(recent.calls.some(([name]) => name === 'project.update'), false);

  const held = projectClient({
    projects: [{ id: 'p1', code: '1234', endDate: null, acompanhamentoReportArchivedAt: new Date('2014-01-01') }],
    report: null,
    onHoldRecheck: true
  });
  const skipped = await runProjectFileRetention({ prismaClient: held.client, now: NOW, reportsDir: '/data' });
  assert.equal(skipped.projectsFilesPurged, 0);
  assert.equal(held.calls.some(([name]) => name === 'project.update'), false);
});

test('project preview reports counts and codes only', async () => {
  const { client } = projectClient({
    projects: [
      { id: 'p1', code: '1234', endDate: null, acompanhamentoReportArchivedAt: new Date('2014-01-01') },
      { id: 'p2', code: '5678', endDate: null, acompanhamentoReportArchivedAt: null }
    ],
    report: null,
    latestReportDate: null,
    heldIds: ['p9']
  });
  const preview = await previewProjectFileRetention({ prismaClient: client, now: NOW });
  assert.deepEqual(preview, {
    projectFilesRemoveBefore: '2016-11-18T12:00:00.000Z',
    projectsToPurgeFiles: 1,
    projectsToPurgeFilesSample: [{ id: 'p1', code: '1234' }],
    projectFileIndexRowsToRemove: 2,
    projectPdfAttachmentsToRemove: 1,
    archivedProjectsWithoutClosureDate: 1,
    projectsOnRetentionHold: 1
  });
});

test('retention holds live in their own table, need a reason, and are removed on release', async () => {
  assert.throws(() => retentionHoldInputSchema.parse({ kind: 'project', code: '1234', hold: true }), /motivo/);
  const calls = [];
  const target = {
    findUnique: async ({ where }) => (where.code === '1234' ? { id: 'p1', code: '1234', name: 'Projeto' } : null)
  };
  const client = {
    project: target,
    collaborator: target,
    dataRetentionHold: {
      upsert: async args => { calls.push(['upsert', args]); return { reason: args.create.reason, createdAt: NOW }; },
      deleteMany: async args => { calls.push(['deleteMany', args]); return { count: 1 }; }
    }
  };
  assert.equal(await setRetentionHold(client, { kind: 'project', code: 'nao-existe', hold: false }), null);
  const held = await setRetentionHold(client, { kind: 'project', code: '1234', hold: true, reason: 'Processo 123' }, { userId: 'u1' });
  assert.equal(held.hold, true);
  assert.deepEqual(calls[0][1].where, { kind_targetId: { kind: 'PROJECT', targetId: 'p1' } });
  assert.deepEqual(calls[0][1].create, { kind: 'PROJECT', targetId: 'p1', reason: 'Processo 123', setByUserId: 'u1' });
  await setRetentionHold(client, { kind: 'collaborator', code: '1234', hold: false });
  assert.deepEqual(calls[1], ['deleteMany', { where: { kind: 'COLLABORATOR', targetId: 'p1' } }]);
});
