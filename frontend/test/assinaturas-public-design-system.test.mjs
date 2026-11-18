import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('assinatura pública apresenta leitura, estados finais e falhas no design system', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const { PublicSignatureShell, PublicSignatureState, PublicSignatureView } = await server.ssrLoadModule('/src/pages/assinaturas/components/PublicSignatureView.tsx');
    const { ThemeContext } = await server.ssrLoadModule('/src/theme/ThemeContext.ts');
    const render = (component, props) => renderToStaticMarkup(createElement(component, props));
    const base = { pageNumber: 1, imageUrl: '', imageError: false, downloading: false,
      onPageChange() {}, onImageError() {}, onRetryImage() {}, onSign() {}, onDownload() {} };
    const document = { title: 'Contrato <industrial>', originalFileName: 'Contrato.pdf', requestedBy: 'Coordenação de serviços',
      pageCount: 3, status: 'AGUARDANDO_ASSINATURAS', progress: { signed: 0, total: 2 } };
    const invite = { status: 'ATIVO', document, expiresAt: '2026-09-25T12:00:00Z', signer: { name: 'Ana Silva', status: 'PENDENTE', signedAt: null },
      fields: [{ pageNumber: 1, x: 0.1, y: 0.6, width: 0.2, height: 0.08 }], downloadAvailable: false };
    const ready = render(PublicSignatureView, { ...base, invite });
    assert.match(ready, /Contrato &lt;industrial&gt;/);
    assert.match(ready, /25\/09\/2026, 09:00/);
    assert.match(ready, /data-status="Pendente"[^>]*fv-tone--warning/);
    assert.match(ready, /Assinar documento/);
    assert.doesNotMatch(ready, /Baixar PDF assinado|class="assinaturas-public__field"/);
    assert.match(ready, /Carregando página 1/);
    assert.equal((ready.match(/disabled=""/g) || []).length, 1);
    for (const status of ['AGUARDANDO_ASSINATURAS', 'FINALIZANDO', 'CONCLUIDO']) {
      const signedInvite = { ...invite, document: { ...document, status }, signer: { ...invite.signer, status: 'ASSINADO', signedAt: '2026-09-10T12:00:00Z' }, downloadAvailable: status === 'CONCLUIDO' };
      const html = render(PublicSignatureView, { ...base, invite: signedInvite, pageNumber: 3 });
      assert.match(html, /data-status="Assinado"[^>]*fv-tone--info/);
      assert.doesNotMatch(html, /Assinar documento/);
      assert.equal(html.includes('Baixar PDF assinado'), status === 'CONCLUIDO');
      assert.match(html, status === 'CONCLUIDO' ? /Documento concluído/ : status === 'FINALIZANDO' ? /Finalizando o PDF assinado/ : /Aguardando as demais assinaturas/);
      assert.match(html, /Assinado em 10\/09\/2026, 09:00/);
    }
    const failedPage = render(PublicSignatureView, { ...base, invite, imageError: true });
    assert.match(failedPage, /Recarregar página/);
    assert.doesNotMatch(failedPage, /Carregando página|class="assinaturas-public__field"/);
    const downloading = render(PublicSignatureView, { ...base, invite: { ...invite, downloadAvailable: true }, downloading: true });
    assert.match(downloading, /aria-busy="true" data-loading="true"/);
    assert.match(downloading, /fv-sr-only">Baixando PDF assinado/);
    for (const title of ['Link inválido', 'Link expirado ou indisponível', 'Link indisponível']) {
      const html = render(PublicSignatureState, { title, description: 'Solicite um novo link.' });
      assert.match(html, new RegExp(title));
      assert.doesNotMatch(html, /<button/);
    }
    assert.match(render(PublicSignatureState, { title: 'Erro de conexão', onRetry() {} }), /Tentar novamente/);
    assert.match(render(PublicSignatureState, { title: 'Carregando convite', loading: true }), /fv-skeleton/);
    for (const theme of ['light', 'dark']) {
      const html = renderToStaticMarkup(createElement(ThemeContext.Provider, { value: { theme, resolvedTheme: theme, setTheme() {} } },
        createElement(PublicSignatureShell, null, createElement(PublicSignatureView, { ...base, invite }))));
      assert.match(html, /class="fv-ds assinaturas-public"/);
      assert.match(html, new RegExp(`data-brand-variant="${theme === 'dark' ? 'white' : 'color'}"`));
      assert.doesNotMatch(html, /survey-page-shell|auth-card|primary-button|secondary-button/);
    }
  } finally { await server.close(); }
});

test('migração pública preserva token, consentimento, coordenadas e consulta sem reenviar assinatura', () => {
  const page = source('pages/assinaturas/AssinaturasPublicSignPage.tsx');
  const view = source('pages/assinaturas/components/PublicSignatureView.tsx');
  const css = source('pages/assinaturas/AssinaturasPublicSignPage.ds.css');
  assert.match(page, /captureInviteFromFragment\(window.location, window.history\)/);
  assert.match(page, /usePublicSignatureInvite\(token, polling\)/);
  assert.equal((page.match(/confirmPublicSignature\(/g) || []).length, 1);
  assert.match(page, /privacyNoticeAccepted: privacyAccepted/);
  assert.match(page, /privacyNoticeVersion: SIGNATURE_AVULSA_NOTICE_VERSION/);
  assert.match(page, /allowCachedSignerName=\{false\}/);
  assert.match(page, /confirmDisabled=\{!privacyAccepted\}/);
  assert.match(page, /appearance="design-system"/);
  assert.match(page, /fullscreenOnMobile=\{false\}/);
  assert.match(page, /loadingLabel="Assinando documento"/);
  assert.match(page, /if \(!submitting\)/);
  assert.match(page, /publicSignaturePage\(token, pageNumber\)/);
  assert.match(page, /publicSignaturePdf\(token\)/);
  assert.match(page, /if \(!disposed\) setPageImage/);
  assert.match(page, /URL.revokeObjectURL\(currentUrl\)/);
  assert.match(page, /\[pageCount, pageNumber, token, imageRetry\]/, 'polling não recarrega a mesma imagem');
  assert.doesNotMatch(page + view, /localStorage|sessionStorage|console\.|token=|#convite=/);
  assert.match(view, /style=\{normalizedToPercent\(field\)\}/);
  assert.match(view, /imageReady \? pageFields.map/);
  assert.doesNotMatch(view, /useQuery|useMutation|fetch\(/);
  assert.match(css, /\.assinaturas-public__paper \{[^}]*background: var\(--white\)/);
  assert.match(css, /\.assinaturas-public__actions \{[^}]*flex-wrap: nowrap/);
  assert.match(css, /\.assinaturas-public__consent \.privacy-notice a \{[^}]*color: var\(--info\)/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|rgba?\(|!important|filter:|\.efetivo/i);
  const tokens = source('styles/variables.css');
  for (const [, token] of css.matchAll(/var\((--[\w-]+)/g)) assert.ok(tokens.includes(`${token}:`), token);
});
