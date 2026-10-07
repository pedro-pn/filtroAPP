import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import router from '../src/routes/resources/reports.js';

const route = router.stack.find(layer => layer.route?.path === '/manual-extract').route;

function invoke(body) {
  return new Promise((resolve, reject) => {
    route.stack.at(-1).handle({ body }, { json: resolve }, reject);
  });
}

test('extração manual exige a mesma permissão de gestor usada no upload', () => {
  let status;
  let allowed = false;
  const res = { status(value) { status = value; return this; }, json() {} };
  route.stack[1].handle({ auth: { user: { accountType: 'INTERNAL', moduleRoles: ['rdo:collaborator'] } } }, res, () => { allowed = true; });
  assert.equal(status, 403);
  assert.equal(allowed, false);
  route.stack[1].handle({ auth: { user: { accountType: 'INTERNAL', moduleRoles: ['rdo:manager'] } } }, res, () => { allowed = true; });
  assert.equal(allowed, true);
});

test('rota retorna campos do PDF sem precisar de projeto ou gravar relatório', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  ['Entrada: 07:10', 'Saída: 17:30', 'Intervalo de almoço: 01:00:00']
    .forEach((text, index) => page.drawText(text, { x: 30, y: 750 - index * 20, size: 12, font }));
  const result = await invoke({ pdfDataUrl: `data:application/pdf;base64,${Buffer.from(await pdf.save()).toString('base64')}` });
  assert.deepEqual(result.fields, { arrivalTime: '07:10', departureTime: '17:30', lunchBreak: '01:00:00' });
  assert.equal(result.source, 'text');
  assert.deepEqual(result.warnings, []);
});

test('rota rejeita corpo vazio e conteúdo não PDF antes de extrair', async () => {
  await assert.rejects(invoke({}), { name: 'ZodError' });
  await assert.rejects(invoke({ pdfDataUrl: 'data:application/pdf;base64,SGVsbG8=' }), { statusCode: 400 });
});
