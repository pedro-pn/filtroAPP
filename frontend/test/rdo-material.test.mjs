import assert from 'node:assert/strict';
import test from 'node:test';
import { CARBON_STEEL_ACIDS, CLEANING_CHEMICAL_LABELS, CLEANING_CHEMICAL_PRODUCTS, CLEANING_STAGES, cleaningChemicalOptions, hasRequiredCleaningChemicalProducts, materialSelection, orderedCleaningStages, selectedChemicalProducts } from '../../shared/modules/rdo-material.js';

test('Outro permanece selecionado antes de digitar, ao apagar e ao digitar um material da lista', () => {
  for (const material of ['', 'PVC', 'Inox']) {
    assert.equal(materialSelection({ materialSelection: 'Outro', material }), 'Outro');
  }
});

test('materiais de relatórios anteriores são reconhecidos sem marcador de seleção', () => {
  assert.equal(materialSelection({ material: 'Aço carbono' }), 'Aço carbono');
  assert.equal(materialSelection({ material: 'Inox' }), 'Inox');
  assert.equal(materialSelection({ material: 'CuNiFe' }), 'CuNiFe');
  assert.equal(materialSelection({ material: 'PVC' }), 'Outro');
  assert.equal(materialSelection({ material: '' }), '');
});

test('produtos do formulário e dos relatórios compartilham o catálogo e aceitam a chave legível', () => {
  assert.equal(CLEANING_CHEMICAL_PRODUCTS.length, 10);
  assert.equal(new Set(CLEANING_CHEMICAL_PRODUCTS).size, 10);
  assert.ok(CLEANING_CHEMICAL_PRODUCTS.includes('Ácido fosfórico'));
  assert.equal(CLEANING_CHEMICAL_LABELS['Carbonato de sódio'], 'Carbonato de sódio (Barrilha leve)');
  assert.equal(CLEANING_CHEMICAL_LABELS['Hidróxido de sódio'], 'Hidróxido de sódio (Soda)');
  assert.equal(CLEANING_CHEMICAL_LABELS['Ácido clorídrico'], 'Ácido clorídrico (muriático)');
  assert.deepEqual(selectedChemicalProducts({ 'Produtos químicos utilizados': ['Ácido nítrico', 'Carbonato de sódio'] }), ['Ácido nítrico', 'Carbonato de sódio']);
  assert.deepEqual(selectedChemicalProducts({ chemicalProducts: [], 'Produtos químicos utilizados': ['Ácido nítrico'] }), []);
});

test('aço carbono exige um ou mais ácidos permitidos; inox usa produtos automáticos', () => {
  assert.deepEqual(cleaningChemicalOptions({ material: 'Aço carbono' }), ['Ácido cítrico', 'Ácido fosfórico', 'Ácido clorídrico']);
  assert.equal(hasRequiredCleaningChemicalProducts({ material: 'Aço carbono' }), false);
  assert.equal(hasRequiredCleaningChemicalProducts({ material: 'Aço carbono', chemicalProducts: ['Ácido nítrico'] }), false);
  assert.equal(hasRequiredCleaningChemicalProducts({ material: 'Aço carbono', chemicalProducts: CARBON_STEEL_ACIDS }), true);
  assert.equal(hasRequiredCleaningChemicalProducts({ material: 'Inox' }), true);
  assert.deepEqual(cleaningChemicalOptions({ material: 'Inox' }), []);
  assert.deepEqual(cleaningChemicalOptions({ material: 'PVC' }), CLEANING_CHEMICAL_PRODUCTS);
  assert.equal(hasRequiredCleaningChemicalProducts({ material: 'PVC' }), false);
});

test('etapas seguem a ordem do formulário, sem duplicatas e com personalizadas no fim', () => {
  assert.deepEqual(orderedCleaningStages(['Secagem', 'Fase ácida', 'Montagem do sistema', 'fase acida', 'Fase neutralizante', 'Etapa adicional']),
    ['Montagem do sistema', 'Fase ácida', 'Fase neutralizante', 'Secagem', 'Etapa adicional']);
});

test('inox oculta a fase sequestrante, inclusive em dados antigos e etapas personalizadas', () => {
  assert.deepEqual(orderedCleaningStages([...CLEANING_STAGES].reverse(), { material: 'Aço inox' }), CLEANING_STAGES.filter(stage => stage !== 'Fase sequestrante'));
  assert.deepEqual(orderedCleaningStages(['fase sequestrante', 'Fase ácida'], { material: 'Inox' }), ['Fase ácida']);
  assert.deepEqual(orderedCleaningStages(['Fase sequestrante'], { material: 'Inox', materialSelection: 'Outro' }), ['Fase sequestrante']);
});
