import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let server, PropostaFooter;
test.before(async () => {
  server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  ({ PropostaFooter } = await server.ssrLoadModule('/src/pages/comercial/proposta/PropostaFooter.tsx'));
});
test.after(async () => server?.close());

test('topo e rodapé da proposta têm cancelar, voltar, salvar rascunho e avançar', () => {
  for (const posicao of ['topo', 'rodape']) {
    for (const ocupado of [false, true]) {
      const html = renderToStaticMarkup(createElement(PropostaFooter, {
        posicao, primeiraEtapa: false, aviso: 'Pendências', rotulo: 'Salvar e continuar', ocupado,
        onCancelar() {}, onVoltar() {}, onSalvarRascunho() {}, onAvancar() {}
      }));
      for (const texto of ['Cancelar e voltar', '← Voltar', 'Salvar rascunho', 'Salvar e continuar']) assert.ok(html.includes(texto));
      assert.equal((html.match(/<button/g) || []).length, 4);
      assert.equal((html.match(/disabled=""/g) || []).length, ocupado ? 2 : 0);
      assert.equal(html.includes('com-acoes-topo'), posicao === 'topo');
      assert.equal(html.startsWith('<footer'), posicao === 'rodape');
    }
  }
});

test('primeira etapa não oferece voltar para etapa inexistente e emitida não oferece salvar rascunho', () => {
  const html = renderToStaticMarkup(createElement(PropostaFooter, {
    primeiraEtapa: true, aviso: '', rotulo: 'Finalizada', ocupado: true,
    onCancelar() {}, onVoltar() {}, onAvancar() {}
  }));
  assert.doesNotMatch(html, /← Voltar|Salvar rascunho/);
});

test('as páginas reutilizam exatamente a mesma barra e handlers nos dois locais', () => {
  for (const [arquivo, funcao, inicioConteudo] of [
    ['proposta/PropostaPage.tsx', 'renderAcoesDaProposta', "{etapa === 'cliente' ?"],
    ['custos/CustosPage.tsx', 'renderAcoesDoLevantamento', '<PendenciasDaSecao']
  ]) {
    const source = readFileSync(new URL(`../src/pages/comercial/${arquivo}`, import.meta.url), 'utf8');
    assert.equal((source.match(new RegExp(`function ${funcao}\\(`, 'g')) || []).length, 1);
    assert.ok(source.indexOf(`${funcao}('topo')`) < source.indexOf(inicioConteudo));
    assert.ok(source.indexOf(`${funcao}('rodape')`) > source.indexOf(inicioConteudo));
  }
});
