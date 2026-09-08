import assert from 'node:assert/strict';
import test from 'node:test';

import AdmZip from 'adm-zip';

import { buildRcpDocx } from '../src/lib/report-rcp.js';
import { buildRlfDocx } from '../src/lib/report-rlf.js';
import { buildRliDocx } from '../src/lib/report-rli.js';
import { buildRlmDocx } from '../src/lib/report-rlm.js';
import { buildRlqDocx } from '../src/lib/report-rlq.js';
import { buildRtpDocx, rtpEquipmentTypeLabel } from '../src/lib/report-rtp.js';

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

test('service report templates with a collaborator table render the saved role', async () => {
  const buildersWithCollaboratorTable = builders.filter(([type]) => (
    ['RTP', 'RLQ', 'RCPU', 'RLM'].includes(type)
  ));

  for (const [type, buildDocx] of buildersWithCollaboratorTable) {
    const report = reportFor(type);
    report.collaborators = [{
      collaboratorId: 'collaborator-1',
      roleNameSnapshot: 'Inspetor N2',
      collaborator: {
        name: 'Ana da Silva',
        jobRole: { name: 'Supervisor atual' }
      }
    }];
    report.specialConditions.resolvedCollaborators = [{
      id: 'collaborator-1',
      name: 'Ana da Silva',
      role: '',
      shift: 'Noturno'
    }];

    const zip = new AdmZip(await buildDocx(report));
    const xml = zip.readAsText('word/document.xml');

    assert.match(xml, /Ana da Silva/, `${type} should render the collaborator name`);
    assert.match(xml, /Inspetor N2/, `${type} should render the saved collaborator role`);
  }
});

test('RLQ uses sodium carbonate in neutralizing and sequestering phases', async () => {
  const base = reportFor('RLQ');
  const zip = new AdmZip(await buildRlqDocx({
    ...base,
    specialConditions: {
      ...base.specialConditions,
      serviceData: {
        ...base.specialConditions.serviceData,
        'Etapas realizadas no dia': ['Fase neutralizante', 'Fase sequestrante']
      }
    }
  }));
  const xml = zip.readAsText('word/document.xml');

  assert.equal((xml.match(/Carbonato de sódio/g) || []).length, 2);
  assert.doesNotMatch(xml, /Carbonato de cálcio/i);
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

test('RTP equipment type placeholder value is uppercase', () => {
  assert.equal(rtpEquipmentTypeLabel({ 'Equipamento testado': 'Tubulação' }), 'TUBULAÇÕES');
  assert.equal(rtpEquipmentTypeLabel({ 'Equipamento testado': 'Mangueiras' }), 'MANGUEIRAS');
  assert.equal(
    rtpEquipmentTypeLabel({
      'Equipamento testado': 'Outro',
      'Outro equipamento testado': 'vaso de pressão'
    }),
    'VASO DE PRESSÃO'
  );
});

test('RTP fills the selected manometer tag', async () => {
  const base = reportFor('RTP');
  const zip = new AdmZip(await buildRtpDocx({
    ...base,
    specialConditions: {
      ...base.specialConditions,
      resolvedManometers: [{
        code: 'MAN-042',
        scale: '0–600 bar',
        certCode: 'CERT-042',
        calibratedAt: '2026-01-15',
        expiresAt: '2027-01-15'
      }]
    }
  }));
  const xml = zip.readAsText('word/document.xml');

  assert.match(xml, /MAN-042/);
  assert.doesNotMatch(xml, /\{\{manometer_tag\}\}/);
});
