import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let server;
let mod;
let servicos;
let EscopoStep;
let ResponsabilidadesStep;

test.before(async () => {
  server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom'
  });
  mod = await server.ssrLoadModule(
    '/src/pages/comercial/proposta/equipamentosDaProposta.ts'
  );
  servicos = await server.ssrLoadModule(
    '/src/pages/comercial/proposta/servicosDaProposta.ts'
  );
  ({ EscopoStep } = await server.ssrLoadModule(
    '/src/pages/comercial/proposta/steps/EscopoStep.tsx'
  ));
  ({ ResponsabilidadesStep } = await server.ssrLoadModule(
    '/src/pages/comercial/proposta/steps/ResponsabilidadesStep.tsx'
  ));
});

test.after(async () => {
  await server?.close();
});

test('flushing sugere as unidades primária e secundária', () => {
  const sugeridos = mod.equipamentosSugeridosPeloEscopo([
    { title: 'Serviço de flushing', description: 'Flushing do sistema hidráulico.' }
  ]);

  assert.deepEqual(sugeridos, [
    '1 unidade de flushing primário',
    '1 unidade de flushing secundário'
  ]);
});

test('serviços diferentes combinam sugestões sem duplicar equipamentos', () => {
  const sugeridos = mod.equipamentosSugeridosPeloEscopo([
    { title: 'Limpeza química e flushing', description: 'Com filtragem absoluta.' },
    { title: 'Novo flushing', description: '' }
  ]);

  assert.deepEqual(sugeridos, [
    '1 unidade de limpeza química',
    '1 bomba pneumática',
    '1 unidade de flushing primário',
    '1 unidade de filtragem absoluta/transferência',
    '1 unidade de flushing secundário'
  ]);
});

test('escopo sem regra conhecida não seleciona equipamento por conta própria', () => {
  assert.deepEqual(
    mod.equipamentosSugeridosPeloEscopo([
      { title: 'Inspeção visual', description: 'Verificação em campo.' }
    ]),
    []
  );
});

test('equipamento sugerido aceita quantidade e mantém a identidade do catálogo', () => {
  const catalogo = '1 unidade de limpeza química';
  const tresUnidades = mod.equipamentoComQuantidade(catalogo, 3);

  assert.equal(tresUnidades, '3 × unidade de limpeza química');
  assert.equal(mod.quantidadeDoEquipamento(tresUnidades), 3);
  assert.equal(mod.descricaoDoEquipamento(tresUnidades), 'unidade de limpeza química');
  assert.equal(mod.mesmoEquipamento(tresUnidades, catalogo), true);
  assert.equal(mod.equipamentoComQuantidade(tresUnidades, 1), catalogo);
});

test('a proposta oferece a lista pedida e preserva a opção de serviço livre', () => {
  assert.deepEqual([...servicos.SERVICOS_DA_PROPOSTA], [
    'Teste de pressão',
    'Limpeza química',
    'Flushing',
    'Filtragem',
    'Limpeza mecânica'
  ]);
  assert.equal(servicos.tituloDoNovoServico('Flushing', 2), 'Flushing');
  assert.equal(
    servicos.tituloDoNovoServico(servicos.VALOR_OUTRO_SERVICO, 2),
    'Serviço 3'
  );

  const html = renderToStaticMarkup(createElement(EscopoStep, {
    titulo: '',
    onTitulo: () => {},
    itens: [{ id: 'servico-1', title: '', description: '' }],
    onItens: () => {},
    blocos: [],
    onBlocos: () => {},
    erroDe: () => undefined
  }));
  for (const servico of servicos.SERVICOS_DA_PROPOSTA) {
    assert.match(html, new RegExp(`>${servico}<`));
  }
  assert.match(html, />Outro serviço</);
});

test('a tela mostra quantidade editável para cada equipamento selecionado', () => {
  const html = renderToStaticMarkup(createElement(ResponsabilidadesStep, {
    linhas: [{
      categoria: 'EQUIPAMENTOS E MATERIAIS',
      owner: 'Filtrovali',
      item: 'Equipamentos fornecidos pela Filtrovali',
      note: '',
      subitens: ['1 bomba pneumática']
    }],
    onLinhas: () => {},
    servicos: [{ title: 'Limpeza química', description: '' }],
    categorias: ['EQUIPAMENTOS E MATERIAIS'],
    onCategorias: () => {},
    erroDe: () => undefined,
    mostrarErros: false
  }));

  assert.match(html, /aria-label="Quantidade de bomba pneumática"/);
  assert.match(html, /type="number" min="1" step="1"[^>]*value="1"/);
});
