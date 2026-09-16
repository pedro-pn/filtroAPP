import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import {
  SCOPE_DESCRIPTION_TEMPLATES, createScopeDescriptionItem, scopeDescriptionParagraphs,
  createScopeTopic, scopeTopicsForItem, scopeItemWithTopics
} from '../../shared/comercial/dist/scope-descriptions.js';
import { normalizeScopeServiceItems } from '../../shared/comercial/dist/scope-content.js';

let server, EscopoStep, DocumentoPrevia, paginacao, salvamento;
test.before(async () => {
  server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  ({ EscopoStep } = await server.ssrLoadModule('/src/pages/comercial/proposta/steps/EscopoStep.tsx'));
  ({ DocumentoPrevia } = await server.ssrLoadModule('/src/pages/comercial/proposta/DocumentoPrevia.tsx'));
  paginacao = await server.ssrLoadModule('/src/pages/comercial/proposta/previaPaginacao.ts');
  salvamento = await server.ssrLoadModule('/src/pages/comercial/proposta/salvamento.ts');
});
test.after(async () => server?.close());

test('nove modelos completos e cópias editáveis independentes', () => {
  assert.equal(SCOPE_DESCRIPTION_TEMPLATES.length, 9);
  const item = createScopeDescriptionItem('a', 'pre-engenharia');
  assert.equal(item.subitems.length, 5);
  item.subitems.splice(0, 1, 'Novo detalhe');
  assert.match(createScopeDescriptionItem('b', 'pre-engenharia').subitems[0], /^Levantamento de dados/);
  const livre = createScopeDescriptionItem('c');
  assert.equal(livre.description, '');
  assert.equal(livre.format, 'paragraph');
});

test('numeração é posicional, com subitens e sem prefixo ou título duplicados', () => {
  const itens = SCOPE_DESCRIPTION_TEMPLATES.map(t => createScopeDescriptionItem(t.id, t.id));
  const paragrafos = scopeDescriptionParagraphs(itens);
  assert.deepEqual(paragrafos.map(p => p.number), [
    '2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7', '2.8', '2.9',
    '2.9.1', '2.9.2', '2.9.3', '2.9.4', '2.9.5'
  ]);
  assert.equal(paragrafos[0].text, itens[0].description);
  assert.equal(paragrafos[9].text, itens[8].subitems[0]);
  itens[8].subitems.splice(2, 1);
  const reordenados = scopeDescriptionParagraphs([itens[8], itens[0]]);
  assert.deepEqual(reordenados.map(p => p.number), ['2.1', '2.1.1', '2.1.2', '2.1.3', '2.1.4', '2.2']);
});

test('texto livre e colado é preservado; linhas vazias não criam itens fantasmas', () => {
  const itens = [{ ...createScopeDescriptionItem('livre'), description: 'Texto alterado\r\n\r\nOutro parágrafo\n', subitems: ['\n', 'Detalhe 1\nDetalhe 2'] }];
  assert.deepEqual(scopeDescriptionParagraphs(itens).map(p => [p.number, p.text]), [
    ['2.1', 'Texto alterado'], ['2.2', 'Outro parágrafo'], ['2.2.1', 'Detalhe 1'], ['2.2.2', 'Detalhe 2']
  ]);
  assert.deepEqual(scopeDescriptionParagraphs([createScopeDescriptionItem('vazio')]), []);
});

test('normalizar e reabrir conserva formato, edições e subitens', () => {
  const itens = [{ ...createScopeDescriptionItem('a', 'pre-engenharia'), description: 'Texto editado', subitems: ['Detalhe editado'] }];
  const conteudo = { form: {}, itensEscopo: itens, blocos: [], responsabilidades: [], categorias: [], servicosTecnicos: [], complementoRelatorios: '', precos: [], incluirUnitario: true };
  const payload = salvamento.dadosDaProposta(conteudo);
  assert.deepEqual(normalizeScopeServiceItems(JSON.parse(JSON.stringify(payload.scopeItems))), itens);
});

test('escopos legados preservam o texto sem acrescentar abertura nem repetir o título', () => {
  const legado = [{ id: 'custo', title: 'Limpeza química', description: 'Sistema contemplado: Circuito 1.' }];
  assert.equal(scopeDescriptionParagraphs(legado)[0].text, 'Sistema contemplado: Circuito 1.');
  assert.equal(scopeTopicsForItem(legado[0])[0].text, legado[0].description);
  assert.deepEqual(normalizeScopeServiceItems(legado), legado);
});

test('editor mostra um campo por texto/subitem e permite remover inclusive o último item', () => {
  const html = renderToStaticMarkup(createElement(EscopoStep, {
    titulo: '', onTitulo() {}, itens: [createScopeDescriptionItem('a', 'pre-engenharia')],
    onItens() {}, blocos: [], onBlocos() {}, erroDe() {}
  }));
  assert.match(html, /Texto do tópico 2\.1/);
  for (let i = 1; i <= 5; i++) assert.ok(html.includes(`Subitem 2.1.${i}`));
  assert.doesNotMatch(html, /Descrição completa|começará automaticamente/);
  assert.match(html, /Título do serviço 1/);
  assert.equal((html.match(/Texto padrão do tópico /g) || []).length, 6);
  assert.match(html, /aria-label="Remover serviço 1"(?![^>]*disabled)/);
  assert.match(html, /Adicionar subitem de 2\.1/);
});

test('vários tópicos do mesmo serviço e de outros serviços compartilham sequência com níveis livres', () => {
  const primeiro = {
    id: 's1', title: 'Limpeza química', description: '', topics: [
      { id: 't1', text: 'Primeiro texto.' },
      { id: 't2', text: 'Segundo texto.', children: [
        { id: 'sub1', text: 'Detalhe.', children: [{ id: 'subsub1', text: 'Detalhe específico.' }] },
        { id: 'sub2', text: 'Outro detalhe.' }
      ] }
    ]
  };
  const segundo = { id: 's2', title: 'Flushing', description: '', topics: [createScopeTopic('t3', 'flushing-secundario')] };
  const paragrafos = scopeDescriptionParagraphs([primeiro, segundo]);
  assert.deepEqual(paragrafos.map(p => p.number), ['2.1', '2.2', '2.2.1', '2.2.1.1', '2.2.2', '2.3']);
  assert.deepEqual(paragrafos.map(p => p.level), [1, 1, 2, 3, 2, 1]);
  const alterado = scopeItemWithTopics(primeiro, [primeiro.topics[1]]);
  assert.equal(alterado.id, 's1');
  assert.equal(alterado.title, primeiro.title);
  assert.deepEqual(scopeDescriptionParagraphs([alterado, segundo]).map(p => p.number), ['2.1', '2.1.1', '2.1.1.1', '2.1.2', '2.2']);
});

test('tópicos são persistidos e não ressuscitam a descrição antiga quando todos são removidos', () => {
  const item = { id: 's1', title: 'Serviço', description: 'Texto antigo', topics: [createScopeTopic('t1', 'pre-engenharia')] };
  item.topics[0].children[0].text = 'Detalhe editado';
  assert.deepEqual(normalizeScopeServiceItems(JSON.parse(JSON.stringify([item]))), [item]);
  assert.equal(scopeDescriptionParagraphs([item])[1].text, 'Detalhe editado');
  assert.deepEqual(scopeDescriptionParagraphs([{ ...item, topics: [] }]), []);
});

test('pai em branco preserva filhos e tópicos em branco não imprimem frases automáticas', () => {
  const item = { id: 's1', title: 'Serviço', description: '', topics: [
    { id: 'pai', text: '', children: [{ id: 'filho', text: 'Texto mantido' }] },
    { id: 'vazio', text: '' }, { id: 'proximo', text: 'Próximo texto' }
  ] };
  assert.deepEqual(scopeDescriptionParagraphs([item]).map(p => [p.number, p.text]), [['2.1', 'Texto mantido'], ['2.2', 'Próximo texto']]);
});

test('o modelo de pré-engenharia cria uma árvore independente com cinco detalhes', () => {
  const a = createScopeTopic('a', 'pre-engenharia');
  const b = createScopeTopic('b', 'pre-engenharia');
  assert.equal(a.children.length, 5);
  a.children[0].text = 'Texto manual';
  assert.notEqual(a.children[0].text, b.children[0].text);
  assert.notEqual(a.children[0].id, b.children[0].id);
});

test('prévia técnica e comercial imprimem o mesmo texto numerado dos modelos', () => {
  const itens = [createScopeDescriptionItem('a', 'pre-engenharia'), createScopeDescriptionItem('b', 'filtragem')];
  for (const tipo of ['commercial', 'technical']) {
    const html = renderToStaticMarkup(createElement(DocumentoPrevia, {
      tipo, form: {}, codigo: '0001', itensEscopo: itens, blocos: [], responsabilidades: [], precos: [],
      incluirUnitario: true, servicosTecnicos: [], complementoRelatorios: ''
    }));
    for (const p of scopeDescriptionParagraphs(itens)) assert.ok(html.includes(`<b>${p.number}</b>`), p.number);
    assert.doesNotMatch(html, /Pré-engenharia — Serviço|Descreva este serviço/);
  }
});

test('textos extensos continuam em novas páginas, sem perder palavras nem repetir numeração', () => {
  const texto = 'Texto longo e editável. '.repeat(300).trim();
  const paragrafos = scopeDescriptionParagraphs([{ ...createScopeDescriptionItem('longo'), description: texto }]);
  const paginas = paginacao.paginasDasDescricoes(paragrafos);
  assert.ok(paginas.length > 2);
  assert.equal(paginas.flat().filter(p => !p.continuacao).length, 1);
  assert.equal(paginas.flat().map(p => p.text).join(' '), texto);
});
