/**
 * Arrastar para reordenar nas listas do módulo — T068–T071.
 *
 * O utilitário `utils/reorderDrag.ts` foi auditado na T001 e aprovado, mas ele
 * é um kit: a auditoria listou **três peças que ele não dá** — alça com
 * `aria-label`, placeholder e cancelamento que restaura. `useReordenacao` é
 * essas três peças, e é o que este arquivo cobre em cada lista.
 *
 * O foco é o **cancelamento**, porque é a única parte que erra em silêncio:
 * arrastar move a lista à vista, e um placeholder que não aparece se nota na
 * hora. Já um cancelamento que não restaura deixa a proposta com os serviços em
 * ordem trocada, e ninguém percebe até o documento sair.
 *
 * Os handlers são exercitados direto, sem montar React: eles são funções puras
 * sobre refs, e o que interessa provar é a decisão, não o render.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

let server;
let utils;

test.before(async () => {
  server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom'
  });
  utils = await server.ssrLoadModule('/src/utils/reorderDrag.ts');
});

test.after(async () => {
  await server?.close();
});

const itens = [
  { id: 'a', nome: 'Flushing primário' },
  { id: 'b', nome: 'Limpeza química' },
  { id: 'c', nome: 'Teste hidrostático' }
];

const ids = lista => lista.map(item => item.id);

test('reordenar move o item para a posição do alvo, não troca os dois', () => {
  // Trocar (swap) e mover (splice) coincidem com dois itens e divergem com três:
  // arrastar A sobre C deve dar B, C, A — não C, B, A.
  const resultado = utils.reorderRowsById(itens, 'a', 'c', item => item.id);
  assert.deepEqual(ids(resultado), ['b', 'c', 'a']);
});

test('arrastar sobre si mesmo devolve a MESMA lista, não uma cópia', () => {
  // A identidade importa: `useReordenacao` compara por referência para decidir
  // se avisa o formulário. Uma cópia nova a cada `dragover` faria a proposta
  // re-renderizar dezenas de vezes por segundo durante o arrasto.
  const resultado = utils.reorderRowsById(itens, 'b', 'b', item => item.id);
  assert.equal(resultado, itens);
});

test('id que não está na lista não reordena nada', () => {
  // Acontece de verdade: `elementFromPoint` pode cair num cartão de outra lista
  // da mesma tela — os blocos de conteúdo vivem dentro do cartão do serviço.
  assert.equal(utils.reorderRowsById(itens, 'a', 'zzz', item => item.id), itens);
  assert.equal(utils.reorderRowsById(itens, 'zzz', 'a', item => item.id), itens);
});

test('sameStringOrder distingue ordem diferente de conteúdo diferente', () => {
  assert.equal(utils.sameStringOrder(['a', 'b'], ['a', 'b']), true);
  assert.equal(utils.sameStringOrder(['a', 'b'], ['b', 'a']), false);
  assert.equal(utils.sameStringOrder(['a'], ['a', 'b']), false);
});

/* ------------------------------------------------------------------------- *
 * A sessão de arrasto — o cancelamento, que é o que erra em silêncio.
 * ------------------------------------------------------------------------- */

async function sessao() {
  return server.ssrLoadModule('/src/pages/comercial/proposta/sessaoDeArrasto.ts');
}

test('cancelar devolve a ordem do INÍCIO do arrasto, não a de um passo atrás', async () => {
  // O caso que um "desfazer" ingênuo erraria: o arrasto passa por várias
  // posições antes de ser cancelado, e voltar um passo deixaria a lista numa
  // ordem que o vendedor nunca escolheu.
  const s = await sessao();
  const idDe = item => item.id;

  const aberta = s.comecarArrasto(itens, 'a');
  let atual = s.moverNoArrasto(aberta, itens, 'b', idDe);
  atual = s.moverNoArrasto(aberta, atual, 'c', idDe);
  assert.notDeepEqual(ids(atual), ids(itens), 'o arrasto precisa ter mexido');

  assert.deepEqual(ids(s.encerrarArrasto(aberta, atual, false)), ['a', 'b', 'c']);
});

test('soltar mantém a ordem construída durante o arrasto', async () => {
  const s = await sessao();
  const aberta = s.comecarArrasto(itens, 'c');
  const atual = s.moverNoArrasto(aberta, itens, 'a', item => item.id);

  assert.deepEqual(ids(atual), ['c', 'a', 'b']);
  assert.deepEqual(ids(s.encerrarArrasto(aberta, atual, true)), ['c', 'a', 'b']);
});

test('cancelar restaura a MESMA referência de lista, não uma cópia igual', async () => {
  // Devolver cópia faria o formulário se dar por alterado a cada arrasto
  // cancelado — e o rascunho seria salvo sem nada ter mudado.
  const s = await sessao();
  const aberta = s.comecarArrasto(itens, 'a');
  const atual = s.moverNoArrasto(aberta, itens, 'c', item => item.id);

  assert.equal(s.encerrarArrasto(aberta, atual, false), itens);
});

test('sem sessão, encerrar não mexe em nada', async () => {
  // `dragend` chega mesmo quando o arrasto nunca começou de verdade — arrastar
  // a partir de um campo de texto dentro do cartão, por exemplo.
  const s = await sessao();

  assert.equal(s.encerrarArrasto(null, itens, false), itens);
  assert.equal(s.encerrarArrasto(null, itens, true), itens);
  assert.equal(s.moverNoArrasto(null, itens, 'b', item => item.id), itens);
});

/* ------------------------------------------------------------------------- *
 * As três peças que a auditoria pediu, nas listas reordenáveis.
 * ------------------------------------------------------------------------- */

test('a alça descreve O QUE se move, não apenas "arrastar"', async () => {
  // Seis alças anunciadas como "Arrastar para reordenar" não dizem a um leitor
  // de tela qual é qual. O rótulo entra no `aria-label` por isso.
  const fonte = await server
    .transformRequest('/src/pages/comercial/proposta/useReordenacao.ts')
    .then(r => r.code);

  assert.match(fonte, /Arrastar \$\{rotulo\} para reordenar/);
});

test('o cancelamento por Escape está tratado, além do pointercancel', async () => {
  // A auditoria pediu os dois nominalmente: `QualityNaturesTab` trata
  // `pointercancel` e não trata `Escape`, e quem usa as setas ↑/↓ — que
  // continuam ali, desvio nº 6 — é quem vai tentar `Escape` no arrasto.
  const fonte = await server
    .transformRequest('/src/pages/comercial/proposta/useReordenacao.ts')
    .then(r => r.code);

  assert.match(fonte, /Escape/);
  assert.match(fonte, /onPointerCancel/);
  assert.match(fonte, /restaurar\(\)/);
});

test('as quatro listas passam pelo mesmo hook', async () => {
  const passos = [
    '/src/pages/comercial/proposta/steps/EscopoStep.tsx',
    '/src/pages/comercial/proposta/steps/TecnicaStep.tsx',
    '/src/pages/comercial/proposta/steps/ScopeContentEditor.tsx',
    '/src/pages/comercial/proposta/steps/ResponsabilidadesStep.tsx'
  ];

  for (const passo of passos) {
    const fonte = await server.transformRequest(passo).then(r => r.code);
    assert.match(fonte, /useReordenacao/, `${passo} deveria usar o hook`);
    assert.match(fonte, /propsDaAlca/, `${passo} deveria montar a alça`);
    assert.match(fonte, /drag-placeholder/, `${passo} deveria marcar o destino`);
  }
});

test('as setas ↑/↓ continuam nas quatro listas — desvio nº 6', async () => {
  // Arrastar é ACRÉSCIMO. Remover as setas tiraria o caminho de teclado, e a
  // regra de aceite do porte é que nenhum controle da referência desaparece.
  const passos = [
    ['/src/pages/comercial/proposta/steps/EscopoStep.tsx', /Mover serviço \$\{indice \+ 1\} para cima/],
    ['/src/pages/comercial/proposta/steps/TecnicaStep.tsx', /Mover serviço para cima/],
    ['/src/pages/comercial/proposta/steps/ScopeContentEditor.tsx', /Mover conteúdo para cima/],
    ['/src/pages/comercial/proposta/steps/ResponsabilidadesStep.tsx', /Mover responsabilidade \$\{indice \+ 1\} para cima/]
  ];

  for (const [passo, esperado] of passos) {
    const fonte = await server.transformRequest(passo).then(r => r.code);
    assert.match(fonte, esperado, `${passo} perdeu a seta de subir`);
  }
});

test('a alça tem touch-action: none — sem isso o toque rola a página', async () => {
  // A T069 inteira mora nesta linha de CSS: sem ela o navegador entende o
  // primeiro movimento do dedo como rolagem, engole o `pointermove`, e o
  // arrasto não acontece no celular **sem erro nenhum**.
  const css = await server
    .transformRequest('/src/styles/comercial.css')
    .then(r => r.code);

  const bloco = css.slice(css.indexOf('.com-alca'), css.indexOf('.com-alca') + 600);
  assert.match(bloco, /touch-action:\s*none/);
});

test('cada lista declara o próprio placeholder — o do base.css é escopado', async () => {
  // `.drag-placeholder` sozinho não pinta nada: no `base.css` ele é sempre
  // `.classe-do-cartao.drag-placeholder`. Faltando a regra, o arrasto funciona
  // e o destino não aparece — defeito que só se vê arrastando.
  const css = await server
    .transformRequest('/src/styles/comercial.css')
    .then(r => r.code);

  for (const cartao of [
    'com-escopo-card',
    'com-tecnica-card',
    'com-bloco',
    'com-responsabilidade-linha'
  ]) {
    assert.match(
      css,
      new RegExp(`\\.${cartao}\\.drag-placeholder`),
      `${cartao} não tem placeholder`
    );
  }
  assert.match(css, /Soltar aqui/);
});

test('responsabilidades permitem acrescentar linha e arrastar com efeito fantasma', async () => {
  const fonte = await server
    .transformRequest('/src/pages/comercial/proposta/steps/ResponsabilidadesStep.tsx')
    .then(r => r.code);

  assert.match(fonte, /\+ Adicionar responsabilidade/);
  assert.match(fonte, /linhaVazia/);
  assert.match(fonte, /com-responsabilidade-linha/);
  assert.match(fonte, /propsDaLinha/);
  assert.match(fonte, /propsDaAlca/);
});
