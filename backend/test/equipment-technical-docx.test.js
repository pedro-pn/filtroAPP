import assert from 'node:assert/strict';
import test from 'node:test';

import AdmZip from 'adm-zip';

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

test('technicalDatasheetFileName usa o padrão Datasheet - código - nome', () => {
  assert.equal(
    technicalDatasheetFileName({ code: 'CMR 001', name: 'Compressor 10 PCM' }),
    'Datasheet - CMR 001 - Compressor 10 PCM.pdf'
  );
});
