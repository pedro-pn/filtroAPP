import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';

import { z } from 'zod';

import { collectApiRoutes, routeKey } from '../src/lib/api-contract/inventory.js';
import { buildInternalOpenApi } from '../src/lib/api-contract/openapi.js';
import { defineRoute, isWriteMethod } from '../src/lib/api-contract/registry.js';

// Contrato da API interna (spec 042). As rotas reais do Express precisam estar
// no registro (defineRoute) ou na lista de rotas ainda não migradas, que só
// pode diminuir: ao migrar um domínio, remova as linhas dele e baixe o número.
const UNMIGRATED_ROUTES_BASELINE = 761;

const allowlistFile = new URL('../src/lib/api-contract/unmigrated-routes.json', import.meta.url);
const openApiFile = new URL('../../docs/api/openapi.internal.json', import.meta.url);
const allowlist = JSON.parse(fs.readFileSync(allowlistFile, 'utf8'));
const routes = await collectApiRoutes();
const byKey = new Map(routes.map(route => [routeKey(route), route]));

test('every internal API route has a contract or is listed as not migrated yet', () => {
  const listed = new Set(allowlist);
  const missing = routes.filter(route => !route.contract && !listed.has(routeKey(route))).map(routeKey);
  assert.deepEqual(missing, [], 'Rota nova sem contrato: declare-a com defineRoute (backend/src/lib/api-contract/registry.js)');
});

test('the not-migrated list only shrinks and has no stale entries', () => {
  assert.equal(new Set(allowlist).size, allowlist.length, 'Entrada repetida na lista de rotas não migradas');
  const stale = allowlist.filter(key => !byKey.has(key) || byKey.get(key).contract);
  assert.deepEqual(stale, [], 'Rota migrada ou removida continua na lista: tire-a de unmigrated-routes.json');
  assert.equal(allowlist.length, UNMIGRATED_ROUTES_BASELINE,
    'O tamanho da lista mudou: ao migrar rotas, baixe UNMIGRATED_ROUTES_BASELINE (ela nunca deve crescer)');
});

test('auth routes are fully migrated (phase 1)', () => {
  const authRoutes = routes.filter(route => route.path.startsWith('/api/auth/'));
  assert.ok(authRoutes.length >= 20, 'esperava as rotas de auth no inventário');
  assert.deepEqual(authRoutes.filter(route => !route.contract).map(routeKey), []);
});

test('every contracted write declares its body or the reason it has none', () => {
  const offenders = routes
    .filter(route => route.contract && isWriteMethod(route.method) && !route.contract.body && !route.contract.noBody)
    .map(routeKey);
  assert.deepEqual(offenders, []);
});

test('docs/api/openapi.internal.json is up to date', () => {
  const expected = `${JSON.stringify(buildInternalOpenApi(routes), null, 2)}\n`;
  assert.equal(fs.readFileSync(openApiFile, 'utf8'), expected, 'Rode `npm run contract:build` no backend e commite o arquivo');
});

test('the generated OpenAPI documents every contracted operation and the error envelope', () => {
  const document = buildInternalOpenApi(routes);
  assert.equal(document.openapi, '3.1.0');
  const login = document.paths['/api/auth/login'].post;
  assert.deepEqual(login.requestBody.content['application/json'].schema.required.sort(), ['password', 'username']);
  assert.equal(login.responses['401'].content['application/json'].schema.$ref, '#/components/schemas/Error');
  assert.deepEqual(document.components.schemas.Error.required, ['error', 'code', 'requestId']);
  assert.ok(document.paths['/api/auth/2fa/devices/{id}'].delete.parameters.some(param => param.name === 'id' && param.in === 'path'));
});

test('the contract build script works without a database', () => {
  const result = spawnSync(process.execPath, ['scripts/build-internal-openapi.js', '--check'], {
    cwd: new URL('..', import.meta.url).pathname,
    encoding: 'utf8',
    timeout: 60_000
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('defineRoute refuses incomplete contracts and validates input before the final handler', async () => {
  const { Router } = await import('express');
  const router = Router();
  const handler = () => {};
  assert.throws(() => defineRoute(router, { method: 'post', path: '/x', summary: 'x', auth: 'session', responses: { 200: null } }, handler), /noBody/);
  assert.throws(() => defineRoute(router, { method: 'get', path: '/x', summary: 'x', auth: 'nobody', responses: { 200: null } }, handler), /auth/);
  assert.throws(() => defineRoute(router, { method: 'get', path: 'x', summary: 'x', auth: 'public', responses: { 200: null } }, handler), /path/);

  const order = [];
  const body = z.object({ name: z.string().min(1) });
  defineRoute(router, { method: 'post', path: '/ok', summary: 'ok', auth: 'public', body, responses: { 200: null } },
    (_req, _res, next) => { order.push('limiter'); next(); },
    (req) => { order.push(`handler:${req.body.name}`); });
  const layer = router.stack.at(-1);
  const [limiter, validator, final] = layer.route.stack.map(entry => entry.handle);
  const req = { body: { name: 'Ana', extra: true }, params: {}, query: {} };
  limiter(req, {}, () => validator(req, {}, () => final(req)));
  assert.deepEqual(order, ['limiter', 'handler:Ana']);
  assert.deepEqual(req.body, { name: 'Ana' }, 'o corpo validado substitui o original');
  assert.throws(() => validator({ body: { name: '' }, params: {}, query: {} }, {}, () => {}), z.ZodError);
});
