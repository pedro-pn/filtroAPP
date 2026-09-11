import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConsolidationPlan, normalizeAssetCode, rewriteDraftReferences } from '../scripts/consolidate-romaneio-equipment-catalog.js';
import { syncCatalogRows } from '../src/lib/romaneio-catalog.js';

function fixture() {
  const common = { kind: 'EQUIPMENT', measureType: 'UNIT', isSerialized: true, isActive: true, hiddenInRomaneioAt: null };
  return {
    catalog: [
      { ...common, id: 'native', sourceType: 'FILE', sourceId: 'equipamentos:2', code: 'UFI 008', name: 'UFI antiga', categoryName: 'Unidades de Filtragem' },
      { ...common, id: 'legacy', sourceType: 'UNIT', code: 'UFI008', name: 'UFI antiga', categoryName: 'Unidade de filtragem', isActive: false },
      { ...common, id: 'canonical', sourceType: 'EQUIPAMENTOS', sourceId: 'equipment', code: 'UFI008', name: 'Unidade de filtragem 8', categoryName: 'Unidades de filtragem' },
      { ...common, id: 'hose', sourceType: 'FILE', code: 'MGA006', name: 'Mangueira', categoryName: 'Mangueiras' },
      { ...common, id: 'stock', sourceType: 'STOCK', code: 'QUI001', name: 'Produto', categoryName: 'Produtos Químicos' }
    ],
    equipment: [{ id: 'equipment', code: 'UFI008', isActive: true, category: { name: 'Unidades de filtragem', syncToRomaneio: true } }],
    items: [
      { id: 'out', romaneioId: 'outbound', catalogItemId: 'native', quantity: '1.000', itemName: 'Nome histórico' },
      { id: 'in', romaneioId: 'inbound', catalogItemId: 'legacy', quantity: '1.000', itemName: 'Nome histórico' },
      { id: 'material', romaneioId: 'outbound', catalogItemId: 'hose', quantity: '50.000' }
    ],
    checklists: [{ id: 'check', romaneioId: 'outbound', catalogItemId: 'native', equipmentId: 'old-unit', items: [{ text: 'Inspeção', status: 'CONFORME' }] }],
    drafts: [{ id: 'draft', payload: {
      __module: 'romaneio', selectedItems: [{ key: 'catalog:native', catalogItemId: 'native', quantity: 1 }],
      quantities: { native: '2', 'extra:native': '' },
      checklistStatuses: { native: { Inspeção: 'NAO_CONFORME' } }, checklistSignatureImage: 'data:image/png;base64,unchanged'
    } }]
  };
}

test('migra saídas, entradas, checklists e rascunhos para o mesmo equipamento; preserva materiais e snapshots', () => {
  const data = fixture();
  const before = structuredClone(data);
  const plan = buildConsolidationPlan(data);
  assert.deepEqual(plan.blockers, []);
  assert.deepEqual(plan.retirementIds, ['native', 'legacy']);
  assert.deepEqual(plan.itemUpdates, [{ id: 'out', catalogItemId: 'canonical' }, { id: 'in', catalogItemId: 'canonical' }]);
  assert.deepEqual(plan.checklistUpdates, [{ id: 'check', catalogItemId: 'canonical', equipmentId: 'equipment' }]);
  assert.deepEqual(plan.draftUpdates[0].payload, {
    __module: 'romaneio', selectedItems: [{ key: 'catalog:canonical', catalogItemId: 'canonical', quantity: 1 }],
    quantities: { canonical: '2', 'extra:canonical': '' },
    checklistStatuses: { canonical: { Inspeção: 'NAO_CONFORME' } }, checklistSignatureImage: 'data:image/png;base64,unchanged'
  });
  assert.deepEqual(data, before);
});

test('aceita formatação do patrimônio, mas não troca prefixos nem usa códigos genéricos', () => {
  assert.equal(normalizeAssetCode(' uto 01 '), normalizeAssetCode('UTO001'));
  assert.notEqual(normalizeAssetCode('CTG001'), normalizeAssetCode('UCT001'));
  assert.equal(normalizeAssetCode('ENL'), null);
  assert.equal(normalizeAssetCode(null), null);
});

test('bloqueia item em uso sem destino ou com patrimônio ambíguo', () => {
  const missing = fixture();
  missing.catalog[0].code = 'UFI999';
  assert.ok(buildConsolidationPlan(missing).blockers.some(row => row.id === 'native'));
  const ambiguous = fixture();
  ambiguous.catalog.push({ ...ambiguous.catalog[2], id: 'second', sourceId: 'second-equipment' });
  ambiguous.equipment.push({ ...ambiguous.equipment[0], id: 'second-equipment' });
  assert.equal(buildConsolidationPlan(ambiguous).blockers.length, 2);
});

test('não redireciona patrimônios entre categorias diferentes nem medidas incompatíveis', () => {
  const data = fixture();
  data.catalog[2].categoryName = 'Unidades de Flushing';
  assert.equal(buildConsolidationPlan(data).retirementIds.length, 0);
  data.catalog[2].categoryName = 'Unidades de filtragem';
  data.catalog[0].measureType = 'LENGTH';
  assert.ok(buildConsolidationPlan(data).blockers.some(row => row.id === 'native'));
});

test('remove categoria nativa equivalente sem uso mesmo com código antigo diferente; uso sem destino bloqueia', () => {
  const data = fixture();
  data.catalog.push({ ...data.catalog[0], id: 'ph', code: 'PHM001', categoryName: 'Phmetro' });
  data.catalog.push({ ...data.catalog[2], id: 'ph-module', sourceId: 'ph-equipment', code: 'MPH001', categoryName: 'pHmetros' });
  data.equipment.push({ ...data.equipment[0], id: 'ph-equipment', code: 'MPH001', category: { name: 'pHmetros', syncToRomaneio: true } });
  assert.ok(buildConsolidationPlan(data).retirementIds.includes('ph'));
  assert.ok(!buildConsolidationPlan(data).mappings.some(row => row.fromId === 'ph'));
  data.items.push({ id: 'ph-item', romaneioId: 'outbound', catalogItemId: 'ph' });
  assert.ok(buildConsolidationPlan(data).blockers.some(row => row.id === 'ph'));
});

test('não remove categoria sem equipamentos sincronizados ativos ou com sourceId órfão', () => {
  for (const modify of [
    data => { data.equipment[0].category.syncToRomaneio = false; },
    data => { data.catalog[2].sourceId = 'missing'; },
    data => { data.equipment[0].isActive = false; }
  ]) {
    const data = fixture();
    modify(data);
    assert.equal(buildConsolidationPlan(data).retirementIds.length, 0);
  }
});

test('colisão em rascunho bloqueia a migração em vez de perder valores ou respostas', () => {
  const data = fixture();
  data.drafts[0].payload.quantities.canonical = '3';
  const plan = buildConsolidationPlan(data);
  assert.ok(plan.blockers.some(row => row.id === 'draft' && row.reason.includes('Colisão')));
  assert.equal(plan.draftUpdates.length, 0);
  assert.deepEqual(rewriteDraftReferences({ native: '', canonical: '' }, new Map([['native', { id: 'canonical' }]])), { canonical: '' });
});

test('segunda execução não altera registros já migrados ou marcas de exclusão', () => {
  const data = fixture();
  const plan = buildConsolidationPlan(data);
  for (const row of data.catalog) if (plan.retirementIds.includes(row.id)) {
    row.isActive = false;
    row.hiddenInRomaneioAt = '2026-09-08T15:00:00.000Z';
  }
  for (const row of data.items) Object.assign(row, plan.itemUpdates.find(update => update.id === row.id));
  for (const row of data.checklists) Object.assign(row, plan.checklistUpdates.find(update => update.id === row.id));
  for (const row of data.drafts) Object.assign(row, plan.draftUpdates.find(update => update.id === row.id));
  const next = buildConsolidationPlan(data);
  assert.equal(next.retirementIds.length + next.itemUpdates.length + next.checklistUpdates.length + next.draftUpdates.length, 0);
  assert.deepEqual(next.blockers, []);
});

test('sincronização do arquivo mantém a exclusão lógica dos itens nativos migrados', async () => {
  const source = fixture().catalog[0];
  const existing = { ...source, isActive: false, hiddenInRomaneioAt: new Date('2026-09-08T15:00:00Z') };
  const { id: _id, hiddenInRomaneioAt: _hidden, ...seedRow } = source;
  const writes = [];
  await syncCatalogRows({ romaneioCatalogItem: {
    findMany: async () => [existing],
    createMany: async () => { throw new Error('Não deve recriar o item'); },
    update: async args => { writes.push(args.data); }
  } }, [{ ...seedRow, name: 'Descrição atualizada no arquivo' }]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].isActive, false);
  assert.equal(Object.hasOwn(writes[0], 'hiddenInRomaneioAt'), false);
});
