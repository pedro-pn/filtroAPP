import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const conf = read('deploy/nginx/default.conf');

function serverHeaders(text) {
  // Cabeçalhos do bloco server (antes do primeiro location).
  const serverBody = text.slice(text.indexOf('server {'), text.indexOf('  location '));
  return headerMap(serverBody);
}

function headerMap(text) {
  const headers = new Map();
  for (const match of text.matchAll(/^\s*add_header\s+(\S+)\s+("[^"]*"|\S+)\s+always;/gm)) {
    headers.set(match[1], match[2]);
  }
  return headers;
}

function locationBody(text, name) {
  const start = text.indexOf(`location = ${name} {`);
  assert.ok(start >= 0, `location ${name} must exist`);
  return text.slice(start, text.indexOf('\n  }', start));
}

test('maintenance responses repeat every server security header (add_header is not inherited)', () => {
  const server = serverHeaders(conf);
  assert.ok(server.has('Content-Security-Policy') && server.has('Strict-Transport-Security'));
  for (const location of ['/__maintenance/index.html', '/__maintenance/api.json']) {
    const body = locationBody(conf, location);
    assert.match(body, /\n\s+internal;/, `${location} must be internal`);
    const headers = headerMap(body);
    for (const [name, value] of server) {
      if (name === 'Cache-Control') continue;
      assert.equal(headers.get(name), value, `${location}: ${name} differs from the server block`);
    }
    assert.equal(headers.get('Cache-Control'), '"no-store"');
    assert.ok(headers.has('Retry-After'));
  }
});

test('maintenance flag is checked per request and internal checks bypass it', () => {
  assert.match(conf, /if \(-f \/maintenance\/on\)/);
  assert.match(conf, /if \(\$realip_remote_addr = 127\.0\.0\.1\)/, 'deploy-prod.sh and the Docker healthcheck use 127.0.0.1');
  const bypass = conf.match(/if \(\$uri ~ (\S+)\) \{\s+set \$maintenance "";/);
  assert.ok(bypass, 'uri bypass must exist');
  for (const uri of ['/nginx-health', '/assets/Logo/LOGO_LOGIN.png', '/__maintenance/index.html']) {
    assert.match(uri, new RegExp(bypass[1].replace(/\$$/, '$')), `${uri} must bypass maintenance`);
  }
  for (const uri of ['/', '/api/reports', '/uploads/x.png', '/app-version.json', '/health']) {
    assert.doesNotMatch(uri, new RegExp(bypass[1]), `${uri} must be blocked during maintenance`);
  }
  assert.match(conf, /error_page 503 \$maintenance_page;/);
  assert.match(conf, /~\^\/api\(\/\|\$\)\s+\/__maintenance\/api\.json;/);
});

test('maintenance page and flag dir are mounted from the host so rollback images also have them', () => {
  const compose = read('docker-compose.prod.yml');
  const nginx = compose.slice(compose.indexOf('\n  nginx:'));
  assert.match(nginx, /- \.\/deploy\/nginx\/maintenance:\/usr\/share\/nginx\/maintenance:ro/);
  assert.match(nginx, /- \$\{MAINTENANCE_DIR:-\/root\/backups\/filtrovali\/maintenance\}:\/maintenance:ro/);
  const body = JSON.parse(read('deploy/nginx/maintenance/api.json'));
  assert.equal(body.code, 'MAINTENANCE');
  assert.ok(body.error.length > 10);
  const html = read('deploy/nginx/maintenance/index.html');
  assert.match(html, /<html lang="pt-BR">/);
  assert.doesNotMatch(html, /<script/i, 'CSP script-src self: the page must not need scripts');
});
