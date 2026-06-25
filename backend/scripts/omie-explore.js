/*
 * Descoberta da API Omie: puxa as primeiras páginas de alguns recursos e mostra a estrutura,
 * salvando o JSON completo em omie-<recurso>.json para inspeção.
 *
 * Uso (no servidor / local com credenciais):
 *   OMIE_APP_KEY=... OMIE_APP_SECRET=... npm run omie:explore
 *   OMIE_APP_KEY=... OMIE_APP_SECRET=... node scripts/omie-explore.js projetos
 *
 * Read-only (apenas chamadas Listar). Os nomes de "call" mais incertos estão marcados:
 * se o Omie devolver faultstring de método inexistente, ajuste o nome aqui.
 */

import { writeFileSync } from 'node:fs';

import { omieCall, omieConfigured } from '../src/lib/omie-client.js';

const PRESETS = [
  { name: 'projetos', path: '/geral/projetos/', call: 'ListarProjetos', param: { pagina: 1, registros_por_pagina: 50 } },
  { name: 'categorias', path: '/geral/categorias/', call: 'ListarCategorias', param: { pagina: 1, registros_por_pagina: 50 } },
  { name: 'contas-pagar', path: '/financas/contapagar/', call: 'ListarContasPagar', param: { pagina: 1, registros_por_pagina: 20, apenas_importado_api: 'N' } }
];

// Candidatos para o método de listagem de pedido de compra (convenção: IncluirPedCompra -> ListarPedCompra).
const PEDIDO_COMPRA_CALLS = ['ListarPedCompra', 'ListarPedidosCompra', 'PesquisarPedCompra', 'ListarPedidoCompra'];

// Testa se ListarContasPagar aceita filtro por codigo_projeto (decisivo p/ não varrer 40k+ títulos).
async function probeContasPagarFilter() {
  console.log('\n===== probe: contas a pagar filtradas por projeto =====');
  try {
    const base = await omieCall('/financas/contapagar/', 'ListarContasPagar', { pagina: 1, registros_por_pagina: 1 });
    const first = (base.conta_pagar_cadastro || [])[0];
    const codigoProjeto = first?.codigo_projeto;
    if (!codigoProjeto) { console.log('  sem codigo_projeto no 1º título; pulei.'); return; }
    console.log('  total geral:', base.total_de_registros, '· testando codigo_projeto =', codigoProjeto);
    const filtered = await omieCall('/financas/contapagar/', 'ListarContasPagar', { pagina: 1, registros_por_pagina: 5, codigo_projeto: codigoProjeto });
    console.log('  total filtrado por codigo_projeto:', filtered.total_de_registros);
    console.log(filtered.total_de_registros < base.total_de_registros
      ? '  => filtro por codigo_projeto FUNCIONA (podemos puxar por projeto).'
      : '  => filtro por codigo_projeto IGNORADO (precisa varrer por data e filtrar no app).');
  } catch (error) {
    console.log('  ERRO no probe:', error.message);
  }
}

async function probePedidoCompra() {
  console.log('\n===== pedidos-compra (testando nomes de método) =====');
  for (const call of PEDIDO_COMPRA_CALLS) {
    try {
      const json = await omieCall('/produtos/pedidocompra/', call, { pagina: 1, registros_por_pagina: 5 });
      console.log(`  OK com call "${call}".`);
      describe('pedidos-compra', json);
      const file = 'omie-pedidos-compra.json';
      const { writeFileSync: w } = await import('node:fs');
      w(file, JSON.stringify(json, null, 2));
      console.log(`  JSON salvo em ${file}`);
      return;
    } catch (error) {
      console.log(`  "${call}" -> ${error.message}`);
    }
  }
  console.log('  Nenhum nome funcionou; confirmar na doc do Omie.');
}

function preview(value, depth = 0) {
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (typeof value === 'object') return `{ ${Object.keys(value).slice(0, 8).join(', ')}${Object.keys(value).length > 8 ? ', …' : ''} }`;
  const s = String(value);
  return depth === 0 ? s : s.slice(0, 60);
}

function describe(name, json) {
  console.log(`\n===== ${name} =====`);
  console.log('Chaves de topo:', Object.keys(json).join(', '));
  for (const k of ['total_de_registros', 'total_de_paginas', 'pagina', 'registros']) {
    if (json[k] !== undefined) console.log(`  ${k}:`, json[k]);
  }
  // Acha o array de registros (maior array no topo) e mostra o 1º item.
  let recordsKey = null;
  let recordsLen = -1;
  for (const [k, v] of Object.entries(json)) {
    if (Array.isArray(v) && v.length > recordsLen) { recordsKey = k; recordsLen = v.length; }
  }
  if (recordsKey) {
    const first = json[recordsKey][0];
    console.log(`  registros em "${recordsKey}": ${recordsLen}`);
    if (first && typeof first === 'object') {
      console.log('  campos do 1º registro:');
      for (const [k, v] of Object.entries(first)) console.log(`    - ${k}: ${preview(v, 1)}`);
    }
  }
}

async function run(preset) {
  try {
    const json = await omieCall(preset.path, preset.call, preset.param);
    describe(preset.name, json);
    const file = `omie-${preset.name}.json`;
    writeFileSync(file, JSON.stringify(json, null, 2));
    console.log(`  JSON completo salvo em ${file}`);
  } catch (error) {
    console.log(`\n===== ${preset.name} =====`);
    console.log('  ERRO:', error.message);
    if (error.body) console.log('  detalhe:', JSON.stringify(error.body).slice(0, 300));
  }
}

async function main() {
  if (!omieConfigured()) {
    console.error('Defina OMIE_APP_KEY e OMIE_APP_SECRET no ambiente.');
    process.exit(1);
  }
  const only = process.argv[2];
  const presets = only ? PRESETS.filter(p => p.name === only) : PRESETS;
  if (only && presets.length === 0) {
    console.error(`Recurso "${only}" não encontrado. Opções: ${PRESETS.map(p => p.name).join(', ')}`);
    process.exit(1);
  }
  for (const preset of presets) {
    // eslint-disable-next-line no-await-in-loop
    await run(preset);
  }
  if (!only) {
    await probeContasPagarFilter();
    await probePedidoCompra();
  }
}

main().catch(error => { console.error(error); process.exit(1); });
