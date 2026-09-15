import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

let server;
let rolarParaInicioDoFormulario;
let parametrosDoLevantamentoAposAvanco;
let focarPrimeiroCampoInvalido;

test.before(async () => {
  server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom'
  });
  ({
    rolarParaInicioDoFormulario,
    parametrosDoLevantamentoAposAvanco,
    focarPrimeiroCampoInvalido
  } = await server.ssrLoadModule('/src/pages/comercial/navegacao.ts'));
});

test.after(async () => {
  await server?.close();
});

test('avançar leva o início do formulário para a área visível', () => {
  const chamadas = [];
  const elemento = {
    scrollIntoView: opcoes => chamadas.push(opcoes)
  };

  rolarParaInicioDoFormulario(elemento);

  assert.deepEqual(chamadas, [{ behavior: 'smooth', block: 'start' }]);
});

test('navegação não quebra quando o formulário ainda não montou', () => {
  assert.doesNotThrow(() => rolarParaInicioDoFormulario(null));
});

test('uma invalidação foca o primeiro controle pendente e o mantém visível', () => {
  const chamadas = [];
  const controle = {
    focus: opcoes => chamadas.push(['focus', opcoes])
  };
  const grupoInvalido = {
    matches: () => false,
    querySelector: () => controle,
    scrollIntoView: opcoes => chamadas.push(['scroll', opcoes])
  };
  const raiz = {
    querySelector: () => grupoInvalido
  };

  assert.equal(focarPrimeiroCampoInvalido(raiz), true);
  assert.deepEqual(chamadas, [
    ['focus', { preventScroll: true }],
    ['scroll', { behavior: 'smooth', block: 'center' }]
  ]);
});

test('não tenta focar quando a seção não tem campo inválido', () => {
  assert.equal(focarPrimeiroCampoInvalido({ querySelector: () => null }), false);
});

test('abre a jornada fechada antes de focar o campo pendente', () => {
  const detalhes = { tagName: 'DETAILS', open: false, parentElement: null };
  const controle = {
    parentElement: detalhes,
    matches: () => true,
    focus: () => assert.equal(detalhes.open, true),
    scrollIntoView: () => {}
  };
  assert.equal(focarPrimeiroCampoInvalido({ querySelector: () => controle }), true);
});

test('expande fase minimizada e só depois foca o campo, preservando seu conteúdo', () => {
  const anterior = globalThis.window;
  const chamadas = [];
  const quadros = [];
  globalThis.window = { requestAnimationFrame: callback => quadros.push(callback) };
  try {
    const fase = { tagName: 'DIV', id: 'fase-1', hidden: true, parentElement: null };
    const controle = {
      parentElement: fase, matches: () => true,
      focus: () => { assert.equal(fase.hidden, false); chamadas.push('foco'); },
      scrollIntoView: () => chamadas.push('rolagem')
    };
    const botao = {
      getAttribute: nome => nome === 'aria-controls' ? 'fase-1' : 'false',
      click: () => { chamadas.push('abrir'); fase.hidden = false; }
    };
    focarPrimeiroCampoInvalido({ querySelector: () => controle, querySelectorAll: () => [botao] });
    assert.deepEqual(chamadas, ['abrir']);
    quadros[0]();
    assert.deepEqual(chamadas, ['abrir', 'foco', 'rolagem']);
  } finally {
    globalThis.window = anterior;
  }
});

test('pendência sem controle editável leva à explicação em vez de deixar o clique sem resposta', () => {
  let focado = false;
  const resumo = {
    matches: () => false, querySelector: () => null,
    focus: () => { focado = true; }, scrollIntoView: () => {}
  };
  assert.equal(focarPrimeiroCampoInvalido({
    querySelector: seletor => seletor === '[data-custo-pendencias]' ? resumo : null
  }), true);
  assert.equal(focado, true);
});

test('o primeiro avanço preserva no endereço o id do rascunho recém-criado', () => {
  const atuais = new URLSearchParams('modo=new&secao=premises');

  const proximos = parametrosDoLevantamentoAposAvanco(
    atuais,
    'labor',
    'levantamento-1'
  );

  assert.equal(proximos.get('secao'), 'labor');
  assert.equal(proximos.get('id'), 'levantamento-1');
});
