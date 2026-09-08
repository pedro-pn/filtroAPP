import assert from 'node:assert/strict';
import test from 'node:test';

import AdmZip from 'adm-zip';

import { buildDdsDocxFields, buildReportDocx, hasEnabledDds } from '../src/lib/report-docx.js';

const emptyFields = {
  ddsdaystart: '',
  ddsdayend: '',
  ddsdaythemes: '',
  ddsnightstart: '',
  ddsnightend: '',
  ddsnightthemes: ''
};

const baseReport = {
  reportType: 'RDO',
  sequenceNumber: 1,
  reportDate: '2026-07-28',
  arrivalTime: '08:00',
  departureTime: '17:00',
  lunchBreak: '01:00',
  daytimeCount: 1,
  project: {
    code: '5761',
    name: 'Projeto',
    clientName: 'Cliente',
    clientCnpj: '',
    location: 'Local',
    contractCode: '',
    operator: {}
  },
  services: [],
  collaborators: []
};

async function documentXml(specialConditions) {
  const zip = new AdmZip(await buildReportDocx({ ...baseReport, specialConditions }));
  return zip.readAsText('word/document.xml');
}

test('relatório sem bloco dds sai com todos os campos vazios', () => {
  assert.deepEqual(buildDdsDocxFields({}), emptyFields);
  assert.deepEqual(buildDdsDocxFields(null), emptyFields);
  assert.deepEqual(buildDdsDocxFields({ noturno: true, noturnoDetails: { enabled: true } }), emptyFields);
  assert.equal(hasEnabledDds({}), false);
});

test('dds apenas diurno preenche os campos do dia e deixa noturno vazio', () => {
  const fields = buildDdsDocxFields({
    dds: {
      diurno: {
        enabled: true,
        inicio: '07:00',
        termino: '07:15',
        temas: [
          { id: 't1', name: 'Uso correto de EPI' },
          { id: 't2', name: 'Trabalho em altura' }
        ]
      },
      noturno: { enabled: false, inicio: '', termino: '', temas: [] }
    }
  });

  assert.deepEqual(fields, {
    ddsdaystart: '07:00',
    ddsdayend: '07:15',
    ddsdaythemes: 'Uso correto de EPI, Trabalho em altura',
    ddsnightstart: '',
    ddsnightend: '',
    ddsnightthemes: ''
  });
});

test('dds nos dois turnos preenche todos os campos quando há turno noturno', () => {
  const fields = buildDdsDocxFields({
    noturno: true,
    dds: {
      diurno: { enabled: true, inicio: '07:00', termino: '07:10', temas: [{ id: 't1', name: 'Riscos elétricos' }] },
      noturno: { enabled: true, inicio: '19:00', termino: '19:10', temas: [{ id: 't2', name: 'Espaço confinado' }] }
    }
  });

  assert.equal(fields.ddsdaystart, '07:00');
  assert.equal(fields.ddsdaythemes, 'Riscos elétricos');
  assert.equal(fields.ddsnightstart, '19:00');
  assert.equal(fields.ddsnightend, '19:10');
  assert.equal(fields.ddsnightthemes, 'Espaço confinado');
  assert.equal(hasEnabledDds({
    noturno: true,
    dds: { noturno: { enabled: true } }
  }), true);
});

test('dds noturno marcado sem turno noturno ativo sai vazio', () => {
  const fields = buildDdsDocxFields({
    noturno: false,
    dds: {
      diurno: { enabled: false, inicio: '', termino: '', temas: [] },
      noturno: { enabled: true, inicio: '19:00', termino: '19:15', temas: [{ id: 't1', name: 'Içamento de cargas' }] }
    }
  });

  assert.deepEqual(fields, emptyFields);
});

test('temas aceitam snapshot {id, name} e strings legadas, ignorando entradas inválidas', () => {
  const fields = buildDdsDocxFields({
    dds: {
      diurno: {
        enabled: true,
        inicio: '08:00',
        termino: '08:05',
        temas: [{ id: 't1', name: 'Ergonomia e postura' }, 'Hidratação', null, { id: 't2' }]
      }
    }
  });

  assert.equal(fields.ddsdaythemes, 'Ergonomia e postura, Hidratação');
});

test('tabela de DDS não aparece no DOCX quando nenhum turno está marcado', async () => {
  const xml = await documentXml({
    noturno: false,
    dds: {
      diurno: { enabled: false, inicio: '', termino: '', temas: [] },
      noturno: { enabled: false, inicio: '', termino: '', temas: [] }
    }
  });

  assert.doesNotMatch(xml, /DDS – DIÁLOGO DIÁRIO DE SEGURANÇA/);
});

test('tabela de DDS aparece no DOCX quando o DDS diurno está marcado', async () => {
  const xml = await documentXml({
    dds: {
      diurno: {
        enabled: true,
        inicio: '07:00',
        termino: '07:15',
        temas: [{ id: 't1', name: 'Uso correto de EPI' }]
      }
    }
  });

  assert.match(xml, /DDS – DIÁLOGO DIÁRIO DE SEGURANÇA/);
  assert.match(xml, /Uso correto de EPI/);
});
