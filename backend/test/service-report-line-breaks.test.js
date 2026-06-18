import assert from 'node:assert/strict';
import test from 'node:test';

import AdmZip from 'adm-zip';

import { buildRcpDocx } from '../src/lib/report-rcp.js';
import { buildRlfDocx } from '../src/lib/report-rlf.js';
import { buildRliDocx } from '../src/lib/report-rli.js';
import { buildRlmDocx } from '../src/lib/report-rlm.js';
import { buildRlqDocx } from '../src/lib/report-rlq.js';
import { buildRtpDocx } from '../src/lib/report-rtp.js';

const builders = [
  ['RTP', buildRtpDocx],
  ['RLQ', buildRlqDocx],
  ['RCPU', buildRcpDocx],
  ['RLM', buildRlmDocx],
  ['RLF', buildRlfDocx],
  ['RLI', buildRliDocx]
];

function reportFor(type) {
  return {
    reportType: type,
    sequenceNumber: 1,
    reportDate: '2026-06-01',
    project: {
      code: 'P-1',
      name: 'Projeto',
      clientName: 'Cliente',
      clientCnpj: '',
      location: 'Local',
      contractCode: '',
      operator: {}
    },
    specialConditions: {
      serviceType: type === 'RCPU' ? 'filtragem' : '',
      serviceData: {
        'Equipamento(s)': 'EQ-01',
        Sistema: 'SIS',
        'Hora de início': '08:00',
        'Hora de término/pausa': '10:00',
        Observações: 'Primeira linha\nSegunda linha'
      },
      resolvedCollaborators: []
    }
  };
}

function countTables(zip) {
  return (zip.readAsText('word/document.xml').match(/<w:tbl\b/g) || []).length;
}

test('service report docx builders preserve observation line breaks', async () => {
  for (const [type, buildDocx] of builders) {
    const zip = new AdmZip(await buildDocx(reportFor(type)));
    const xml = zip.readAsText('word/document.xml');

    assert.match(
      xml,
      /Primeira linha[\s\S]*<w:br\s*\/>[\s\S]*Segunda linha/,
      `${type} should convert observation newlines to Word breaks`
    );
    assert.doesNotMatch(
      xml,
      /Primeira linha\r?\nSegunda linha/,
      `${type} should not leave a raw newline inside a Word text node`
    );
  }
});

test('RTP removes measurements table for Outro without diameter rows', async () => {
  const base = reportFor('RTP');
  const tubingZip = new AdmZip(await buildRtpDocx({
    ...base,
    specialConditions: {
      ...base.specialConditions,
      serviceData: {
        ...base.specialConditions.serviceData,
        'Equipamento testado': 'Tubulação'
      }
    }
  }));
  const otherZip = new AdmZip(await buildRtpDocx({
    ...base,
    specialConditions: {
      ...base.specialConditions,
      serviceData: {
        ...base.specialConditions.serviceData,
        'Equipamento testado': 'Outro',
        'Outro equipamento testado': 'Vaso de pressão'
      }
    }
  }));

  assert.equal(countTables(otherZip), countTables(tubingZip) - 1);
});
