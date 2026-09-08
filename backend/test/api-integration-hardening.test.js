import assert from 'node:assert/strict';
import test from 'node:test';

import { apiRequestContext, integrationApiBoundary } from '../src/middleware/api-request-context.js';

function responseDouble() {
  return {
    headers: {}, statusCode: 200, payload: null, ended: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = String(value); },
    removeHeader(name) { delete this.headers[name.toLowerCase()]; },
    setTimeout() {},
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return value; },
    end() { this.ended = true; return this; }
  };
}

function request(overrides = {}) {
  return { method: 'GET', headers: {}, query: {}, originalUrl: '/api/integracoes/v1/qualidade/registros', secure: true, ...overrides };
}

test('integration request context always emits no-store and a safe request id', () => {
  const req = request({ headers: { 'x-request-id': 'request-safe-123' } });
  const res = responseDouble();
  let continued = false;
  apiRequestContext()(req, res, () => { continued = true; });
  assert.equal(continued, true);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['x-request-id'], 'request-safe-123');
});

test('browser CORS is closed by default while server-to-server GET remains allowed', () => {
  const boundary = integrationApiBoundary({ allowedOrigins: [] });
  const browserReq = request({ headers: { origin: 'https://unknown.example' }, requestId: 'request-safe-123' });
  const browserRes = responseDouble();
  boundary(browserReq, browserRes, () => assert.fail('origem não deveria continuar'));
  assert.equal(browserRes.statusCode, 403);
  assert.equal(browserRes.headers['access-control-allow-origin'], undefined);

  const serverReq = request({ requestId: 'request-safe-456' });
  const serverRes = responseDouble();
  let continued = false;
  boundary(serverReq, serverRes, () => { continued = true; });
  assert.equal(continued, true);
});

test('allowed preflight is narrow and mutating/body-bearing requests are rejected', () => {
  const allowedOrigin = 'https://app.example';
  const preflight = request({ method: 'OPTIONS', headers: { origin: allowedOrigin }, requestId: 'request-safe-123' });
  const preflightRes = responseDouble();
  integrationApiBoundary({ allowedOrigins: [allowedOrigin] })(preflight, preflightRes, () => assert.fail('preflight deveria terminar'));
  assert.equal(preflightRes.statusCode, 204);
  assert.equal(preflightRes.headers['access-control-allow-methods'], 'GET');

  const post = request({ method: 'POST', requestId: 'request-safe-456' });
  const postRes = responseDouble();
  integrationApiBoundary()(post, postRes, () => assert.fail('POST não deveria continuar'));
  assert.equal(postRes.statusCode, 405);
  assert.equal(postRes.headers.allow, 'GET');

  const body = request({ headers: { 'content-length': '10' }, requestId: 'request-safe-789' });
  const bodyRes = responseDouble();
  integrationApiBoundary()(body, bodyRes, () => assert.fail('corpo não deveria continuar'));
  assert.equal(bodyRes.statusCode, 400);
});
