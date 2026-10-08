import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { parseManualReportPdfFields, manualPdfTextFromItems } from '../src/lib/reports/manual-pdf-fields.js';
import { decodeManualReportPdfDataUrl, extractManualReportPdfFields } from '../src/lib/reports/manual-pdf-extraction.js';
import { buildManualReportOperationalFields, manualReportOperationalDataSchema } from '../src/lib/reports/manual-operational-data.js';

test('padrão Passo Real lê a jornada sem confundir horários de serviços nem preencher turnos vazios', () => {
  assert.deepEqual(parseManualReportPdfFields(`
    Missão 5772 - UHE Passo Real RDO nº: 12 Data: 07/04/2026
    Entrada: 7:10 < Diurno < Noturno Intervalo de almoço: 01:00:00 Nº colaboradores (diurno): 2
    Saída: 17:30 < Diurno < Noturno Intervalo de Janta: Nº colaboradores (noturno):
    Atividades/Obs.: Chuva
    Item 01 Serviço: Filtragem Início: 08:40 Pausa: 17:10
    Horas extras (diurno): Stand-by:
    Horas extras (noturno):
    Coment. Motivo:
    Líder: Operador
  `), { arrivalTime: '07:10', departureTime: '17:30', lunchBreak: '01:00:00' });
});

test('padrão antigo importa turnos diurno e noturno, janta e stand-by preservando o motivo', () => {
  assert.deepEqual(parseManualReportPdfFields(`
    Entrada: 7:00 < Diurno 22:00 < Noturno Intervalo de almoço: 00:45:00
    Saída: 17:30 < Diurno 05:00 < Noturno Intervalo de Janta: 00:30:00
    Atividades/Obs.: Montagem
    Stand-by: 02:15:00
    Motivo: Aguardando liberação da área
    Líder: Operador
  `), {
    arrivalTime: '07:00', departureTime: '17:30', lunchBreak: '00:45:00',
    noturno: true, noturnoStart: '22:00', noturnoEnd: '05:00', noturnoInterval: '00:30:00',
    standby: true, standbyDuration: '02:15:00', standbyMotivo: 'Aguardando liberação da área'
  });
});

test('tabela atual associa entradas e saídas duplicadas ao turno correto', () => {
  assert.deepEqual(parseManualReportPdfFields(`
    Serviço: teste Início: 06:00 Término: 18:00
    JORNADA DE TRABALHO
    Turno Diurno Turno Noturno
    Entrada: 08:00 Intervalo de almoço: 1h30 Entrada: 21:00 Intervalo do jantar: 45 min
    Saída: 17:00 Nº colaboradores: 2 Saída: 04:00 Nº colaboradores: 1
    Horas extras (diurno): 01:00 Stand-by: 01:30 Horas extras (noturno): 02:00
    Motivo stand-by: Espera de equipamento
    Comentário hora extra: Serviço urgente
  `), {
    arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:30:00',
    noturno: true, noturnoStart: '21:00', noturnoEnd: '04:00', noturnoInterval: '00:45:00',
    standby: true, standbyDuration: '01:30:00', standbyMotivo: 'Espera de equipamento'
  });
});

test('turno noturno com início/término não preenche o intervalo diurno', () => {
  assert.deepEqual(parseManualReportPdfFields(`
    Turno Noturno
    Início: 22:00 Término: 06:00 Intervalo: sem intervalo
    Stand-by: 00:00:00
  `), { noturno: true, noturnoStart: '22:00', noturnoEnd: '06:00', noturnoInterval: '00:00:00' });
});

test('horários inválidos e células vazias não capturam duração ou horário de outro campo', () => {
  assert.deepEqual(parseManualReportPdfFields(`
    Entrada: Intervalo de almoço: 01:00:00
    Saída: 27:30 Intervalo de Janta: 00:40:00
    Atividades/Obs.: Entrada: 08:00 Saída: 19:00
    Stand-by: 01:99:00
  `), { lunchBreak: '01:00:00' });
  assert.deepEqual(parseManualReportPdfFields('Serviço: Teste Início: 08:00 Término: 17:00'), {});
});

test('campos incompletos permanecem visíveis para revisão sem inventar motivo ou término', () => {
  const fields = parseManualReportPdfFields('Entrada: 07:00 < Diurno 22:00 < Noturno\nStand-by: 02:00\nMotivo:___\nLíder: Operador');
  assert.deepEqual(fields, { arrivalTime: '07:00', noturno: true, noturnoStart: '22:00', standby: true, standbyDuration: '02:00:00' });
});

test('a ordem visual associa valores adicionados no fim do stream PDF aos rótulos', () => {
  const item = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y] });
  const text = manualPdfTextFromItems([
    item('Entrada:', 50, 700), item('< Diurno', 110, 700), item('< Noturno', 200, 700),
    item('Saída:', 50, 680), item('< Diurno', 110, 680), item('< Noturno', 200, 680),
    item('17:30', 90, 680), item('07:10', 90, 700), item('22:00', 170, 700), item('05:00', 170, 680)
  ]);
  assert.deepEqual(parseManualReportPdfFields(text), {
    arrivalTime: '07:10', departureTime: '17:30', noturno: true, noturnoStart: '22:00', noturnoEnd: '05:00'
  });
});

test('PDF digital é extraído e persiste intervalos, stand-by e jornada atravessando meia-noite', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  [
    'Entrada: 07:00 < Diurno 22:00 < Noturno Intervalo de almoço: 00:45',
    'Saída: 17:00 < Diurno 05:00 < Noturno Intervalo de Janta: 00:30',
    'Stand-by: 01:30', 'Motivo: Aguardando equipamento', 'Líder: Operador'
  ].forEach((text, index) => page.drawText(text, { x: 30, y: 750 - index * 20, size: 10, font }));
  const bytes = await pdf.save();
  const result = await extractManualReportPdfFields(bytes);
  assert.equal(result.source, 'text');
  assert.deepEqual(result.warnings, []);
  const f = result.fields;
  const operationalData = manualReportOperationalDataSchema.parse({
    arrivalTime: f.arrivalTime, departureTime: f.departureTime, lunchBreak: f.lunchBreak,
    noturno: { enabled: f.noturno, inicio: f.noturnoStart, termino: f.noturnoEnd, intervalo: f.noturnoInterval },
    standby: { enabled: f.standby, total: f.standbyDuration, motivo: f.standbyMotivo }
  });
  const stored = await buildManualReportOperationalFields({
    workforceHoliday: { findMany: async () => [] }, workforceCalendarState: { findUnique: async () => null }
  }, { workdayHours: '09:00' }, '2026-04-07', operationalData);
  assert.equal(stored.data.daytimeWorkedMinutes, 555);
  assert.equal(stored.data.nighttimeWorkedMinutes, 390);
  assert.equal(stored.specialConditions.standbyDetails.total, '01:30:00');
  assert.equal(stored.specialConditions.noturnoDetails.intervalo, '00:30:00');
});

test('PDF digitalizado usa OCR local para preencher os horários', { timeout: 60_000 }, async () => {
  const canvas = createCanvas(1200, 700);
  const context = canvas.getContext('2d');
  context.fillStyle = 'white'; context.fillRect(0, 0, 1200, 700);
  context.fillStyle = 'black'; context.font = '32px sans-serif';
  ['Entrada: 07:10', 'Saída: 17:30', 'Intervalo de almoço: 00:45:00', 'Stand-by: 01:30:00', 'Motivo: Aguardando equipamento', 'Líder: Operador']
    .forEach((line, index) => context.fillText(line, 40, 80 + index * 80));
  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(canvas.toBuffer('image/png'));
  pdf.addPage([600, 350]).drawImage(image, { x: 0, y: 0, width: 600, height: 350 });
  const result = await extractManualReportPdfFields(await pdf.save());
  assert.equal(result.source, 'ocr');
  assert.deepEqual(result.fields, {
    arrivalTime: '07:10', departureTime: '17:30', lunchBreak: '00:45:00',
    standby: true, standbyDuration: '01:30:00', standbyMotivo: 'Aguardando equipamento'
  });
  assert.deepEqual(result.warnings, []);
});

test('extração valida conteúdo PDF e limite de tamanho antes de processar', () => {
  assert.throws(() => decodeManualReportPdfDataUrl('data:text/plain;base64,SGVsbG8='), { statusCode: 400 });
  assert.throws(() => decodeManualReportPdfDataUrl('data:application/pdf;base64,SGVsbG8='), { statusCode: 400 });
  const oversized = Buffer.alloc(20 * 1024 * 1024 + 1);
  oversized.write('%PDF-');
  assert.throws(() => decodeManualReportPdfDataUrl(`data:application/pdf;base64,${oversized.toString('base64')}`), { statusCode: 400 });
});
