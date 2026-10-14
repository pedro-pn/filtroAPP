import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { jsonBodyLimitForRequest } from '../src/app.js';

test('relatórios operacionais (manutenção) aceitam fotos em base64 no corpo, como o upload do RDO', () => {
  for (const path of [
    '/api/operational-reports',
    '/api/rdo/operational-reports',
    '/api/rdo/operational-reports/abc123',
    '/api/rdo/operational-reports/maintenance-records/abc123'
  ]) {
    for (const method of ['POST', 'PUT', 'PATCH']) assert.equal(jsonBodyLimitForRequest(method, path), '25mb', `${method} ${path}`);
  }
  assert.equal(jsonBodyLimitForRequest('POST', '/api/rdo/uploads'), '25mb');
});

test('o limite maior não vaza para rotas parecidas', () => {
  assert.equal(jsonBodyLimitForRequest('POST', '/api/operational-reports-export'), '1mb');
  assert.equal(jsonBodyLimitForRequest('POST', '/api/rdo/reports'), '1mb');
});

test('upload, substituição, extração e assinatura física aceitam PDFs de 50 MB em base64 nos dois caminhos da API', () => {
  for (const prefix of ['/api/reports', '/api/rdo/reports']) {
    for (const [method, suffix] of [
      ['POST', '/manual-upload'], ['POST', '/manual-extract'],
      ['PUT', '/abc123/manual-pdf'], ['POST', '/abc123/physical-signature']
    ]) {
      const path = `${prefix}${suffix}`;
      assert.equal(jsonBodyLimitForRequest(method, path), '70mb', `${method} ${path}`);
      assert.equal(jsonBodyLimitForRequest(method, `${path}-other`), '1mb');
    }
  }
});

test('proxy de produção e staging comportam um PDF de 50 MB codificado em base64', () => {
  const encodedPayloadSize = 4 * Math.ceil((50 * 1024 * 1024) / 3) + 1024;
  for (const file of ['default.conf', 'staging.conf']) {
    const source = fs.readFileSync(new URL(`../../deploy/nginx/${file}`, import.meta.url), 'utf8');
    const limit = source.match(/client_max_body_size\s+(\d+)M;/);
    assert.ok(limit, `${file} deve definir limite de corpo`);
    assert.ok(Number(limit[1]) * 1024 * 1024 >= encodedPayloadSize, `${file} deve comportar 50 MB em base64 mais os campos do JSON`);
  }
});
