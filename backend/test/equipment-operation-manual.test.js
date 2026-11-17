import assert from 'node:assert/strict';
import test from 'node:test';

import AdmZip from 'adm-zip';
import sharp from 'sharp';

import {
  buildOperationManualDocx,
  normalizeOperationStepItems,
  normalizeOperationSteps,
  serializeOperationStepItems,
  operationManualFileName,
  operationStepsSource,
  resolveEffectiveOperationSteps
} from '../src/lib/equipamentos/operation-manual.js';

const category = {
  name: 'Bomba de Flushing',
  operationSteps: ['Posicione o equipamento.', 'Conecte as mangueiras.', 'Ligue a bomba.']
};

const equipment = {
  code: 'EQ-0142',
  name: 'Unidade UF-02 & cia',
  operationSteps: null,
  operationRevision: 3,
  operationUpdatedAt: new Date('2026-11-10T15:00:00Z')
};

function documentXml(buffer) {
  return new AdmZip(buffer).readAsText('word/document.xml');
}

test('normalizeOperationSteps limpa espaços, vazios e limita a lista', () => {
  assert.deepEqual(normalizeOperationSteps(['  a   b ', '', null, 'c']), ['a b', 'c']);
  assert.deepEqual(normalizeOperationSteps('x'), []);
  assert.equal(normalizeOperationSteps(Array.from({ length: 150 }, (_, i) => `p${i}`)).length, 100);
});

test('equipamento sem passos próprios herda o modelo da categoria', () => {
  assert.deepEqual(resolveEffectiveOperationSteps(equipment, category), category.operationSteps);
  assert.equal(operationStepsSource(equipment), 'CATEGORY');
});

test('passos próprios do equipamento substituem o modelo da categoria', () => {
  const own = { ...equipment, operationSteps: ['Só este passo.'] };
  assert.deepEqual(resolveEffectiveOperationSteps(own, category), ['Só este passo.']);
  assert.equal(operationStepsSource(own), 'EQUIPMENT');
});

test('lista própria vazia volta a herdar da categoria', () => {
  assert.deepEqual(resolveEffectiveOperationSteps({ ...equipment, operationSteps: [] }, category), category.operationSteps);
});

test('DOCX do manual: um passo numerado por linha e tokens preenchidos', async () => {
  const xml = documentXml(await buildOperationManualDocx(equipment, category));
  assert.doesNotMatch(xml, /\{\{|\}\}/);
  assert.match(xml, /MANUAL DE OPERAÇÃO/);
  assert.match(xml, /Unidade UF-02 &amp; cia/);
  assert.match(xml, /EQ-0142/);
  assert.match(xml, /Bomba de Flushing/);
  assert.match(xml, /Revisão: <\/w:t><\/w:r><w:r><w:rPr>.*?<w:t>3<\/w:t>/s);
  assert.match(xml, /10\/11\/2026/);
  for (const step of category.operationSteps) assert.ok(xml.includes(step), step);
  // 1 linha de cabeçalho da tabela de passos + 3 passos
  assert.equal((xml.match(/<w:cantSplit\/>/g) || []).length, 1 + 3);
});

test('nome do arquivo inclui código, nome e revisão', () => {
  assert.equal(
    operationManualFileName({ code: 'EQ-1', name: 'Bomba/A' }, 2),
    'Manual de Operação - EQ-1 - Bomba_A - Rev 2.pdf'
  );
});

async function pngAsset(width, height) {
  const bytes = await sharp({ create: { width, height, channels: 3, background: '#30503A' } }).png().toBuffer();
  return { bytes, extension: 'png', mimeType: 'image/png', width, height };
}

test('passos com fotos: normaliza string/objeto e serializa só com fotos como objeto', () => {
  const items = normalizeOperationStepItems(['  a  ', { text: 'b', photoIds: ['x', 'x', ' y '] }, { text: '', photoIds: ['z'] }]);
  assert.deepEqual(items, [{ text: 'a', photoIds: [] }, { text: 'b', photoIds: ['x', 'y'] }]);
  assert.deepEqual(serializeOperationStepItems(items), ['a', { text: 'b', photoIds: ['x', 'y'] }]);
  assert.deepEqual(normalizeOperationSteps(['a', { text: 'b', photoIds: ['x'] }]), ['a', 'b']);
});

test('DOCX do manual: fotos ficam logo abaixo do passo a que pertencem', async () => {
  const own = {
    ...equipment,
    operationSteps: ['Primeiro passo.', { text: 'Segundo passo.', photoIds: ['p1', 'p2', 'p3'] }, 'Terceiro passo.']
  };
  const assets = new Map([
    ['p1', await pngAsset(400, 300)],
    ['p2', await pngAsset(300, 400)],
    ['p3', await pngAsset(500, 500)]
  ]);
  const buffer = await buildOperationManualDocx(own, category, assets);
  const zip = new AdmZip(buffer);
  const xml = zip.readAsText('word/document.xml');
  assert.doesNotMatch(xml, /\{\{|\}\}/);
  assert.equal((xml.match(/<w:drawing>/g) || []).length, 3);
  const first = xml.indexOf('Primeiro passo.');
  const second = xml.indexOf('Segundo passo.');
  const third = xml.indexOf('Terceiro passo.');
  const drawings = [...xml.matchAll(/<w:drawing>/g)].map(m => m.index);
  assert.ok(drawings.every(i => i > second && i < third), 'fotos entre o 2º e o 3º passo');
  assert.ok(first < second);
  const media = zip.getEntries().filter(e => /^word\/media\/tech-.*\.png$/.test(e.entryName));
  assert.equal(media.length, 3);
  const rels = zip.readAsText('word/_rels/document.xml.rels');
  media.forEach(entry => assert.ok(rels.includes(entry.entryName.replace('word/', ''))));
  // 3 passos sem/ com poucas fotos mantêm cantSplit; o passo com 3 fotos pode quebrar de página.
  assert.equal((xml.match(/<w:cantSplit\/>/g) || []).length, 1 + 2);
});

test('foto inexistente no Map é ignorada sem deixar parágrafo vazio com token', async () => {
  const own = { ...equipment, operationSteps: [{ text: 'Passo.', photoIds: ['sumiu'] }] };
  const xml = new AdmZip(await buildOperationManualDocx(own, category, new Map())).readAsText('word/document.xml');
  assert.doesNotMatch(xml, /passo_fotos|<w:drawing>/);
});
