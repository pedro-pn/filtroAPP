import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createServer } from 'vite';

const source = path => readFileSync(new URL(`../src/pages/assinaturas/${path}`, import.meta.url), 'utf8');

test('acompanhamento preserva ações por status e separa assinatura de entrega do convite', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  try {
    const { SignerStatusList } = await server.ssrLoadModule('/src/pages/assinaturas/components/SignerStatusList.tsx');
    const { ToastContext } = await server.ssrLoadModule('/src/components/ui/ToastContext.ts');
    const render = (component, props) => renderToStaticMarkup(createElement(QueryClientProvider, { client },
      createElement(ToastContext.Provider, { value: { showToast() {} } }, createElement(component, props))));
    for (const [status, actions] of [['PENDENTE', 4], ['VISUALIZADO', 4], ['EXPIRADO', 3], ['ASSINADO', 0], ['REVOGADO', 0]]) {
      const signer = { id: 's1', name: 'Ana Silva', email: 'ana@example.com', position: 1, status, emailStatus: 'ENVIADO', signedAt: status === 'ASSINADO' ? '2026-09-10T12:00:00Z' : null, tokenExpiresAt: '2026-09-25T12:00:00Z' };
      const html = render(SignerStatusList, { documentId: 'doc', signers: [signer] });
      assert.match(html, /fv-ds assinaturas-tracking/);
      assert.match(html, /Assinante Ana Silva/);
      assert.equal((html.match(/<button/g) || []).length, actions, status);
      assert.match(html, /E-mail enviado/);
      if (status === 'ASSINADO') {
        assert.match(html, /data-status="Assinado"[^>]*fv-tone--info/);
        assert.match(html, /Assinado em 10\/09\/2026, 09:00/);
      }
      if (status === 'EXPIRADO') assert.match(html, /Expirou em/);
      if (status === 'REVOGADO') assert.match(html, /Validade original:/);
      if (actions) assert.match(html, /aria-label="Copiar link de Ana Silva"/);
      assert.doesNotMatch(html, /mini-button|signature-status-row/);
    }
    for (const [emailStatus, label] of [['NAO_APLICAVEL', 'Link manual'], ['EM_ENVIO', 'Envio pendente'], ['REVISAO_NECESSARIA', 'Envio requer revisão'], ['FALHOU', 'Falha no envio']]) {
      const html = render(SignerStatusList, { documentId: 'doc', signers: [{ id: 's1', name: 'Ana', email: emailStatus === 'NAO_APLICAVEL' ? null : 'ana@example.com', status: 'PENDENTE', emailStatus }] });
      assert.match(html, new RegExp(label));
      if (emailStatus === 'NAO_APLICAVEL') assert.doesNotMatch(html, /aria-label="Reenviar/);
    }
    assert.match(render(SignerStatusList, { documentId: 'doc', signers: [] }), /Nenhum assinante neste documento/);

    const { DocumentTrackingSummary } = await server.ssrLoadModule('/src/pages/assinaturas/components/DocumentTrackingSummary.tsx');
    for (const status of ['AGUARDANDO_ASSINATURAS', 'FINALIZANDO', 'CONCLUIDO', 'CANCELADO']) {
      const html = render(DocumentTrackingSummary, { document: { status, progress: { signed: 2, total: 3 } }, downloading: null, onDownload() {} });
      assert.match(html, /max="3" value="2"/);
      assert.equal((html.match(/disabled=""/g) || []).length, status === 'CONCLUIDO' ? 0 : 1);
      if (status === 'FINALIZANDO') assert.match(html, /Gerando o PDF assinado/);
      if (status === 'CANCELADO') assert.match(html, /assinaturas já registradas foram preservadas/);
    }
    const zero = render(DocumentTrackingSummary, { document: { status: 'CANCELADO', progress: { signed: 0, total: 0 } }, downloading: 'original', onDownload() {} });
    assert.doesNotMatch(zero, /<progress/);
    assert.match(zero, /aria-busy="true"/);
    assert.equal((zero.match(/disabled=""/g) || []).length, 2);

    const { AuditTrail, AuditTimeline } = await server.ssrLoadModule('/src/pages/assinaturas/components/AuditTrail.tsx');
    const items = [
      { id: 'a1', action: 'EMAIL_FALHOU', description: 'Teste <script> & texto longo', createdAt: '2026-09-10T12:00:00Z' },
      { id: 'a2', action: 'NOVO_EVENTO', description: null, createdAt: '2026-09-09T12:00:00Z' }
    ];
    const timeline = render(AuditTimeline, { items });
    assert.match(timeline, /<ol[^>]*aria-label="Eventos de auditoria"/);
    assert.match(timeline, /datetime="2026-09-10T12:00:00Z"/i);
    assert.match(timeline, /&lt;script&gt; &amp;/);
    assert.ok(timeline.indexOf('Falha no envio') < timeline.indexOf('NOVO EVENTO'), 'preserva ordem da API e fallback de evento');
    for (const [id, data] of [['empty', { items: [], nextCursor: null }], ['ready', { items, nextCursor: 'next' }]]) {
      client.setQueryData(['assinaturas', 'audit', id, ''], data);
      const html = render(AuditTrail, { documentId: id });
      assert.match(html, /Histórico do documento/);
      assert.match(html, /Paginação da auditoria/);
      assert.match(html, id === 'empty' ? /Nenhum evento de auditoria nesta página/ : /2 nesta página/);
    }
    assert.match(render(AuditTrail, { documentId: 'loading' }), /fv-skeleton/);
    client.setQueryDefaults(['assinaturas', 'audit', 'error'], { retryOnMount: false });
    client.getQueryCache().build(client, { queryKey: ['assinaturas', 'audit', 'error', ''] }).setState({ status: 'error', error: Error('Teste'), fetchStatus: 'idle' });
    assert.match(render(AuditTrail, { documentId: 'error' }), /Tentar novamente/);
  } finally { client.clear(); await server.close(); }
});

test('apresentação de acompanhamento mantém endpoints, cursor e confirmações, com CSS isolado', () => {
  const list = source('components/SignerStatusList.tsx');
  const audit = source('components/AuditTrail.tsx');
  const detail = source('components/DocumentDetailView.tsx');
  const css = source('AssinaturasTracking.ds.css');
  assert.match(list, /recoverSignatureInviteLink\(documentId, signer.id\)/);
  assert.match(list, /navigator.clipboard.writeText\(result.url\)/);
  for (const action of ['renewInvite', 'revokeInvite', 'resendInvite']) assert.match(list, new RegExp(`mutations.${action}.mutateAsync`));
  assert.match(list, /appearance="design-system"/);
  assert.match(list, /confirmDisabled=\{busy\}/);
  assert.match(list, /if \(!busy\) setRevoking\(null\)/);
  assert.match(list, /requestAnimationFrame\(\(\) => signerHeadings.current.get\(revoking.id\)\?\.focus/);
  assert.match(audit, /useSignatureAudit\(documentId, cursor\)/);
  assert.match(audit, /onClick=\{\(\) => setCursor\(''\)\}/);
  assert.match(detail, /<AuditTrail key=\{document.id\}/);
  assert.match(detail, /downloadSignaturePdf\(document.id, final\)/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|rgba?\(|!important/i);
  assert.doesNotMatch(css, /\.efetivo|\.signature-public/);
  const tokens = readFileSync(new URL('../src/styles/variables.css', import.meta.url), 'utf8');
  for (const [, token] of css.matchAll(/var\((--[\w-]+)/g)) assert.ok(token === '--audit-event-color' || tokens.includes(`${token}:`), token);
});
