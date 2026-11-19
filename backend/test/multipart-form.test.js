import assert from 'node:assert/strict';
import test from 'node:test';

import express from 'express';

import { multipartJsonWithFile } from '../src/lib/http/multipart-form.js';

// Leitor de multipart do upload manual (spec 042, D3): sem dependência nova,
// com limite de tamanho aplicado enquanto o corpo chega.

async function withServer(maxBytes, run) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.post('/upload', multipartJsonWithFile({ maxBytes }), (req, res) => {
    res.json({
      body: req.body,
      file: req.uploadedFile ? { fileName: req.uploadedFile.fileName, size: req.uploadedFile.bytes.length, head: req.uploadedFile.bytes.subarray(0, 5).toString('latin1') } : null
    });
  });
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, code: err.code }));
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}/upload`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('payload JSON vai para req.body e o arquivo para req.uploadedFile', async () => {
  await withServer(1024 * 1024, async url => {
    const form = new FormData();
    form.append('payload', JSON.stringify({ projectId: 'p1', operationalData: { collaboratorIds: ['a'] } }));
    form.append('pdf', new Blob([Buffer.from('%PDF-1.7 teste')], { type: 'application/pdf' }), 'rdo.pdf');
    const response = await fetch(url, { method: 'POST', body: form });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.body, { projectId: 'p1', operationalData: { collaboratorIds: ['a'] } });
    assert.deepEqual(data.file, { fileName: 'rdo.pdf', size: 14, head: '%PDF-' });
  });
});

test('corpo acima do limite recebe 413 antes de montar o formulário', async () => {
  await withServer(64 * 1024, async url => {
    const form = new FormData();
    form.append('payload', '{}');
    form.append('pdf', new Blob([Buffer.alloc(200 * 1024, 1)], { type: 'application/pdf' }), 'grande.pdf');
    const response = await fetch(url, { method: 'POST', body: form });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).code, 'PAYLOAD_TOO_LARGE');
  });
});

test('payload que não é JSON recebe 400; pedido JSON passa direto', async () => {
  await withServer(1024 * 1024, async url => {
    const form = new FormData();
    form.append('payload', '{quebrado');
    const invalid = await fetch(url, { method: 'POST', body: form });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, 'INVALID_MULTIPART');

    const json = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a: 1 }) });
    assert.deepEqual(await json.json(), { body: { a: 1 }, file: null });
  });
});
