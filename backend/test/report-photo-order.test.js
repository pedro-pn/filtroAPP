import assert from 'node:assert/strict';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { DOMParser } from '@xmldom/xmldom';
import { buildReportDocx } from '../src/lib/report-docx.js';
import { buildRtpDocx } from '../src/lib/report-rtp.js';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const photos = ['segunda.png', 'terceira.png', 'primeira.png'].map(fileName => ({ fileName, url: image, mimeType: 'image/png' }));

function photoNames(buffer) {
  const zip = new AdmZip(buffer);
  const document = new DOMParser().parseFromString(zip.readAsText('word/document.xml'), 'text/xml');
  return [...document.getElementsByTagName('wp:docPr')]
    .map(node => node.getAttribute('name')).filter(name => photos.some(photo => photo.fileName === name));
}

test('documento de RDO usa a ordem salva das fotos de registro', async () => {
  const bytes = await buildReportDocx({
    reportType: 'RDO', reportDate: '2026-10-01', sequenceNumber: 1,
    project: { code: '1', name: 'Projeto' }, collaborators: [], services: [],
    specialConditions: { generalUploads: photos }
  });
  assert.deepEqual(photoNames(bytes), photos.map(photo => photo.fileName));
});

test('documento do serviço usa a ordem salva das fotos do sistema', async () => {
  const bytes = await buildRtpDocx({
    reportType: 'RTP', reportDate: '2026-10-01', sequenceNumber: 1,
    project: { code: '1', name: 'Projeto' }, collaborators: [], services: [],
    specialConditions: { serviceData: { 'Fotos do sistema': photos } }
  });
  assert.deepEqual(photoNames(bytes), photos.map(photo => photo.fileName));
});
