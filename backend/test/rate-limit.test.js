import assert from 'node:assert/strict';
import test from 'node:test';

import { createMemoryRateLimit } from '../src/lib/rate-limit.js';

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function runLimiter(limiter, req) {
  const res = mockResponse();
  let nextCalled = false;
  limiter(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

function signatureRequest(token, routePath = '/public-sign/:token') {
  return {
    ip: '203.0.113.10',
    originalUrl: `/public-sign/${token}`,
    url: `/public-sign/${token}`,
    path: `/public-sign/${token}`,
    baseUrl: '',
    route: { path: routePath }
  };
}

test('memory rate limit keys route templates instead of secret public tokens', () => {
  const limiter = createMemoryRateLimit({
    windowMs: 60_000,
    max: 2,
    message: 'limitado'
  });

  assert.equal(runLimiter(limiter, signatureRequest('token-a')).nextCalled, true);
  assert.equal(runLimiter(limiter, signatureRequest('token-b')).nextCalled, true);

  const blocked = runLimiter(limiter, signatureRequest('token-c'));
  assert.equal(blocked.nextCalled, false);
  assert.equal(blocked.res.statusCode, 429);
  assert.deepEqual(blocked.res.body, { error: 'limitado' });
});

test('memory rate limit evicts oldest keys after the configured cap', () => {
  const limiter = createMemoryRateLimit({
    windowMs: 60_000,
    max: 1,
    maxKeys: 2
  });

  assert.equal(runLimiter(limiter, signatureRequest('a', '/route-a/:token')).nextCalled, true);
  assert.equal(runLimiter(limiter, signatureRequest('b', '/route-b/:token')).nextCalled, true);
  assert.equal(runLimiter(limiter, signatureRequest('c', '/route-c/:token')).nextCalled, true);

  const evictedKeyCanStartAgain = runLimiter(limiter, signatureRequest('a2', '/route-a/:token'));
  assert.equal(evictedKeyCanStartAgain.nextCalled, true);
});
