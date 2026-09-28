import assert from 'node:assert/strict';
import test from 'node:test';

import AdmZip from 'adm-zip';
import { DOMParser } from '@xmldom/xmldom';

import prisma from '../src/lib/prisma.js';
import { buildRdoProgressRows } from '../src/lib/reports/rdo-progress-table.js';
import { buildReportDocx } from '../src/lib/report-docx.js';

const planned = [
  { serviceType: 'LIMPEZA_QUIMICA', scopeName: 'Escopo A', weight: 1,
    systems: [{ systemType: 'TUBULACAO', quantity: 100, unit: 'M' }] },
  { serviceType: 'FILTRAGEM', scopeName: 'Escopo B', weight: 1,
    systems: [{ systemType: 'OLEO', quantity: 100, unit: 'L' }] }
];

const reports = [
  { id: 'rdo-1', reportType: 'RDO', sequenceNumber: 1, reportDate: '2026-09-01',
    services: [{ serviceType: 'limpeza', finalized: true, extraData: { tubes: [{ c: '5.000', lengthUnit: 'cm' }] } }] },
  { id: 'rdo-2', reportType: 'RDO', sequenceNumber: 2, reportDate: '2026-09-02',
    services: [{ serviceType: 'limpeza', finalized: false, extraData: { tubes: [{ c: '70', lengthUnit: 'm' }] } }] },
  { id: 'rdo-3', reportType: 'RDO', sequenceNumber: 3, reportDate: '2026-09-03',
    services: [{ serviceType: 'filtragem', finalized: true, extraData: { volumeOleo: '20.000', volumeOleoUnit: 'mL' } }] }
];

test('RDO progress displays newest RDO first with the cumulative value for each day', () => {
  const rows = buildRdoProgressRows(reports[2], planned, reports);
  assert.deepEqual(rows, [
    { progressday: '03/09/2026', progressservicetype: 'Filtragem', progressmade: '20 L', totalprogress: '50 m + 20 L / 35%' },
    { progressday: '02/09/2026', progressservicetype: '—', progressmade: '—', totalprogress: '50 m + 0 L / 25%' },
    { progressday: '01/09/2026', progressservicetype: 'Limpeza química', progressmade: '50 m', totalprogress: '50 m + 0 L / 25%' }
  ]);
});

test('RDO progress stops at the current sequence and uses the current report content', () => {
  const changed = { ...reports[1], services: [{ serviceType: 'limpeza', finalized: true,
    extraData: { tubes: [{ c: '25', lengthUnit: 'm' }] } }] };
  const rows = buildRdoProgressRows(changed, planned, [...reports, {
    id: 'rdo-4', reportType: 'RDO', sequenceNumber: 4, reportDate: '2026-09-02', services: []
  }]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].progressmade, '25 m');
  assert.equal(rows[0].totalprogress, '75 m + 0 L / 37,5%');
});

test('one measurement unit uses the planned quantity of every contract scope', () => {
  const scope = [
    { serviceType: 'LIMPEZA_QUIMICA', scopeName: 'A', systems: [{ systemType: 'TUBULACAO', quantity: 100 }] },
    { serviceType: 'FLUSHING', scopeName: 'B', systems: [{ systemType: 'TUBULACAO', quantity: 900 }] }
  ];
  const rows = buildRdoProgressRows(reports[0], scope, reports);
  assert.equal(rows[0].totalprogress, '50 m / 5%');
});

test('completed system units are counted once and combined with other finished services', () => {
  const current = {
    id: 'unit-rdo', reportType: 'RDO', sequenceNumber: 1, reportDate: '2026-09-04',
    services: [
      { serviceType: 'limpeza', finalized: true,
        extraData: { limpezaTubulacao: 'Não', quantidadeSistemas: '2' } },
      { serviceType: 'filtragem', finalized: true,
        extraData: { volumeOleo: '10', volumeOleoUnit: 'L' } },
      { serviceType: 'limpeza', finalized: false,
        extraData: { limpezaTubulacao: 'Não', quantidadeSistemas: '10' } }
    ]
  };
  const scope = [
    { serviceType: 'LIMPEZA_QUIMICA', systems: [{ systemType: 'SISTEMA', quantity: 4 }] },
    { serviceType: 'FILTRAGEM', systems: [{ systemType: 'OLEO', quantity: 20 }] }
  ];
  const [row] = buildRdoProgressRows(current, scope);
  assert.equal(row.progressservicetype, 'Limpeza química, Filtragem');
  assert.equal(row.progressmade, '10 L + 2 un');
  assert.equal(row.totalprogress, '10 L + 2 un / 50%');
});

test('DOCX loads contract RDOs, repeats the progress template row and replaces every placeholder', async t => {
  const findPlanned = prisma.projectPlannedService.findMany;
  const findReports = prisma.report.findMany;
  t.after(() => {
    prisma.projectPlannedService.findMany = findPlanned;
    prisma.report.findMany = findReports;
  });
  prisma.projectPlannedService.findMany = async args => {
    assert.deepEqual(args.where, { projectId: 'contract-1' });
    return planned;
  };
  prisma.report.findMany = async args => {
    assert.equal(args.where.projectId, 'contract-1');
    assert.equal(args.where.reportType, 'RDO');
    assert.equal(args.where.deletedAt, null);
    return reports;
  };
  const report = {
    ...reports[2],
    projectId: 'contract-1',
    project: { code: '1', name: 'Contrato', clientName: '', clientCnpj: '', location: '', contractCode: '', operator: {} },
    collaborators: []
  };
  const zip = new AdmZip(await buildReportDocx(report));
  const doc = new DOMParser().parseFromString(zip.readAsText('word/document.xml'), 'text/xml');
  const table = Array.from(doc.getElementsByTagName('w:tbl')).find(node => node.textContent?.includes('PROGRESSO'));
  const rows = Array.from(table.getElementsByTagName('w:tr'));
  assert.equal(rows.length, 5);
  assert.match(rows[2].textContent, /03\/09\/2026.*Filtragem.*20 L.*35%/);
  assert.match(rows[4].textContent, /01\/09\/2026.*Limpeza química.*50 m.*25%/);
  assert.doesNotMatch(table.textContent, /\{\{progress/);
});
