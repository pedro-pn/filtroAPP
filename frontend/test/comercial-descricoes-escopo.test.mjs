import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import {
  SCOPE_DESCRIPTION_TEMPLATES, createScopeDescriptionItem, scopeDescriptionParagraphs
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
  const paragrafos = scopeDescriptionParagraphs(itens, true);
  assert.deepEqual(paragrafos.map(p => p.number), [
    '2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7', '2.8', '2.9',
    '2.9.1', '2.9.2', '2.9.3', '2.9.4', '2.9.5'
  ]);
  assert.equal(paragrafos[0].text, itens[0].description);
  assert.equal(paragrafos[9].text, itens[8].subitems[0]);
  itens[8].subitems.splice(2, 1);
  const reordenados = scopeDescriptionParagraphs([itens[8], itens[0]], true);
  assert.deepEqual(reordenados.map(p => p.number), ['2.1', '2.1.1', '2.1.2', '2.1.3', '2.1.4', '2.2']);
});

test('texto livre e colado é preservado; linhas vazias não criam itens fantasmas', () => {
  const itens = [{ ...createScopeDescriptionItem('livre'), description: 'Texto alterado\r\n\r\nOutro parágrafo\n', subitems: ['\n', 'Detalhe 1\nDetalhe 2'] }];
  assert.deepEqual(scopeDescriptionParagraphs(itens, true).map(p => [p.number, p.text]), [
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

test('escopos legados mantêm título e texto do levantamento', () => {
  const legado = [{ id: 'custo', title: 'Limpeza química', description: 'Sistema contemplado: Circuito 1.' }];
  assert.equal(scopeDescriptionParagraphs(legado, true)[0].text,
    'Serviço especializado em mão de obra e execução técnica — Limpeza química — Sistema contemplado: Circuito 1.');
  assert.equal(scopeDescriptionParagraphs(legado)[0].text, 'Limpeza química — Sistema contemplado: Circuito 1.');
  assert.deepEqual(normalizeScopeServiceItems(legado), legado);
});

test('editor mostra um campo por texto/subitem e permite remover inclusive o último item', () => {
  const html = renderToStaticMarkup(createElement(EscopoStep, {
    titulo: '', onTitulo() {}, itens: [createScopeDescriptionItem('a', 'pre-engenharia')],
    onItens() {}, blocos: [], onBlocos() {}, erroDe() {}
  }));
  assert.match(html, /Texto do item 2\.1/);
  for (let i = 1; i <= 5; i++) assert.ok(html.includes(`Subitem 2.1.${i}`));
  assert.doesNotMatch(html, /Título do item|Descrição completa/);
  assert.match(html, /aria-label="Remover serviço 1"(?![^>]*disabled)/);
  assert.match(html, /Adicionar subitem/);
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
