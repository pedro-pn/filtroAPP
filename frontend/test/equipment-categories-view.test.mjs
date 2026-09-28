import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

async function loadView() {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom'
  });
  try {
    return await server.ssrLoadModule('/src/pages/equipamentos/equipmentCategoryView.ts');
  } finally {
    await server.close();
  }
}

test('links antigos de categoria abrem a aba unificada', async () => {
  const { equipmentTabFromParam, parseEquipmentTabParam } = await loadView();

  assert.equal(parseEquipmentTabParam('cat:categoria-1'), 'cat:categoria-1');
  assert.equal(equipmentTabFromParam('cat:categoria-1'), 'categories');
  assert.equal(equipmentTabFromParam('categories'), 'categories');
  assert.equal(parseEquipmentTabParam('cat:'), 'dashboard');
  assert.equal(parseEquipmentTabParam('inexistente'), 'dashboard');
});

test('busca abrange todas as categorias, códigos e atributos sem perder a ordenação', async () => {
  const { filterAndSortEquipment } = await loadView();
  const categories = [
    { id: 'bombas', name: 'Bombas' },
    { id: 'filtros', name: 'Filtros' }
  ];
  const equipment = [
    { id: '2', categoryId: 'bombas', code: 'B-20', name: 'Bomba auxiliar', attributes: { serie: 'SN-20' } },
    { id: '3', categoryId: 'filtros', code: 'F-10', name: 'Filtro principal', attributes: { serie: 'SN-10' } },
    { id: '1', categoryId: 'bombas', code: 'B-01', name: 'Bomba principal', attributes: { serie: 'SN-01' } }
  ];

  assert.deepEqual(filterAndSortEquipment(equipment, categories, 'BOMBAS', 'asc').map(item => item.code), ['B-01', 'B-20']);
  assert.deepEqual(filterAndSortEquipment(equipment, categories, 'sn-10', 'asc').map(item => item.code), ['F-10']);
  assert.deepEqual(filterAndSortEquipment(equipment, categories, '', 'desc').map(item => item.code), ['F-10', 'B-20', 'B-01']);
});
