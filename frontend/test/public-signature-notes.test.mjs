import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('lotes acima de 100 RDOs enviam somente as notas da parcela atual, preservando notas vazias e comuns', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const { apiClient } = await server.ssrLoadModule('/src/api/client.ts');
    const { confirmPublicSignatureBatch } = await server.ssrLoadModule('/src/api/publicSignatures.ts');
    // The chunking client runs without browser credentials in this SSR test.
    apiClient.interceptors.request.clear();
    const requests = [];
    apiClient.defaults.adapter = async config => {
      const body = JSON.parse(config.data);
      requests.push(body);
      return { config, status: 200, statusText: 'OK', headers: {}, data: {
        results: body.signatureIds.map(signatureId => ({ signatureId, success: true })), emailDelivery: { status: 'queued' }
      } };
    };
    const signatureIds = Array.from({ length: 101 }, (_, index) => `signature-${index}`);
    const comments = Object.fromEntries(signatureIds.map((id, index) => [id, `Nota ${index}`]));
    const base = { signerName: 'Cliente Teste', signatureImageDataUrl: 'fixture', privacyNoticeAccepted: true, privacyNoticeVersion: 'signature_rdo_v1' };
    const result = await confirmPublicSignatureBatch('fixture', { ...base, signatureIds, comments });
    assert.deepEqual(requests.map(request => request.signatureIds.length), [100, 1]);
    for (const request of requests) {
      assert.deepEqual(Object.keys(request.comments), request.signatureIds);
      for (const id of request.signatureIds) assert.equal(request.comments[id], comments[id]);
    }
    assert.equal(result.results.length, 101);
    await confirmPublicSignatureBatch('fixture', { ...base, signatureIds: ['first', 'second'], comment: 'Nota comum', comments: { first: '' } });
    assert.deepEqual(requests[2].comments, { first: '', second: 'Nota comum' });
  } finally { await server.close(); }
});
