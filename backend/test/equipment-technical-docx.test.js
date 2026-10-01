import assert from 'node:assert/strict';
import test from 'node:test';

import AdmZip from 'adm-zip';
import { DOMParser } from '@xmldom/xmldom';
import sharp from 'sharp';

import { buildTechnicalDatasheetDocx, technicalDatasheetFileName } from '../src/lib/equipment-technical-docx.js';

const category = {
  name: 'Compressor',
  technicalDocEnabled: true,
  technicalSchema: [
    { key: 'pressao', label: 'Pressão Máxima', type: 'measure', unit: { dimension: 'pressao' }, order: 1, group: 'Pneumático' },
    { key: 'marca', label: 'Marca', type: 'text', order: 2 },
    {
      key: 'motores', label: 'Motores', type: 'group', repeatable: true, itemLabel: 'Motor', order: 3,
      itemSchema: [{ key: 'potencia', label: 'Potência', type: 'measure', unit: { dimension: 'potencia' }, order: 1 }]
    }
  ]
};

const equipment = {
  code: 'CMR 001',
  name: 'Compressor 10 PCM',
  technicalRevision: 2,
  attributes: { peso: '120 kg', altura: '1,8 m', largura: '90 cm', comprimento: '1,2 m' },
  technicalData: {
    pressao: { value: '9,6', unit: 'bar' },
    marca: 'Chiaperini',
    motores: [{ potencia: { value: '20', unit: 'CV' } }, { potencia: { value: '15', unit: 'CV' } }]
  }
};

function documentXml(buffer) {
  const zip = new AdmZip(buffer);
  return zip.readAsText('word/document.xml');
}

// Texto visível concatenado (o Word quebra tokens/valores em vários runs <w:t>).
function visibleText(xml) {
  const matches = [...xml.matchAll(/<w:t\b[^>]*>(.*?)<\/w:t>/gs)].map(m => m[1]);
  return matches.join('')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

async function photoAssets(dimensions) {
  return Promise.all(dimensions.map(async ([width, height], index) => ({
    bytes: await sharp({ create: { width, height, channels: 3, background: '#bde5ff' } }).png().toBuffer(),
    width,
    height,
    extension: 'png',
    mimeType: 'image/png',
    label: `Foto ${index + 1}`
  })));
}

function photosTable(buffer) {
  const doc = new DOMParser().parseFromString(documentXml(buffer), 'text/xml');
  return Array.from(doc.getElementsByTagName('w:tbl')).find(table => table.textContent.includes('FOTOS'));
}

test('buildTechnicalDatasheetDocx preenche tokens-base e não deixa placeholders', async () => {
  const buffer = await buildTechnicalDatasheetDocx(equipment, category);
  const xml = documentXml(buffer);
  const text = visibleText(xml);

  // tokens da Tabela 1 (identificação) preenchidos
  assert.ok(text.includes('Compressor 10 PCM'), 'nome do equipamento');
  assert.ok(text.includes('CMR 001'), 'código');
  assert.ok(text.includes('Compressor'), 'categoria');
  assert.ok(text.includes('120 kg'), 'peso de attributes');
  assert.ok(text.includes('1,8 m'), 'altura de attributes');

  // nenhum placeholder {{...}} sobra no documento
  assert.ok(!/\{\{.*?\}\}/.test(text), `sobrou placeholder: ${text}`);
});

test('buildTechnicalDatasheetDocx clona a Tabela 2 por seção e por campo', async () => {
  const buffer = await buildTechnicalDatasheetDocx(equipment, category);
  const text = visibleText(documentXml(buffer));

  // faixa de seção + campos
  assert.ok(text.includes('Pneumático'), 'título de seção');
  assert.ok(text.includes('Pressão Máxima'), 'rótulo do campo');
  assert.ok(text.includes('9,6 bar'), 'valor do campo');
  assert.ok(text.includes('Chiaperini'), 'campo sem seção (Dados)');
  assert.ok(text.includes('Dados'), 'fallback de seção "Dados"');

  // grupo de subcampo único repetido (Motor com Potência -> 2 valores)
  assert.ok(text.includes('Motor #1'), 'item de grupo 1');
  assert.ok(text.includes('20 CV'), 'valor do grupo 1');
  assert.ok(text.includes('Motor #2'), 'item de grupo 2');
  assert.ok(text.includes('15 CV'), 'valor do grupo 2');
});

test('remove a linha de dimensões da Tabela 1 quando altura/largura/comprimento vazios', async () => {
  const semDim = { ...equipment, attributes: { peso: '120 kg' } };
  const text = visibleText(documentXml(await buildTechnicalDatasheetDocx(semDim, category)));
  assert.ok(!text.includes('Altura:'), 'linha de dimensões removida quando vazia');
  assert.ok(text.includes('Peso:'), 'a linha do peso permanece');

  const text2 = visibleText(documentXml(await buildTechnicalDatasheetDocx(equipment, category)));
  assert.ok(text2.includes('Altura:'), 'com dimensão, a linha permanece');
});

test('remove a tabela FOTOS quando não há fotos (sem placeholder remanescente)', async () => {
  const text = visibleText(documentXml(await buildTechnicalDatasheetDocx(equipment, category, [])));
  assert.ok(!text.includes('FOTOS'), 'tabela de fotos removida quando vazia');
  assert.ok(!/\{\{\s*fotos\s*\}\}/.test(text), 'sem placeholder de fotos remanescente');
});

test('quatro fotos verticais ficam em duas linhas independentes para paginar sem corte', async () => {
  const assets = await photoAssets(Array.from({ length: 4 }, () => [800, 1200]));
  const buffer = await buildTechnicalDatasheetDocx(equipment, category, assets);
  const table = photosTable(buffer);
  assert.ok(table, 'mantém a tabela de fotos');
  const rows = Array.from(table.getElementsByTagName('w:tr'));
  const photoRows = rows.filter(row => row.getElementsByTagName('wp:extent').length > 0);

  assert.equal(photoRows.length, 2, 'cada par ocupa uma linha da tabela');
  assert.equal(rows[0].getElementsByTagName('w:tblHeader').length, 1, 'o título FOTOS continua sendo o cabeçalho');
  for (const row of photoRows) {
    assert.equal(row.getElementsByTagName('wp:extent').length, 2);
    assert.equal(row.getElementsByTagName('w:tblHeader').length, 0, 'fotos não são repetidas como cabeçalho');
    assert.equal(row.getElementsByTagName('w:cantSplit').length, 1, 'mantém cada par inteiro na página');
    assert.equal(row.getElementsByTagName('w:trHeight').length, 0, 'a linha cresce conforme o conteúdo');
    assert.equal(row.getElementsByTagName('w:tcW')[0].getAttribute('w:w'), '10456', 'preserva a largura da célula do modelo');
  }
});

test('fotos de proporções diferentes cabem em largura e altura sem recortar, inclusive quantidade ímpar', async () => {
  const assets = await photoAssets([[1200, 800], [800, 1200], [400, 1600], [1600, 400], [100, 100]]);
  const buffer = await buildTechnicalDatasheetDocx(equipment, category, assets);
  const zip = new AdmZip(buffer);
  const table = photosTable(buffer);
  const photoRows = Array.from(table.getElementsByTagName('w:tr')).filter(row => row.getElementsByTagName('wp:extent').length > 0);
  assert.deepEqual(photoRows.map(row => row.getElementsByTagName('wp:extent').length), [2, 2, 1]);
  const extents = Array.from(table.getElementsByTagName('wp:extent'));
  const shapeExtents = Array.from(table.getElementsByTagName('a:ext'));
  const images = Array.from(table.getElementsByTagName('a:blip'));
  const rels = new DOMParser().parseFromString(zip.readAsText('word/_rels/document.xml.rels'), 'text/xml');
  const relationships = Array.from(rels.getElementsByTagName('Relationship'));

  extents.forEach((extent, index) => {
    const width = Number(extent.getAttribute('cx'));
    const height = Number(extent.getAttribute('cy'));
    assert.ok(width > 0 && width <= 2857500, 'largura máxima de 7,94 cm');
    assert.ok(height > 0 && height <= 3600000, 'altura máxima de 10 cm');
    assert.ok(Math.abs(width / height - assets[index].width / assets[index].height) < 0.00001, 'preserva a proporção original');
    assert.equal(shapeExtents[index].getAttribute('cx'), String(width));
    assert.equal(shapeExtents[index].getAttribute('cy'), String(height));
    const relId = images[index].getAttribute('r:embed');
    const target = relationships.find(rel => rel.getAttribute('Id') === relId).getAttribute('Target');
    assert.deepEqual(zip.readFile(`word/${target}`), assets[index].bytes, 'embute a imagem original completa');
  });
  assert.equal(table.getElementsByTagName('a:srcRect').length, 0, 'sem região de recorte');
});

test('technicalDatasheetFileName usa o padrão Datasheet - código - nome', () => {
  assert.equal(
    technicalDatasheetFileName({ code: 'CMR 001', name: 'Compressor 10 PCM' }),
    'Datasheet - CMR 001 - Compressor 10 PCM.pdf'
  );
});

test('technicalDatasheetFileName inclui a revisão no nome quando informada', () => {
  assert.equal(
    technicalDatasheetFileName({ code: 'CMR 001', name: 'Compressor 10 PCM' }, 3),
    'Datasheet - CMR 001 - Compressor 10 PCM - Rev 3.pdf'
  );
  // null/ausente não adiciona sufixo (mantém retrocompatibilidade).
  assert.equal(
    technicalDatasheetFileName({ code: 'CMR 001', name: 'Compressor 10 PCM' }, null),
    'Datasheet - CMR 001 - Compressor 10 PCM.pdf'
  );
});
