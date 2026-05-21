import assert from 'node:assert/strict';
import test from 'node:test';

import { downloadSignedZapSignDocument } from '../src/lib/zapsign.js';

test('downloadSignedZapSignDocument falls back to direct download when legacy auth is not configured', async t => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async url => {
    calls.push(String(url));
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  };

  const buffer = await downloadSignedZapSignDocument('https://signed.example.com/report.pdf');

  assert.deepEqual(calls, ['https://signed.example.com/report.pdf']);
  assert.deepEqual([...buffer], [1, 2, 3]);
});
