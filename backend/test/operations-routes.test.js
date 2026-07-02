import assert from 'node:assert/strict';
import { PassThrough, Readable, Writable } from 'node:stream';
import test from 'node:test';

import app from '../src/app.js';

function dispatchApp(method, pathName, body, remoteAddress = '198.51.100.10', headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = new Readable({
      read() {
        if (payload) this.push(payload);
        this.push(null);
      }
    });
    req.method = method;
    req.url = pathName;
    req.headers = {
      host: '127.0.0.1',
      ...(payload ? {
        'content-type': 'application/json',
        'content-length': String(payload.length)
      } : {}),
      ...headers
    };
    req.socket = new PassThrough();
    req.socket.remoteAddress = remoteAddress;
    req.socket.encrypted = false;
    req.connection = req.socket;

    const chunks = [];
    const responseHeaders = new Map();
    const res = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      }
    });
    res.statusCode = 200;
    res.setHeader = (name, value) => responseHeaders.set(String(name).toLowerCase(), value);
    res.getHeader = name => responseHeaders.get(String(name).toLowerCase());
    res.getHeaders = () => Object.fromEntries(responseHeaders);
    res.removeHeader = name => responseHeaders.delete(String(name).toLowerCase());
    res.writeHead = (statusCode, headersToSet = {}) => {
      res.statusCode = statusCode;
      Object.entries(headersToSet).forEach(([name, value]) => res.setHeader(name, value));
      return res;
    };
    res.end = (chunk, encoding, callback) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      Writable.prototype.end.call(res, callback);
      const rawBody = Buffer.concat(chunks).toString('utf8');
      resolve({ statusCode: res.statusCode, body: rawBody, json: rawBody ? JSON.parse(rawBody) : null });
      return res;
    };

    app.handle(req, res, reject);
  });
}

test('POST /operations/client-errors accepts public frontend error reports', async () => {
  const response = await dispatchApp('POST', '/api/operations/client-errors', {
    message: 'Erro no cliente',
    source: 'frontend.test',
    url: 'https://app.example.test/rdo',
    userAgent: 'Unit Test Browser'
  });

  assert.equal(response.statusCode, 202);
  assert.equal(response.json.accepted, true);
  assert.equal(response.json.sent, false);
});

test('POST /operations/client-errors validates payload', async () => {
  const response = await dispatchApp('POST', '/api/operations/client-errors', {
    message: ''
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json.error, /Dados inválidos/);
});
