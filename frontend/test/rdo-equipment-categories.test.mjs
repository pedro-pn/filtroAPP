import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('combina categorias, preserva seleções e salva a escolha por campo de cada serviço', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const { resolveEquipmentSlot, equipmentCategoryPatch, retainSlotEquipment } = await server.ssrLoadModule('/src/utils/rdoEquipmentCategories.ts');
    const { buildReportServicePayload } = await server.ssrLoadModule('/src/utils/reportServicePayload.ts');
    const { legacyServiceData } = await server.ssrLoadModule('/src/pages/reportDetailServiceData.ts');
    const source = { key: 'limpeza.ulq', primaryIds: ['a', 'b'], secondaryIds: ['c'], categories: [], equipments: [
      { id: 'a1', code: 'A1', categoryId: 'a' }, { id: 'b1', code: 'B1', categoryId: 'b' },
      { id: 'c1', code: 'C1', categoryId: 'c' }, { id: 'c2', code: 'C2', categoryId: 'c', isActive: false },
      { id: 'x1', code: 'X1', categoryId: 'not-allowed' }
    ] };
    const ids = result => result.options.map(item => item.id);
    assert.deepEqual(ids(resolveEquipmentSlot(source, {}, [])), ['a1', 'b1'], 'principais continuam misturadas');
    assert.deepEqual(ids(resolveEquipmentSlot(source, equipmentCategoryPatch(source, {}, ['c']), [])), ['c1']);
    const patch = equipmentCategoryPatch(source, {}, ['a', 'c', 'not-allowed', 'c']);
    assert.deepEqual(patch.__equipmentSlotCategories, { 'limpeza.ulq': ['a', 'c'] });
    assert.deepEqual(ids(resolveEquipmentSlot(source, patch, [])), ['a1', 'c1']);
    assert.deepEqual(retainSlotEquipment(source, ['a', 'c'], ['a1', 'b1', 'c1']), ['a1', 'c1']);
    assert.deepEqual(ids(resolveEquipmentSlot(source, {}, ['a1', 'b1', 'c1'])), ['a1', 'b1', 'c1'], 'relatórios antigos não perdem equipamentos');
    assert.equal(resolveEquipmentSlot(undefined, {}, []), null, 'fallback legado');
    const data = { ...patch, ulq: ['a1', 'c1'], notes: 'Manter observação', __equipmentSlotCategories: { ...patch.__equipmentSlotCategories, 'outro.campo': ['z'] } };
    const payload = buildReportServicePayload({ type: 'limpeza', data });
    const reopened = legacyServiceData({ id: 'service', ...payload });
    assert.deepEqual(reopened.__equipmentSlotCategories, data.__equipmentSlotCategories);
    assert.deepEqual(reopened.ulq, ['a1', 'c1']);
    assert.deepEqual(ids(resolveEquipmentSlot(source, reopened, reopened.ulq)), ['a1', 'c1']);
    assert.equal(reopened.notes, 'Manter observação');
    const otherSlot = { ...source, key: 'pressao.uth', primaryIds: ['b'], secondaryIds: ['a'] };
    assert.deepEqual(ids(resolveEquipmentSlot(otherSlot, data, [])), ['b1'], 'campos independentes');
  } finally { await server.close(); }
});
