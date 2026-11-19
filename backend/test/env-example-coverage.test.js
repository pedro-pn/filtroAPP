import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// Pilar 13.3: toda variável que o backend lê precisa aparecer em backend/.env.example
// (pode estar comentada), com o nome e um comentário do que faz — nunca o valor real.
const backendDir = path.resolve(new URL('..', import.meta.url).pathname);
const read = file => fs.readFileSync(path.join(backendDir, file), 'utf8');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

function keysReadByBackend() {
  const keys = new Set();
  const schema = read('src/config/env.js');
  for (const match of schema.matchAll(/^\s+([A-Z][A-Z0-9_]+):/gm)) keys.add(match[1]);
  for (const file of walk(path.join(backendDir, 'src'))) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) keys.add(match[1]);
  }
  return keys;
}

function keysDocumentedInExample() {
  const keys = new Set();
  for (const match of read('.env.example').matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)) keys.add(match[1]);
  return keys;
}

test('every env var read by the backend is documented in backend/.env.example', () => {
  const documented = keysDocumentedInExample();
  const missing = [...keysReadByBackend()].filter(key => !documented.has(key)).sort();
  assert.deepEqual(missing, [], `Documente em backend/.env.example (pode ser comentada): ${missing.join(', ')}`);
});

test('the coverage check really sees the env schema', () => {
  const keys = keysReadByBackend();
  for (const key of ['DATABASE_URL', 'ALLOWED_ORIGIN', 'TRUST_PROXY', 'WORKER_HEALTH_FILE']) assert.ok(keys.has(key), key);
});
