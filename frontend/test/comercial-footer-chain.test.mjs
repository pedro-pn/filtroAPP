import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

/**
 * O rodapé-guia do levantamento (tarefa T044).
 *
 * O que precisa ser verificável: o avanço acompanha a etapa atual e, no
 * resumo, a CADEIA de correção mantém uma ordem fixa. Com mão de obra e
 * logística pendentes ao mesmo tempo, mandar para logística primeiro faria o
 * usuário refazer o trabalho, porque a logística depende da equipe
 * dimensionada.
 *
 * As mensagens são as da referência ao pé da letra. Mudá-las é divergência,
 * não melhoria — e o aceite lado a lado (T113) compara texto por texto.
 */

let server;
let footerAction;
let chainSummary;
let saveBlockedByContent;
let deveRevelarErrosAoAcionar;

test.before(async () => {
  server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom'
  });
  ({
    footerAction,
    chainSummary,
    saveBlockedByContent,
    deveRevelarErrosAoAcionar
  } = await server.ssrLoadModule(
    '/src/pages/comercial/custos/footerChain.ts'
  ));
});

test.after(async () => {
  await server?.close();
});

const nadaPendente = { labor: false, inputs: false, logistics: false, commercial: false };
const podeSalvar = { saving: false, title: 'Limpeza química', validPricing: true, salePrice: 38139.33 };

test('mão de obra pendente manda para mão de obra', () => {
  const acao = footerAction({ ...nadaPendente, labor: true }, podeSalvar);
  assert.equal(acao.kind, 'goto');
  assert.equal(acao.label, 'Preencher itens obrigatórios da mão de obra →');
  assert.equal(acao.target, 'labor');
});

test('a ORDEM da cadeia é fixa: mão de obra vence logística', () => {
  // Se um dia isto inverter, o usuário dimensiona a logística antes de ter a
  // equipe definida — e refaz.
  const acao = footerAction(
    { ...nadaPendente, labor: true, logistics: true, inputs: true, commercial: true },
    podeSalvar
  );
  assert.equal(acao.target, 'labor');
});

test('durante o levantamento, texto e destino indicam sempre a próxima etapa', () => {
  const logisticaPendente = { ...nadaPendente, logistics: true, commercial: true };
  const casos = [
    ['premises', 'labor', 'Salvar e ir para Mão de obra →', logisticaPendente],
    ['labor', 'inputs', 'Salvar e ir para Materiais e insumos →', logisticaPendente],
    ['inputs', 'logistics', 'Salvar e ir para Logística →', logisticaPendente],
    ['logistics', 'summary', 'Salvar e ir para Resumo e QQP →', nadaPendente]
  ];

  for (const [atual, target, label, pendencias] of casos) {
    const acao = footerAction(pendencias, podeSalvar, atual);
    assert.equal(acao.target, target, atual);
    assert.equal(acao.label, label, atual);
  }
});

test('a pendência da etapa atual precisa ser corrigida antes do avanço', () => {
  const acao = footerAction({ ...nadaPendente, labor: true }, podeSalvar, 'labor');
  assert.equal(acao.target, 'labor');
  assert.equal(acao.label, 'Corrigir pendências de Mão de obra');
});

test('o texto informa quando a pendência manda voltar, em vez de fingir avanço', () => {
  const voltando = footerAction(
    { ...nadaPendente, labor: true },
    podeSalvar,
    'summary'
  );
  assert.equal(voltando.target, 'labor');
  assert.equal(voltando.label, 'Voltar para Mão de obra e corrigir pendências ←');

  const adiante = footerAction(
    { ...nadaPendente, inputs: true },
    podeSalvar,
    'labor'
  );
  assert.equal(adiante.target, 'inputs');
  assert.equal(adiante.label, 'Salvar e ir para Materiais e insumos →');
});

test('sem mão de obra pendente, insumos vêm antes de logística', () => {
  const acao = footerAction(
    { ...nadaPendente, inputs: true, logistics: true, commercial: true },
    podeSalvar
  );
  assert.equal(acao.label, 'Revisar materiais e insumos →');
  assert.equal(acao.target, 'inputs');
});

test('logística vem antes de comissões', () => {
  const acao = footerAction({ ...nadaPendente, logistics: true, commercial: true }, podeSalvar);
  assert.equal(acao.label, 'Preencher mobilização e desmobilização →');
  assert.equal(acao.target, 'logistics');
});

test('comissões pendentes mandam para o RESUMO, não para uma seção própria', () => {
  // Comissão e indicação vivem na seção "Resumo e QQP". Mandar para uma seção
  // inexistente deixaria o botão sem destino.
  const acao = footerAction({ ...nadaPendente, commercial: true }, podeSalvar);
  assert.equal(acao.label, 'Completar comissões e indicações →');
  assert.equal(acao.target, 'summary');
});

test('o botão de atalho NUNCA fica desabilitado', () => {
  // Ele é um caminho para resolver, não uma trava. Desabilitar esconderia o
  // caminho justamente de quem está perdido.
  for (const chave of ['labor', 'inputs', 'logistics', 'commercial']) {
    const acao = footerAction(
      { ...nadaPendente, [chave]: true },
      { saving: true, title: '', validPricing: false, salePrice: 0 }
    );
    assert.equal(acao.disabled, false, `o atalho de ${chave} não pode vir desabilitado`);
  }
});

test('sem pendências, o botão vira salvar', () => {
  const acao = footerAction(nadaPendente, podeSalvar);
  assert.equal(acao.kind, 'save');
  assert.equal(acao.label, 'Finalizar e criar proposta');
  assert.equal(acao.disabled, false);
});

test('pendência de conteúdo mantém salvar clicável para revelar os erros', () => {
  const semTitulo = footerAction(nadaPendente, { ...podeSalvar, title: '   ' });
  assert.equal(semTitulo.disabled, false, 'o clique precisa conseguir revelar o título vazio');
  assert.equal(saveBlockedByContent({ ...podeSalvar, title: '   ' }), true);

  const semPreco = footerAction(nadaPendente, { ...podeSalvar, salePrice: 0 });
  assert.equal(semPreco.disabled, false, 'o clique precisa conseguir levar ao preço inválido');

  const precoNegativo = footerAction(nadaPendente, { ...podeSalvar, salePrice: -1 });
  assert.equal(precoNegativo.disabled, false);

  const precificacaoInvalida = footerAction(nadaPendente, { ...podeSalvar, validPricing: false });
  assert.equal(precificacaoInvalida.disabled, false);
});

test('durante o salvamento o texto muda e o botão trava', () => {
  const acao = footerAction(nadaPendente, { ...podeSalvar, saving: true });
  assert.equal(acao.label, 'Salvando...');
  assert.equal(acao.disabled, true, 'salvar duas vezes criaria dois levantamentos');
});

test('a cadeia em texto serve ao roteiro do tutorial', () => {
  // É o roteiro do L4: o app já conhece o caminho, o tutorial só o narra.
  assert.deepEqual(chainSummary(), [
    'Preencher itens obrigatórios da mão de obra →',
    'Revisar materiais e insumos →',
    'Preencher mobilização e desmobilização →',
    'Completar comissões e indicações →',
    'Finalizar e criar proposta'
  ]);
});

test('o resumo oferece salvar ou salvar e criar proposta', () => {
  const pagina = readFileSync(
    new URL('../src/pages/comercial/custos/CustosPage.tsx', import.meta.url),
    'utf8'
  );
  assert.match(pagina, /secao === 'summary'/);
  assert.match(pagina, /concluirLevantamento\(false\)/);
  assert.match(pagina, /'Salvar'/);
  assert.match(pagina, /Finalizar e criar proposta/);
  assert.doesNotMatch(
    pagina.match(/secao === 'summary'[\s\S]*?<\/footer>/)?.[0] || '',
    /mobiliza[cç][aã]o e desmobiliza[cç][aã]o/i
  );
});

// ---------------------------------------------------------------------------
// Quando o vermelho pode aparecer
// ---------------------------------------------------------------------------

test('"Salvando..." não é falta de nada', () => {
  // A tela acende os campos obrigatórios quando o salvamento está travado pelo
  // CONTEÚDO. Estar no meio de um salvamento não é falta de campo nenhum, e
  // acender por causa disso pintaria a tela no pior momento possível.
  assert.equal(saveBlockedByContent({ ...podeSalvar, saving: true }), false);
  assert.equal(footerAction(nadaPendente, { ...podeSalvar, saving: true }).disabled, true);
});

test('título vazio trava o salvamento pelo conteúdo', () => {
  assert.equal(saveBlockedByContent({ ...podeSalvar, title: '   ' }), true);
  assert.equal(saveBlockedByContent({ ...podeSalvar, validPricing: false }), true);
  assert.equal(saveBlockedByContent({ ...podeSalvar, salePrice: 0 }), true);
  assert.equal(saveBlockedByContent(podeSalvar), false);
});

test('um levantamento recém-aberto não acende nada sozinho', () => {
  // A REGRESSÃO que este teste existe para impedir: o levantamento abre com a
  // condição de trabalho por confirmar, o que é legítimo e esperado. Se nesse
  // estado a cadeia já apontasse para "salvar", a tela acenderia quarenta
  // campos que o usuário ainda não viu. Ela aponta para mão de obra.
  const acao = footerAction({ ...nadaPendente, labor: true }, podeSalvar);
  assert.equal(acao.kind, 'goto');
  assert.notEqual(acao.kind, 'save');
});

test('abrir a próxima seção não revela erros antes de tentar preenchê-la', () => {
  const irParaMaoDeObra = footerAction(
    { ...nadaPendente, labor: true },
    podeSalvar,
    'premises'
  );
  assert.equal(deveRevelarErrosAoAcionar(irParaMaoDeObra, 'premises'), false);
  assert.equal(deveRevelarErrosAoAcionar(irParaMaoDeObra, 'labor'), true);
  assert.equal(deveRevelarErrosAoAcionar(irParaMaoDeObra, 'summary', true), true);
  assert.equal(deveRevelarErrosAoAcionar(irParaMaoDeObra, 'summary', false), true,
    'Salvar no resumo também deve revelar a pendência ao retornar à mão de obra');

  const salvar = footerAction(nadaPendente, podeSalvar, 'summary');
  assert.equal(deveRevelarErrosAoAcionar(salvar, 'summary'), true);
});
