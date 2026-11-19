import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// Pilar 6.5: produção e homologação precisam enviar o mesmo conjunto de
// cabeçalhos de segurança, e nenhum location pode perdê-los pelo comportamento
// do nginx (add_header num location descarta os herdados do server).

const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const SAME_VALUE = [
  'Content-Security-Policy',
  'X-Content-Type-Options',
  'X-Frame-Options',
  'Referrer-Policy',
  'Permissions-Policy'
];

function serverBody(text) {
  const start = text.indexOf('server {');
  assert.ok(start >= 0, 'server block must exist');
  return text.slice(start);
}

function headerMap(text) {
  const headers = new Map();
  for (const match of text.matchAll(/^\s*add_header\s+(\S+)\s+("[^"]*"|\S+)\s+always;/gm)) {
    headers.set(match[1], match[2]);
  }
  return headers;
}

function serverLevelHeaders(text) {
  const body = serverBody(text);
  return headerMap(body.slice(0, body.indexOf('\n  location ')));
}

function locations(text) {
  const body = serverBody(text);
  const result = [];
  for (const match of body.matchAll(/\n  location ([^{]+)\{/g)) {
    const start = match.index;
    const end = body.indexOf('\n  }', start);
    result.push({ name: match[1].trim(), body: body.slice(start, end) });
  }
  return result;
}

const prod = read('deploy/nginx/default.conf');
const staging = read('deploy/nginx/staging.conf');

test('staging sends the same security headers as production at server level', () => {
  const prodHeaders = serverLevelHeaders(prod);
  const stagingHeaders = serverLevelHeaders(staging);
  for (const name of SAME_VALUE) {
    assert.ok(prodHeaders.has(name), `production must send ${name}`);
    assert.equal(stagingHeaders.get(name), prodHeaders.get(name), `staging ${name} differs from production`);
  }
});

test('both environments send HSTS of at least one year; only production asks for preload', () => {
  for (const [name, text] of [['production', prod], ['staging', staging]]) {
    const hsts = serverLevelHeaders(text).get('Strict-Transport-Security') || '';
    const maxAge = Number(/max-age=(\d+)/.exec(hsts)?.[1] || 0);
    assert.ok(maxAge >= 31536000, `${name}: HSTS max-age must be >= 1 year (got "${hsts}")`);
  }
  assert.doesNotMatch(serverLevelHeaders(staging).get('Strict-Transport-Security'), /preload/);
});

test('any location that sets its own add_header repeats every server security header', () => {
  for (const [name, text] of [['production', prod], ['staging', staging]]) {
    const server = serverLevelHeaders(text);
    for (const location of locations(text)) {
      const own = headerMap(location.body);
      if (!own.size) continue;
      for (const header of [...SAME_VALUE, 'Strict-Transport-Security']) {
        assert.equal(own.get(header), server.get(header), `${name} location ${location.name}: ${header} must be repeated`);
      }
    }
  }
});
