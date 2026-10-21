import assert from 'node:assert/strict';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { buildReportDocx } from '../src/lib/report-docx.js';

test('documento de RDO usa o local atualizado quando o projeto tem um único local', async () => {
  const report = {
    reportType: 'RDO', reportDate: '2026-10-21', sequenceNumber: 1,
    project: { code: '1', name: 'Projeto', location: 'LOCAL ATUALIZADO' },
    collaborators: [], services: [], specialConditions: { workLocation: 'LOCAL ANTERIOR' }
  };
  const zip = new AdmZip(await buildReportDocx(report));
  const xml = zip.getEntries().filter(entry => /^word\/(document|header\d+)\.xml$/.test(entry.entryName))
    .map(entry => zip.readAsText(entry)).join('');
  assert.ok(xml.includes('LOCAL ATUALIZADO'));
  assert.ok(!xml.includes('LOCAL ANTERIOR'));

  const multipleLocations = new AdmZip(await buildReportDocx({ ...report, project: { ...report.project, additionalWorkLocations: ['CANTEIRO'] },
    specialConditions: { workLocation: 'CANTEIRO' } }));
  const multipleXml = multipleLocations.getEntries().filter(entry => /^word\/(document|header\d+)\.xml$/.test(entry.entryName))
    .map(entry => multipleLocations.readAsText(entry)).join('');
  assert.ok(multipleXml.includes('CANTEIRO'));
});
