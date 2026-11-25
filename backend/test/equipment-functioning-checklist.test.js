import assert from 'node:assert/strict';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { functioningChecklistSchema, resolveFunctioningChecklist, hasFunctioningChecklist } from '../src/lib/equipamentos/functioning-checklist.js';
import { buildFunctioningChecklistPdf } from '../src/lib/equipamentos/functioning-checklist-pdf.js';
import { buildFunctioningChecklistXlsx } from '../src/lib/equipamentos/functioning-checklist-xlsx.js';
import router from '../src/routes/resources/equipamentos.js';
import prisma from '../src/lib/prisma.js';
import { requireEquipamentosManager } from '../src/middleware/auth.js';

const template = { format: 'MONTHLY', items: ['Condições das mangueiras', 'Verificar nível de óleo do reservatório'] };
const category = { name: 'Unidades de Flushing', functioningChecklist: template };
const equipment = { id: 'eq', code: 'UFP 001', name: 'Unidade de flushing primário', isActive: true, functioningChecklist: null, category };

async function pdfText(bytes) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const pdf = await task.promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    pages.push((await page.getTextContent()).items.map(item => item.str).join(' '));
  }
  await task.destroy();
  return pages;
}

test('funcionamento herda categoria, permite modelo próprio e não usa pontos do romaneio', () => {
  assert.deepEqual(resolveFunctioningChecklist({ checklistItems: ['Romaneio'] }, category), template);
  const own = { format: 'INSPECTION', items: [] };
  assert.deepEqual(resolveFunctioningChecklist({ functioningChecklist: own }, category), own);
  assert.equal(hasFunctioningChecklist(own), true);
  assert.equal(hasFunctioningChecklist(resolveFunctioningChecklist({ functioningChecklist: { format: 'MONTHLY', items: [] } }, category)), false);
  for (const bad of [{ format: 'OTHER', items: [] }, { format: 'MONTHLY', items: [''] }, { format: 'MONTHLY', items: ['x'.repeat(301)] }]) assert.equal(functioningChecklistSchema.safeParse(bad).success, false);
});

test('PDF mensal preserva campos, 31 dias, legenda e assinaturas, sem respostas preenchidas', async () => {
  const pages = await pdfText(await buildFunctioningChecklistPdf(equipment, category));
  assert.equal(pages.length, 1);
  for (const text of ['FILTROVALI', 'CLIENTE:', 'MISSÃO:', 'ÁREA:', 'LOCAL DA OBRA:', 'PROPOSTA Nº:', 'MÊS / ANO:', ...template.items, '31', 'Funcionando com restrição', 'Parado', 'Envolvidos na atividade', 'Assinatura:']) assert.ok(pages[0].includes(text), text);
  const large = { functioningChecklist: { format: 'MONTHLY', items: Array.from({ length: 100 }, (_, n) => `Item ${n + 1}: ${'Conferir conexões e mangueiras. '.repeat(8)}`) } };
  const many = await pdfText(await buildFunctioningChecklistPdf(equipment, { ...category, ...large }));
  assert.ok(many.length > 1);
  assert.match(many.join(' '), /100\. Item 100:/);
  for (const page of many) assert.match(page, /ITENS A VERIFICAR/);
});

test('PDF de inspeção contém dez acessórios em branco, defeitos, observações, quatro responsáveis e fotos', async () => {
  const pages = await pdfText(await buildFunctioningChecklistPdf({ ...equipment, functioningChecklist: { format: 'INSPECTION', items: [], responsibleLabels: ['Responsável Filtrovali', 'Responsável', 'Responsável Filtrovali', 'Responsável MGT'] } }, category));
  assert.equal(pages.length, 2);
  for (const field of ['10.', 'Defeitos encontrados', 'Observações:', 'Fornecimento:', 'Devolução:', 'Nome:', 'Função:', 'Assinatura:']) assert.ok(pages[0].includes(field), field);
  assert.equal(pages[0].split('Assinatura:').length - 1, 4);
  assert.match(pages[0], /Responsável MGT/);
  assert.match(pages[1], /REGISTRO FOTOGRÁFICO/);
  assert.match(pages[1], /FOTO 3/);
});

test('XLSX contém grade mensal imprimível e inspeção com todos os campos, sem interpretar fórmulas', () => {
  for (const format of ['MONTHLY', 'INSPECTION']) {
    const zip = new AdmZip(buildFunctioningChecklistXlsx({ ...equipment, functioningChecklist: { format, items: ['=HYPERLINK("https://example.com")', 'Mangueira & conexão'] } }, category));
    const sheet = zip.readAsText('xl/worksheets/sheet1.xml');
    assert.match(sheet, /Mangueira &amp; conexão/);
    assert.doesNotMatch(sheet, /<f[ >]/);
    assert.match(sheet, /HYPERLINK/);
    assert.match(sheet, /fitToWidth="1"/);
    assert.match(sheet, /CLIENTE:/);
    assert.match(sheet, /MISSÃO:/);
    assert.doesNotMatch(sheet, /OS \/ MISSÃO/);
    if (format === 'MONTHLY') {
      assert.match(sheet, />31<\/t>/);
      assert.match(sheet, /MÊS \/ ANO/);
      assert.match(sheet, /orientation="landscape"/);
    } else {
      for (const field of ['Defeitos encontrados', 'Observações', 'Data do fornecimento', 'Data da devolução', 'Função:', 'Assinatura:']) assert.ok(sheet.includes(field));
      assert.match(zip.readAsText('xl/worksheets/sheet2.xml'), /FOTO 3/);
    }
  }
});

test('salvar modelo próprio e restaurar herança preserva integralmente o checklist de romaneio', async t => {
  const originalFind = prisma.companyEquipment.findUnique;
  const originalUpdate = prisma.companyEquipment.update;
  t.after(() => { prisma.companyEquipment.findUnique = originalFind; prisma.companyEquipment.update = originalUpdate; });
  const saved = [];
  prisma.companyEquipment.findUnique = async () => ({ ...equipment, attachments: [] });
  prisma.companyEquipment.update = async ({ data }) => { saved.push(data); return equipment; };
  const route = router.stack.find(layer => layer.route?.path === '/:id/functioning-checklist' && layer.route.methods.put).route;
  assert.ok(route.stack.some(layer => layer.handle === requireEquipamentosManager));
  const invoke = template => new Promise((resolve, reject) => route.stack.at(-1).handle({ params: { id: 'eq' }, body: { template } }, { json: resolve }, reject));
  await invoke({ format: 'INSPECTION', items: ['Cabo'] });
  await invoke(null);
  assert.deepEqual(Object.keys(saved[0]), ['functioningChecklist']);
  assert.equal(saved[0].functioningChecklist.format, 'INSPECTION');
  assert.notEqual(saved[1].functioningChecklist, null, 'Prisma.DbNull restaura SQL NULL');
});

test('categoria persiste o modelo de funcionamento também ao salvar o vínculo de dados técnicos', async t => {
  const calls = [];
  const mock = (target, method, implementation) => {
    const original = target[method]; target[method] = implementation;
    t.after(() => { target[method] = original; });
  };
  mock(prisma, '$transaction', async callback => callback(prisma));
  mock(prisma.equipmentAttachment, 'findMany', async () => []);
  mock(prisma.equipmentCategory, 'findUnique', async ({ where }) => where.id ? { id: 'cat', name: 'Compressores', technicalSchema: [], syncToRomaneio: false } : null);
  for (const method of ['create', 'update']) mock(prisma.equipmentCategory, method, async ({ data }) => { calls.push(data); return { id: 'cat', ...data }; });
  const invoke = (path, method, body) => {
    const route = router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route;
    return new Promise((resolve, reject) => route.stack.at(-1).handle({ params: { id: 'cat' }, body }, { status() { return this; }, json: resolve }, reject));
  };
  await invoke('/categories', 'post', { name: 'Compressores', technicalStandardId: null, functioningChecklist: template, checklistItems: ['Romaneio preservado'] });
  await invoke('/categories/:id', 'put', { technicalStandardId: null, functioningChecklist: { format: 'INSPECTION', items: [] } });
  assert.deepEqual(calls[0].functioningChecklist, template);
  assert.deepEqual(calls[0].checklistItems, ['Romaneio preservado']);
  assert.deepEqual(calls[1].functioningChecklist, { format: 'INSPECTION', items: [] });
  assert.equal(Object.hasOwn(calls[1], 'checklistItems'), false);
});
