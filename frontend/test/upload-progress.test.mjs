import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('photo upload progress follows confirmed responses and stops after a failed batch', async t => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const { uploadFiles } = await server.ssrLoadModule('/src/api/uploads.ts');
    const { apiClient } = await server.ssrLoadModule('/src/api/client.ts');
    const originalPost = apiClient.post;
    const requests = [];
    apiClient.post = (_url, item) => new Promise((resolve, reject) => {
      requests.push({ resolve: () => resolve({ data: { ...item, url: `/uploads/${item.fileName}` } }), reject });
    });
    try {
      const items = ['first.jpg', 'second.jpg'].map(fileName => ({ fileName, label: 'Fotos', mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AA==' }));
      await t.test('out of order responses update completion and preserve file order', async () => {
        const progress = [];
        const pending = uploadFiles(items, (completed, total) => progress.push([completed, total]));
        assert.deepEqual(progress, [[0, 2]], 'waiting does not advance the progress');
        requests[1].resolve();
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(progress, [[0, 2], [1, 2]]);
        requests[0].resolve();
        const result = await pending;
        assert.deepEqual(progress, [[0, 2], [1, 2], [2, 2]]);
        assert.deepEqual(result.map(file => file.fileName), items.map(file => file.fileName));
      });
      await t.test('failed uploads never reach completion or report late responses', async () => {
        requests.length = 0;
        const progress = [];
        const pending = uploadFiles(items, (completed, total) => progress.push([completed, total]));
        requests[0].reject(new Error('Falha no envio'));
        await assert.rejects(pending, /Falha no envio/);
        requests[1].resolve();
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(progress, [[0, 2]]);
      });
      await t.test('empty batches and callers without progress remain supported', async () => {
        const progress = [];
        assert.deepEqual(await uploadFiles([], (completed, total) => progress.push([completed, total])), []);
        assert.deepEqual(progress, [[0, 0]]);
        requests.length = 0;
        const pending = uploadFiles(items.slice(0, 1));
        requests[0].resolve();
        assert.equal((await pending).length, 1);
      });
    } finally { apiClient.post = originalPost; }
  } finally { await server.close(); }
});
