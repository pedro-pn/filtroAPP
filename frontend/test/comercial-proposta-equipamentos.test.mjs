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
let salvamento;

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
  salvamento = await server.ssrLoadModule('/src/pages/comercial/proposta/salvamento.ts');
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

test('renomear preserva quantidade, ordem e demais equipamentos sem mudar o catálogo', () => {
  const selecionados = ['3 × bomba pneumática', '1 unidade de limpeza química'];
  const resultado = mod.renomearEquipamento(selecionados, selecionados[0], '  Bomba de apoio  ');
  assert.equal(resultado.erro, undefined);
  assert.deepEqual(resultado.equipamentos, ['3 × Bomba de apoio', selecionados[1]]);
  assert.deepEqual(selecionados, ['3 × bomba pneumática', '1 unidade de limpeza química']);
  assert.ok(mod.equipamentosSugeridosPeloEscopo([{ title: 'Limpeza química' }])
    .includes('1 bomba pneumática'));
  assert.equal(mod.equipamentoComQuantidade(resultado.equipamentos[0], 2), '2 × Bomba de apoio');
});

test('a edição rejeita nomes vazios, repetidos e equipamentos que não estão selecionados', () => {
  const selecionados = ['2 × bomba pneumática', '1 centrífuga'];
  for (const [original, nome] of [
    [selecionados[0], '   '],
    [selecionados[0], 'CENTRIFUGA'],
    ['1 termovácuo', 'Bomba']
  ]) {
    const resultado = mod.renomearEquipamento(selecionados, original, nome);
    assert.ok(resultado.erro);
    assert.deepEqual(resultado.equipamentos, selecionados);
  }
  assert.equal(mod.renomearEquipamento(selecionados, selecionados[0], 'Bomba pneumática').erro, undefined);
});

test('nomes de equipamentos iniciados por números não perdem parte do nome ao alterar a quantidade', () => {
  const resultado = mod.renomearEquipamento(['3 × hidrojato'], '1 hidrojato', '20 000 psi - Hidrojato');
  assert.equal(resultado.equipamentos[0], '3 × 20 000 psi - Hidrojato');
  assert.equal(mod.descricaoDoEquipamento(resultado.equipamentos[0]), '20 000 psi - Hidrojato');
  assert.equal(mod.equipamentoComQuantidade(resultado.equipamentos[0], 1), '1 20 000 psi - Hidrojato');
});

test('o nome editado e a quantidade sobrevivem ao payload e à reabertura da proposta', () => {
  const subitens = mod.renomearEquipamento(['2 × bomba pneumática'], '1 bomba pneumática', 'Bomba auxiliar').equipamentos;
  const conteudo = {
    form: {}, codigo: '99991', orcamentista: 'Teste', modelo: 'padrao',
    itensEscopo: [], blocos: [], categorias: [], precos: [], incluirUnitario: true,
    servicosTecnicos: [], complementoRelatorios: '',
    responsabilidades: [{ item: 'Equipamentos', owner: 'Filtrovali', subitens }]
  };
  const entrada = salvamento.entradaDaProposta(conteudo, '');
  const reaberto = salvamento.snapshotDaPropostaSalva(JSON.parse(JSON.stringify(entrada)));
  assert.deepEqual(reaberto.rows[0].subitens, ['2 × Bomba auxiliar']);
  assert.deepEqual(salvamento.dadosDaProposta(conteudo).rows[0].subitens, subitens);
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
  assert.match(html, /class="com-equipamento-nome"[^>]*aria-label="Nome do equipamento: bomba pneumática"[^>]*value="bomba pneumática"/);
  assert.doesNotMatch(html, />Editar nome<|>Salvar nome</);
});
