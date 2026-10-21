import assert from 'node:assert/strict';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { DOMParser } from '@xmldom/xmldom';
import { CLEANING_STAGES } from '../../shared/modules/rdo-material.js';
import { buildRlqDocx, getProductForStep } from '../src/lib/report-rlq.js';
import { montarServico } from '../src/lib/databook/servicos.js';
import { etapasProdutoDosRlqs } from '../src/lib/databook/anexos.js';

const data = {
  materialSelection: 'Outro',
  material: 'PVC',
  chemicalProducts: ['Hidróxido de sódio', 'Ácido nítrico', 'Ácido fosfórico'],
  etapas: ['Desengraxe', 'Fase ácida', 'Fase passivante'],
  'Etapas realizadas no dia': ['Desengraxe', 'Fase ácida', 'Fase passivante'],
  'Material da tubulação': 'PVC'
};

test('RLQ usa somente os produtos marcados para Outro em cada etapa', () => {
  assert.equal(getProductForStep('Desengraxe', 'PVC', data), 'Hidróxido de sódio');
  assert.equal(getProductForStep('Fase ácida', 'PVC', data), 'Ácido nítrico e Ácido fosfórico');
  assert.equal(getProductForStep('Fase passivante', 'PVC', data), 'Ácido nítrico');
  assert.equal(getProductForStep('Fase sequestrante', 'PVC', data), 'Ácido fosfórico');
  assert.equal(getProductForStep('Montagem do sistema', 'PVC', data), '');
  assert.equal(getProductForStep('Fase ácida', 'Inox', { ...data, chemicalProducts: ['Ácido cítrico'] }), 'Ácido cítrico');
  assert.equal(getProductForStep('Fase ácida', 'PVC', { ...data, chemicalProducts: [] }), '');
  assert.equal(getProductForStep('Fase ácida', 'PVC', { ...data, chemicalProducts: ['Ácido fosfórico'] }), 'Ácido fosfórico');
});

test('materiais padrão e relatórios legados mantêm os produtos automáticos', () => {
  assert.equal(getProductForStep('Desengraxe', 'Aço carbono'), 'Hidróxido de sódio, Metassilicato de sódio e Tripolifosfato de sódio');
  assert.equal(getProductForStep('Fase ácida', 'Aço carbono'), 'Ácido cítrico');
  assert.equal(getProductForStep('Fase ácida', 'Inox', { chemicalProducts: [] }), 'Ácido fluorídrico e Ácido nítrico');
  assert.equal(getProductForStep('Fase ácida', 'PVC'), '');
  assert.equal(getProductForStep('Fase passivante', 'Inox'), 'Ácido nítrico');
  assert.equal(getProductForStep('Fase sequestrante', 'Inox'), '');
  assert.equal(getProductForStep('Fase sequestrante', 'CuNiFe'), 'Ácido cítrico');
  assert.equal(getProductForStep('Fase neutralizante', 'CuNiFe'), 'Carbonato de sódio');
});

test('documento RLQ contém o material informado e apenas os produtos químicos utilizados', async () => {
  const bytes = await buildRlqDocx({
    project: { code: '1', name: 'Teste', clientName: 'Cliente' },
    reportDate: '2026-10-21',
    collaborators: [],
    specialConditions: { serviceData: data }
  });
  const xml = new AdmZip(bytes).readAsText('word/document.xml');
  assert.match(xml, /PVC/);
  assert.match(xml, /Hidróxido de sódio/);
  assert.match(xml, /Ácido nítrico/);
  assert.match(xml, /Ácido fosfórico/);
  for (const unselected of ['Metassilicato de sódio', 'Tripolifosfato de sódio', 'Ácido cítrico', 'Ácido fluorídrico', 'Nitrito de sódio']) {
    assert.ok(!xml.includes(unselected), unselected);
  }
});

test('Data Book e vínculo de FDS usam os mesmos produtos marcados no RDO', () => {
  const service = { serviceType: 'limpeza', extraData: data };
  const mapped = montarServico({ service });
  assert.deepEqual(etapasProdutoDosRlqs([{ servicos: [mapped] }]), [
    { etapa: 'Desengraxe', produto: 'Hidróxido de sódio' },
    { etapa: 'Fase ácida', produto: 'Ácido nítrico e Ácido fosfórico' },
    { etapa: 'Fase passivante', produto: 'Ácido nítrico' }
  ]);
  const derivedOnly = montarServico({ service: { ...service, extraData: {} }, derivado: { specialConditions: { serviceData: data } } });
  assert.deepEqual(derivedOnly.chemicalProducts, data.chemicalProducts);
  const emptyDaily = montarServico({ service: { ...service, extraData: { ...data, chemicalProducts: [] } }, derivado: { specialConditions: { serviceData: data } } });
  assert.deepEqual(emptyDaily.chemicalProducts, []);
});

async function productRows(serviceData) {
  const bytes = await buildRlqDocx({ project: { code: '1', name: 'Teste' }, collaborators: [], specialConditions: { serviceData } });
  const xml = new AdmZip(bytes).readAsText('word/document.xml');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  return Array.from(doc.getElementsByTagName('w:tr'))
    .map(row => Array.from(row.getElementsByTagName('w:tc')).map(cell => Array.from(cell.getElementsByTagName('w:t')).map(node => node.textContent).join('')))
    .filter(cells => CLEANING_STAGES.includes(cells[0]));
}

test('RLQ ordena etapas fora de ordem e distribui todos os produtos de Outro nas fases correspondentes', async () => {
  const rows = await productRows({ material: 'PVC', materialSelection: 'Outro', chemicalProducts: [
    'Hidróxido de sódio', 'Metassilicato de sódio', 'Tripolifosfato de sódio',
    'Ácido fluorídrico', 'Ácido nítrico', 'Ácido fosfórico', 'Ácido cítrico', 'Ácido clorídrico (muriático)',
    'Carbonato de sódio', 'Nitrito de sódio'
  ], etapas: [...CLEANING_STAGES].reverse() });
  assert.deepEqual(rows, [
    ['Montagem do sistema', ''], ['Teste de estanqueidade', ''],
    ['Desengraxe', 'Hidróxido de sódio, Metassilicato de sódio e Tripolifosfato de sódio'],
    ['Fase ácida', 'Ácido fluorídrico, Ácido nítrico, Ácido fosfórico, Ácido cítrico e Ácido clorídrico'],
    ['Fase sequestrante', 'Ácido cítrico e Ácido fosfórico'],
    ['Fase neutralizante', 'Carbonato de sódio'], ['Fase passivante', 'Nitrito de sódio e Ácido nítrico'],
    ['Secagem', ''], ['Desmontagem do sistema', ''], ['Inspeção por boroscopia', '']
  ]);
});

test('RLQ de aço carbono exibe os ácidos escolhidos e não associa clorídrico à fase sequestrante', async () => {
  const rows = await productRows({ material: 'Aço carbono', chemicalProducts: ['Ácido cítrico', 'Ácido fosfórico', 'Ácido clorídrico'],
    etapas: ['Fase passivante', 'Fase neutralizante', 'Fase sequestrante', 'Fase ácida'] });
  assert.deepEqual(rows, [
    ['Fase ácida', 'Ácido fosfórico, Ácido cítrico e Ácido clorídrico'],
    ['Fase sequestrante', 'Ácido cítrico e Ácido fosfórico'],
    ['Fase neutralizante', 'Carbonato de sódio'], ['Fase passivante', 'Nitrito de sódio']
  ]);
  assert.equal(getProductForStep('Fase ácida', 'Aço carbono', { chemicalProducts: ['Ácido clorídrico'] }), 'Ácido clorídrico');
  assert.equal(getProductForStep('Fase sequestrante', 'Aço carbono', { chemicalProducts: ['Ácido clorídrico'] }), '');
});

test('RLQ e Data Book de inox excluem sequestrante e usam nítrico na passivação', async () => {
  const serviceData = { material: 'Inox', chemicalProducts: ['Ácido cítrico', 'Nitrito de sódio'], etapas: ['Fase passivante', 'Fase sequestrante', 'Fase ácida'] };
  const rows = await productRows(serviceData);
  assert.deepEqual(rows, [['Fase ácida', 'Ácido fluorídrico e Ácido nítrico'], ['Fase passivante', 'Ácido nítrico']]);
  const mapped = montarServico({ service: { serviceType: 'limpeza', extraData: serviceData } });
  assert.deepEqual(mapped.etapas, ['Fase ácida', 'Fase passivante']);
  assert.deepEqual(etapasProdutoDosRlqs([{ servicos: [mapped] }]), [
    { etapa: 'Fase ácida', produto: 'Ácido fluorídrico e Ácido nítrico' }, { etapa: 'Fase passivante', produto: 'Ácido nítrico' }
  ]);
});
