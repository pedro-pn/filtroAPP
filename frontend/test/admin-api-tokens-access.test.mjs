import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');

test('/admin/tokens is registered only for ADMIN and remains a direct route after refresh', async () => {
  const [registry, routes] = await Promise.all([
    source('../shared/modules/registry.json'),
    source('src/modules/moduleRoutes.tsx')
  ]);
  assert.match(registry, /"tokens": "\/admin\/tokens"[\s\S]*?"tokens"[\s\S]*?"allowedAccountTypes": \[\s*"ADMIN"\s*\]/);
  assert.match(routes, /path="\/admin\/tokens"/);
  assert.match(routes, /allowedAccountTypes=\{\['ADMIN'\]\}/);
  assert.doesNotMatch(routes, /isHubAdmin[^\n]*AdminTokensPage/);
});
