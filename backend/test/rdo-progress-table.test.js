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

const dailyPlanned = [{ serviceType: 'LIMPEZA_QUIMICA',
  systems: [{ systemType: 'TUBULACAO', quantity: 1000 }] }];
const dailyReports = Array.from({ length: 12 }, (_, index) => ({
  id: `daily-rdo-${index + 1}`, reportType: 'RDO', sequenceNumber: index + 1,
  reportDate: `2026-09-${String(index + 1).padStart(2, '0')}`,
  services: [{ serviceType: 'limpeza', finalized: true,
    extraData: { tubes: [{ c: '10', lengthUnit: 'm' }] } }]
}));

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

test('RDO progress keeps the first ten days and rolls the oldest day out on each following report', () => {
  for (const day of [9, 10, 11, 12]) {
    const rows = buildRdoProgressRows(dailyReports[day - 1], dailyPlanned, dailyReports);
    const visibleDays = Array.from({ length: Math.min(day, 10) }, (_, index) =>
      `${String(day - index).padStart(2, '0')}/09/2026`);
    assert.deepEqual(rows.map(row => row.progressday), visibleDays);
    assert.equal(rows[0].totalprogress, `${day * 10} m / ${day}%`);
    const oldestVisibleDay = Math.max(1, day - 9);
    assert.equal(rows.at(-1).totalprogress, `${oldestVisibleDay * 10} m / ${oldestVisibleDay}%`);
  }
});

test('the ten-day window follows the report date even when there are gaps in the RDO history', () => {
  const dates = ['2026-09-01', '2026-09-05', '2026-09-06', '2026-09-15'];
  const history = dates.map((reportDate, index) => ({ ...dailyReports[index], reportDate }));
  const rows = buildRdoProgressRows(history.at(-1), dailyPlanned, history);
  assert.deepEqual(rows.map(row => row.progressday), ['15/09/2026', '06/09/2026']);
  assert.equal(rows[0].totalprogress, '40 m / 4%');
  assert.equal(rows[1].totalprogress, '30 m / 3%');
});

test('the ten-day window crosses months and years using UTC report dates', () => {
  const history = Array.from({ length: 11 }, (_, index) => ({
    ...dailyReports[index], reportDate: new Date(Date.UTC(2026, 11, 24 + index))
  }));
  const rows = buildRdoProgressRows(history.at(-1), dailyPlanned, history);
  assert.equal(rows.length, 10);
  assert.equal(rows[0].progressday, '03/01/2027');
  assert.equal(rows.at(-1).progressday, '25/12/2026');
  assert.equal(rows[0].totalprogress, '110 m / 11%');
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

test('realized quantities show each non-tubing system type beside its own unit', () => {
  const report = {
    id: 'systems-rdo', reportType: 'RDO', sequenceNumber: 1, reportDate: '2026-09-05',
    services: [
      { serviceType: 'limpeza', finalized: true,
        extraData: { limpezaTubulacao: 'Não', quantidadeSistemas: '3', tipoSistema: 'APVs' } },
      { serviceType: 'limpeza', finalized: true,
        extraData: { 'Limpeza de tubulação?': 'Não', quantidadeSistemas: '2', 'Tipo de sistema': 'Tanques' } },
      { serviceType: 'flushing', finalized: true,
        extraData: { flushingTubulacao: 'Não', volumeOleo: '20', tipoSistema: 'Reservatórios' } },
      { serviceType: 'limpeza', finalized: false,
        extraData: { limpezaTubulacao: 'Não', quantidadeSistemas: '10', tipoSistema: 'Ignorado' } }
    ]
  };
  const scope = [
    { serviceType: 'LIMPEZA_QUIMICA', systems: [{ systemType: 'SISTEMA', quantity: 10 }] },
    { serviceType: 'FLUSHING', systems: [{ systemType: 'OLEO', quantity: 100 }] }
  ];
  const [row] = buildRdoProgressRows(report, scope);
  assert.equal(row.progressmade, '3 un (APVs) + 2 un (Tanques) + 20 L (Reservatórios)');
  assert.equal(row.totalprogress, '20 L + 5 un / 35%');
});

test('tubing services do not show a stale system type', () => {
  const report = { id: 'tubes-rdo', reportType: 'RDO', reportDate: '2026-09-05', services: [
    { serviceType: 'limpeza', finalized: true,
      extraData: { limpezaTubulacao: 'Sim', tipoSistema: 'APVs', tubes: [{ c: '3', lengthUnit: 'm' }] } }
  ] };
  const [row] = buildRdoProgressRows(report, [
    { serviceType: 'LIMPEZA_QUIMICA', systems: [{ systemType: 'TUBULACAO', quantity: 10 }] }
  ]);
  assert.equal(row.progressmade, '3 m');
});

test('DOCX prints the system type after completed units in the progress table', async () => {
  const report = {
    id: 'system-type-docx', reportType: 'RDO', sequenceNumber: 1, reportDate: '2026-09-06',
    project: { code: '1', name: 'Contrato', clientName: '', clientCnpj: '', location: '', contractCode: '', operator: {} },
    collaborators: [], services: [
      { serviceType: 'limpeza', finalized: true,
        extraData: { limpezaTubulacao: 'Não', quantidadeSistemas: '3', tipoSistema: 'APVs' } }
    ]
  };
  const zip = new AdmZip(await buildReportDocx(report));
  const doc = new DOMParser().parseFromString(zip.readAsText('word/document.xml'), 'text/xml');
  const table = Array.from(doc.getElementsByTagName('w:tbl')).find(node => node.textContent?.includes('PROGRESSO'));
  assert.match(table.textContent, /3 un \(APVs\)/);
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

test('DOCX limits the progress table to ten days while keeping all historical progress in its totals', async t => {
  const findPlanned = prisma.projectPlannedService.findMany;
  const findReports = prisma.report.findMany;
  t.after(() => {
    prisma.projectPlannedService.findMany = findPlanned;
    prisma.report.findMany = findReports;
  });
  prisma.projectPlannedService.findMany = async () => dailyPlanned;
  prisma.report.findMany = async args => {
    assert.equal(args.where.reportDate.lte.toISOString(), '2026-09-12T23:59:59.999Z');
    assert.equal(args.where.reportDate.gte, undefined);
    return dailyReports;
  };
  const report = {
    ...dailyReports.at(-1), projectId: 'contract-1',
    project: { code: '1', name: 'Contrato', clientName: '', clientCnpj: '', location: '', contractCode: '', operator: {} },
    collaborators: []
  };
  const zip = new AdmZip(await buildReportDocx(report));
  const doc = new DOMParser().parseFromString(zip.readAsText('word/document.xml'), 'text/xml');
  const table = Array.from(doc.getElementsByTagName('w:tbl')).find(node => node.textContent?.includes('PROGRESSO'));
  const rows = Array.from(table.getElementsByTagName('w:tr'));
  assert.equal(rows.length, 12);
  assert.equal(rows[0].textContent, 'PROGRESSO');
  assert.equal(rows[1].textContent, 'DiaServiçoRealizadoAcumulado');
  for (const row of rows.slice(0, 2)) {
    assert.equal(row.getElementsByTagName('w:tblHeader').length, 1,
      'the title and column legends must repeat on following pages');
  }
  for (const row of rows.slice(2)) {
    assert.equal(row.getElementsByTagName('w:tblHeader').length, 0,
      'progress data rows must not repeat as headers');
  }
  assert.match(rows[2].textContent, /12\/09\/2026.*120 m.*12%/);
  assert.match(rows.at(-1).textContent, /03\/09\/2026.*30 m.*3%/);
  assert.doesNotMatch(table.textContent, /0[12]\/09\/2026/);
  assert.doesNotMatch(table.textContent, /\{\{progress/);
});
