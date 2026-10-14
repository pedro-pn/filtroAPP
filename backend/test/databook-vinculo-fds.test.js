import assert from 'node:assert/strict';
import test from 'node:test';

import { salvarVinculosFds, sugerirFds, vincularProduto } from '../src/lib/databook/anexos.js';
import { vinculosFdsDasEdicoes } from '../src/lib/databook/service.js';

const item = (id, name, extra = {}) => ({ id, name, fdsSynonyms: [], documents: [{ id: `doc-${id}` }], ...extra });

const ITENS = [
  item('acido', 'ÁCIDO CÍTRICO ANIDRO 25KG'),
  item('sulfamico', 'Ácido Sulfâmico'),
  item('meta', 'Metassilicato de Sódio Pentahidratado'),
  item('koh', 'Hidróxido de Potássio'),
  item('naoh', 'Hidróxido de Sódio Escamas 98%', { documents: [] }),
  item('naoh2', 'Hidróxido de Sódio Líquido 50%')
];

test('nome diferente do Estoque: vincula sozinho ao item mais parecido quando ele se destaca', () => {
  const r = vincularProduto('Ácido cítrico', ITENS);
  assert.equal(r.vinculo, 'aproximado');
  assert.equal(r.item.id, 'acido');
  // erro de grafia comum nos relatórios
  assert.equal(vincularProduto('Metasilicato de sódio', ITENS).item.id, 'meta');
});

test('sinônimo ou nome igual continua vínculo exato', () => {
  const r = vincularProduto('Soda cáustica', [...ITENS, item('soda', 'Soda Cáustica')]);
  assert.equal(r.vinculo, 'exato');
  assert.equal(vincularProduto('Hidróxido de amônio', [item('x', 'Amônia', { fdsSynonyms: ['Hidróxido de amônio'] })]).item.id, 'x');
});

test('dois itens igualmente parecidos: fica em dúvida, com opções para o diálogo', () => {
  const r = vincularProduto('Hidróxido de sódio', ITENS);
  assert.equal(r.vinculo, 'duvida');
  assert.equal(r.item, null);
  assert.deepEqual(r.opcoes.slice(0, 2).map(o => o.stockItemId).sort(), ['naoh', 'naoh2']);
  assert.ok(r.opcoes.some(o => o.stockItemId === 'koh'));
});

test('empate desfeito pelo romaneio do projeto', () => {
  const r = vincularProduto('Hidróxido de sódio', ITENS, new Set(['naoh2']));
  assert.equal(r.vinculo, 'aproximado');
  assert.equal(r.item.id, 'naoh2');
});

test('sem nada parecido: nenhum vínculo', () => {
  assert.equal(vincularProduto('Nitrito de sódio', [item('a', 'Ácido Cítrico')]).vinculo, 'nenhum');
});

function clienteFalso(itens = ITENS) {
  const updates = [];
  return {
    updates,
    stockItem: {
      findMany: async ({ where }) => (where.id ? itens.filter(i => where.id.in.includes(i.id)) : itens),
      update: async args => updates.push(args)
    },
    stockMovement: { findMany: async () => [] },
    romaneioItem: { findMany: async () => [] }
  };
}

test('sugerirFds: vínculo escolhido no diálogo vale sobre a sugestão e anexa a FDS', async () => {
  const etapas = [{ etapa: 'Desengraxe', produto: 'Hidróxido de sódio' }, { etapa: 'Fase ácida', produto: 'Ácido cítrico' }];
  const auto = await sugerirFds(clienteFalso(), { id: 'p1' }, etapas);
  assert.deepEqual(auto.selecionadas.map(f => f.arquivo), ['stockdoc:doc-acido']);
  assert.ok(auto.avisos.some(a => a.includes('Hidróxido de sódio') && a.includes('escolha o vínculo')));
  assert.ok(auto.avisos.some(a => a.includes('por semelhança')));
  assert.equal(auto.estoque.length, ITENS.length);

  const manual = await sugerirFds(clienteFalso(), { id: 'p1' }, etapas, { 'Hidróxido de sódio': 'naoh2', 'Ácido cítrico': '' });
  assert.deepEqual(manual.selecionadas.map(f => [f.produto, f.arquivo, f.etapa]), [['Hidróxido de sódio', 'stockdoc:doc-naoh2', 'Desengraxe']]);
  assert.equal(manual.candidatas.find(c => c.produto === 'Hidróxido de sódio').vinculo, 'manual');
  await assert.rejects(sugerirFds(clienteFalso(), { id: 'p1' }, etapas, { 'Ácido cítrico': 'inexistente' }), /não encontrado/);
});

test('vínculo escolhido vira sinônimo de FDS no Estoque (sem duplicar)', async () => {
  const client = clienteFalso([item('naoh2', 'Hidróxido de Sódio Líquido 50%', { fdsSynonyms: ['Soda líquida'] })]);
  await salvarVinculosFds(client, { 'Hidróxido de sódio': 'naoh2', 'Soda Líquida': 'naoh2', 'Outro': '' });
  assert.deepEqual(client.updates, [{ where: { id: 'naoh2' }, data: { fdsSynonyms: ['Soda líquida', 'Hidróxido de sódio'] } }]);
});

test('vinculos_fds das edições: só pares texto → texto', () => {
  assert.deepEqual(vinculosFdsDasEdicoes({ vinculos_fds: { A: ' x ', B: 3, '': 'y', C: '' } }), { A: 'x', C: '' });
  assert.deepEqual(vinculosFdsDasEdicoes({ vinculos_fds: ['x'] }), {});
});
