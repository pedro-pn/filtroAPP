import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import router from '../src/routes/resources/equipamentos.js';
import prisma from '../src/lib/prisma.js';
import env from '../src/config/env.js';
import { requireEquipamentosManager } from '../src/middleware/auth.js';

function invoke(routePath, method, req) {
  const route = router.stack.find(layer => layer.route?.path === routePath && layer.route.methods[method]).route;
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { resolve({ status: this.statusCode, value }); }, end() { resolve({ status: this.statusCode }); } };
    route.stack.at(-1).handle(req, res, reject);
  });
}

function mockMethod(t, target, name, implementation) {
  const original = target[name];
  target[name] = implementation;
  t.after(() => { target[name] = original; });
}

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'equipment-documents-'));
  const originalDir = env.uploadDir;
  env.uploadDir = directory;
  t.after(async () => { env.uploadDir = originalDir; await fs.rm(directory, { recursive: true, force: true }); });
  const equipment = { id: 'equipment-1', isActive: true, category: { isActive: true, attachmentsEnabled: true } };
  const attachments = [];
  mockMethod(t, prisma.companyEquipment, 'findUnique', async ({ where }) => where.id === equipment.id ? equipment : { ...equipment, id: where.id });
  mockMethod(t, prisma.equipmentAttachment, 'create', async ({ data }) => {
    const item = { ...data, id: `document-${attachments.length + 1}`, createdAt: new Date() };
    attachments.push(item);
    return item;
  });
  const matches = (item, where) => Object.entries(where).every(([key, value]) => item[key] === value);
  mockMethod(t, prisma.equipmentAttachment, 'findMany', async ({ where }) => attachments.filter(item => matches(item, where)));
  mockMethod(t, prisma.equipmentAttachment, 'findFirst', async ({ where }) => attachments.find(item => matches(item, where)) || null);
  mockMethod(t, prisma.equipmentAttachment, 'deleteMany', async ({ where }) => {
    const index = attachments.findIndex(item => matches(item, where));
    if (index < 0) return { count: 0 };
    attachments.splice(index, 1);
    return { count: 1 };
  });
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const bytes = Buffer.from(await pdf.save());
  const body = { fileName: 'Manual técnico.pdf', mimeType: 'application/pdf', dataUrl: `data:application/pdf;base64,${bytes.toString('base64')}` };
  return { equipment, attachments, directory, bytes, body, params: { id: equipment.id } };
}

test('pasta anexa vários PDFs e remove apenas o documento solicitado do equipamento correto', async t => {
  const { attachments, body, params, directory, bytes } = await fixture(t);
  for (const fileName of ['Manual técnico.pdf', 'Diagrama.pdf']) {
    const response = await invoke('/:id/documents', 'post', { params, body: { ...body, fileName } });
    assert.equal(response.status, 201);
    assert.equal(response.value.fileName, fileName);
  }
  assert.equal(attachments.length, 2);
  assert.deepEqual(await fs.readFile(path.join(directory, attachments[0].storagePath)), bytes);
  const listed = await invoke('/:id/documents', 'get', { params });
  assert.equal(listed.value.length, 2);
  assert.equal((await invoke('/:id/documents/:documentId', 'delete', { params: { id: 'another', documentId: attachments[0].id } })).status, 404);
  const removedPath = path.join(directory, attachments[0].storagePath);
  assert.equal((await invoke('/:id/documents/:documentId', 'delete', { params: { ...params, documentId: attachments[0].id } })).status, 204);
  assert.equal(attachments.length, 1);
  await assert.rejects(fs.access(removedPath));
});

test('desativar anexos preserva documentos e bloqueia novos envios; equipamento inativo é indisponível', async t => {
  const { equipment, attachments, body, params } = await fixture(t);
  await invoke('/:id/documents', 'post', { params, body });
  equipment.category.attachmentsEnabled = false;
  assert.equal((await invoke('/:id/documents', 'post', { params, body })).status, 400);
  assert.equal((await invoke('/:id/documents', 'get', { params })).value.length, 1);
  assert.equal(attachments.length, 1);
  equipment.isActive = false;
  assert.equal((await invoke('/:id/documents', 'get', { params })).status, 404);
  assert.equal((await invoke('/:id/documents', 'post', { params, body })).status, 404);
});

test('pasta rejeita arquivo inválido e não remove certificados usando a rota de documentos', async t => {
  const { body, params, attachments } = await fixture(t);
  await assert.rejects(invoke('/:id/documents', 'post', { params, body: { ...body, dataUrl: 'data:application/pdf;base64,aW52YWxpZA==' } }), /inválido/);
  assert.equal(attachments.length, 0);
  attachments.push({ id: 'certificate', equipmentId: params.id, kind: 'CALIBRATION_CERTIFICATE' });
  assert.equal((await invoke('/:id/documents/:documentId', 'delete', { params: { ...params, documentId: 'certificate' } })).status, 404);
  assert.equal(attachments.length, 1);
});

test('somente gestores podem adicionar e excluir documentos', () => {
  for (const [routePath, method] of [['/:id/documents', 'post'], ['/:id/documents/:documentId', 'delete']]) {
    const route = router.stack.find(layer => layer.route?.path === routePath && layer.route.methods[method]).route;
    assert.ok(route.stack.some(layer => layer.handle === requireEquipamentosManager));
  }
  let status;
  requireEquipamentosManager({ auth: { user: { accountType: 'COLLABORATOR', moduleRoles: ['equipamentos:viewer'] } } }, {
    status(value) { status = value; return this; }, json() {}
  }, () => assert.fail('Consulta não deve autorizar escrita'));
  assert.equal(status, 403);
});

test('falha ao salvar o registro remove o PDF recém-enviado do armazenamento', async t => {
  const { body, params, directory } = await fixture(t);
  prisma.equipmentAttachment.create = async () => { throw new Error('Falha no banco'); };
  await assert.rejects(invoke('/:id/documents', 'post', { params, body }), /Falha no banco/);
  assert.deepEqual(await fs.readdir(path.join(directory, 'Equipamentos', 'Documentos')), []);
});

test('categoria persiste a opção Anexar documentos ao criar e editar', async t => {
  mockMethod(t, prisma.equipmentCategory, 'findUnique', async ({ where }) => where.id ? { name: 'Bombas', syncToRomaneio: false } : null);
  mockMethod(t, prisma.equipmentCategory, 'create', async ({ data }) => ({ id: 'category', ...data }));
  mockMethod(t, prisma.equipmentCategory, 'update', async ({ data }) => ({ id: 'category', ...data }));
  assert.equal((await invoke('/categories', 'post', { body: { name: 'Bombas', attachmentsEnabled: true } })).value.attachmentsEnabled, true);
  assert.equal((await invoke('/categories/:id', 'put', { params: { id: 'category' }, body: { attachmentsEnabled: false } })).value.attachmentsEnabled, false);
});
