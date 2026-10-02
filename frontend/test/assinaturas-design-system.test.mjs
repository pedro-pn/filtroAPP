import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('biblioteca de Assinaturas renderiza estados, recortes e todos os status no DS', async t => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const { DocumentLibrary } = await server.ssrLoadModule('/src/pages/assinaturas/components/DocumentLibrary.tsx');
    const { resolveStatusTone } = await server.ssrLoadModule('/src/components/ui/ds/status.ts');
    assert.equal(resolveStatusTone('Aguardando assinaturas'), 'warning');
    assert.equal(resolveStatusTone('Finalizando'), 'info');
    const items = ['RASCUNHO', 'AGUARDANDO_ASSINATURAS', 'FINALIZANDO', 'CONCLUIDO', 'CANCELADO'].map((status, i) => ({
      id: `doc-${i}`, title: `Documento ${i}`, originalFileName: 'Arquivo extenso.pdf', status,
      pageCount: 4, signerCount: i === 0 ? 0 : 3, signedCount: i === 3 ? 3 : 1,
      progressLabel: i === 0 ? 'Sem assinantes' : '1 de 3 assinaturas', hasExpiredInvites: i === 1,
      createdAt: '2026-09-10T12:00:00Z', completedAt: i === 3 ? '2026-09-10T13:00:00Z' : null
    }));
    const base = { data: { items, nextCursor: null }, loading: false, error: false, archived: false, query: '', status: '',
      onQueryChange() {}, onStatusChange() {}, onArchiveChange() {}, onClearFilters() {}, onRetry() {}, onNew() {}, onOpen() {} };
    for (const state of ['ready', 'loading', 'error', 'empty', 'archived', 'filtered', 'partial']) {
      await t.test(state, () => {
        const props = { ...base };
        if (state === 'loading') props.loading = true;
        if (state === 'error') props.error = true;
        if (['empty', 'archived', 'filtered'].includes(state)) props.data = { items: [], nextCursor: null };
        if (state === 'archived') props.archived = true;
        if (state === 'filtered') { props.query = 'Não existe'; props.status = 'CONCLUIDO'; }
        if (state === 'partial') props.data = { items, nextCursor: 'cursor' };
        const html = renderToStaticMarkup(createElement(DocumentLibrary, props));
        assert.match(html, /fv-ds assinaturas-library/);
        assert.match(html, /aria-label="Buscar documentos"/);
        assert.match(html, /for="signature-status-filter-control"/);
        assert.match(html, /aria-pressed="true"/);
        assert.doesNotMatch(html, /class="(?:primary-button|secondary-button|signature-status)/);
        if (state === 'loading' || state === 'error') {
          assert.match(html, state === 'loading' ? /fv-skeleton/ : /Tentar novamente/);
          assert.doesNotMatch(html, /fv-metric-card|data-signature-document/);
        } else if (state === 'ready' || state === 'partial') {
          assert.equal((html.match(/data-signature-document=/g) || []).length, 5);
          assert.equal((html.match(/<progress/g) || []).length, 4);
          assert.match(html, /Há links expirados/);
          assert.match(html, /aria-label="Abrir documento Documento 0"/);
          assert.equal((html.match(/<button[^>]*data-signature-document=/g) || []).length, 5, 'todo card é um botão nativo acessível');
          assert.doesNotMatch(html, />Abrir</, 'sem botão Abrir separado');
          for (const [card] of html.matchAll(/<button[^>]*data-signature-document=[\s\S]*?<\/button>/g)) {
            assert.equal((card.match(/<button/g) || []).length, 1, 'sem botões aninhados nos cards');
          }
          assert.equal(html.includes('Recorte carregado'), state === 'partial');
        } else {
          assert.match(html, /fv-empty-state/);
          assert.match(html, state === 'filtered' ? /Nenhum documento encontrado/ : state === 'archived' ? /Nenhum documento arquivado/ : /Nenhum documento ainda/);
        }
      });
    }
    const { PdfDropzone } = await server.ssrLoadModule('/src/components/ui/PdfDropzone.tsx');
    const props = { id: 'pdf', label: 'Arquivo PDF', onFile() {}, fileName: 'Documento.pdf' };
    assert.doesNotMatch(renderToStaticMarkup(createElement(PdfDropzone, props)), /pdf-upload--ds/);
    const upload = renderToStaticMarkup(createElement(PdfDropzone, { ...props, appearance: 'design-system', error: 'Selecione um PDF válido.' }));
    assert.match(upload, /pdf-upload--ds/);
    assert.match(upload, /fv-icon-button/);
    assert.match(upload, /aria-invalid="true"/);
    assert.match(upload, /aria-describedby="pdf-error"/);
  } finally { await server.close(); }
});

test('migração mantém navegação e API e isola o upload compacto dos consumidores legados', () => {
  const page = source('pages/assinaturas/AssinaturasPage.tsx');
  const shell = source('pages/assinaturas/AssinaturasAppShell.tsx');
  const modal = source('pages/assinaturas/components/NewDocumentModal.tsx');
  const library = source('pages/assinaturas/components/DocumentLibrary.tsx');
  assert.match(shell, /hubModulesForUser\(user\)/);
  assert.match(shell, /createNavigationModel/);
  assert.match(shell, /accountPageStateFromPath\(location\)/);
  assert.match(page, /normalizeSignatureSearchParams\(params\)/);
  assert.match(page, /signatureDocumentSearchParams\(params, id, initialTab\)/);
  assert.match(page, /useSignatureDocuments\(\{ q: query \|\| undefined, status: status \|\| undefined, arquivados: archived \? 1 : undefined \}\)/);
  assert.doesNotMatch(library, /useQuery|useMutation|localStorage|fetch\(/);
  assert.match(modal, /appearance="design-system"/);
  assert.match(modal, /fullscreenOnMobile=\{false\}/);
  assert.match(modal, /closeOnEscape=\{!saving\}/);
  assert.match(modal, /file\.size > 20 \* 1024 \* 1024/);
  assert.match(modal, /pdfDataUrl = await readDataUrl\(file\)/);
  for (const path of ['pages/assinaturas/AssinaturasPage.ds.css', 'components/ui/PdfDropzone.css']) {
    const css = source(path);
    assert.doesNotMatch(css, /#[\da-f]{3,8}\b|rgba?\(|!important/i);
    assert.match(css, /var\(--(?:surface|brand-softer)/);
    assert.match(css, /var\(--ink\)/);
  }
  assert.match(source('pages/assinaturas/AssinaturasPage.ds.css'), /assinaturas-document__actions \{[^}]*flex-wrap: nowrap/);
});

test('tutorial de Assinaturas reutiliza ação compacta acessível no header mobile', () => {
  const page = source('pages/assinaturas/AssinaturasPage.tsx');
  const css = source('pages/assinaturas/AssinaturasPage.ds.css');
  assert.match(page, /<IconButton className="assinaturas-tutorial-mobile"[^>]*label="Ver tutorial de Assinaturas"/);
  assert.match(page, /<Button className="assinaturas-tutorial-desktop"[^\n]*>Ver tutorial<\/Button>/);
  assert.match(css, /\.fv-topbar \.assinaturas-tutorial-mobile\s*\{\s*display: none;/);
  assert.match(css, /@media\s*\(max-width: 767\.98px\)[\s\S]*assinaturas-tutorial-mobile\s*\{\s*display: inline-flex;/);
  assert.match(css, /assinaturas-tutorial-desktop\s*\{\s*display: none;/);
});
