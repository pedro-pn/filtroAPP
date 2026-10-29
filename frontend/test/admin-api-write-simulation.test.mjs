import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { createServer } from 'vite';
import { makePlaygroundParameterSchema, playgroundParameterDefaults, buildPlaygroundInput } from '../../shared/schemas/playground-parameters.js';
import { publicApiOperations } from '../../backend/src/lib/api-credentials/catalog.js';
import { redactedRequestPreview } from '../src/components/admin/api-tokens/apiRequestFormatting.ts';
import { rotationDefaults } from '../../shared/schemas/api-credential-lifecycle.js';

test('todas as escritas do Playground começam simuladas; LIVE é explícito e não vira query/header livre', () => {
  for (const operation of publicApiOperations().filter(item => item.method === 'POST')) {
    const values = playgroundParameterDefaults(operation);
    assert.equal(values.writeMode, 'SIMULATE');
    const fill = Object.fromEntries(operation.parameters.filter(field => field.required).map(field => [field.name,
      field.in === 'header' ? '6d655c60-2dc0-4d56-98c3-7349fc19612e' : 'project-existing']));
    const schema = makePlaygroundParameterSchema(z, operation.parameters, { method: 'POST' });
    const parsed = schema.parse({ ...values, ...fill });
    assert.equal(buildPlaygroundInput(operation, parsed).writeMode, 'SIMULATE');
    const real = buildPlaygroundInput(operation, schema.parse({ ...parsed, writeMode: 'LIVE' }));
    assert.equal(real.writeMode, 'LIVE'); assert.equal('writeMode' in real.query, false);
    assert.equal(schema.safeParse({ ...parsed, writeMode: 'invalid' }).success, false);
  }
});

test('cURL exibido e copiado mantém Prefer para simulação, junto com Idempotency-Key', () => {
  const result = { request: { method: 'POST', path: '/api/integracoes/v1/qualidade/registros', authorization: 'Bearer ••••test',
    body: { description: "Exemplo ' fictício" }, curl: 'não confiar no cURL recebido',
    headers: { Prefer: 'validate-only', 'Idempotency-Key': '6d655c60-2dc0-4d56-98c3-7349fc19612e' } }, response: { status: 200, body: { simulated: true } } };
  const preview = redactedRequestPreview(result);
  assert.match(preview.curl, /-H "Prefer: validate-only"/);
  assert.match(preview.curl, /-H "Idempotency-Key: 6d655c60-2dc0-4d56-98c3-7349fc19612e"/);
  delete result.request.headers.Prefer;
  assert.doesNotMatch(redactedRequestPreview(result).curl, /Prefer:/);
});

test('rotação do formulário preserva SIMULATE ao acrescentar escopos', () => {
  const result = rotationDefaults({ writeMode: 'SIMULATE', name: 'Omni', scopeCodes: ['eventos.read'],
    projectAccess: { mode: 'ALL', projectIds: [] }, allowedIpCidrs: [], limits: {} });
  result.scopeCodes.push('qualidade.registros.create');
  assert.equal(result.writeMode, 'SIMULATE'); assert.ok(result.scopeCodes.includes('qualidade.registros.create'));
});

test('novidade expira globalmente após dez dias no fuso corporativo', async t => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  t.after(() => server.close());
  const module = await server.ssrLoadModule('/src/pages/admin/apiWriteSimulationNovelty.ts');
  const start = Date.parse(module.API_WRITE_SIMULATION_LAUNCHED_AT), end = Date.parse(module.API_WRITE_SIMULATION_EXPIRES_AT);
  assert.equal(end - start, 10 * 86400000); assert.equal(new Date(start).toISOString(), '2026-10-29T03:00:00.000Z');
  assert.equal(module.isApiWriteSimulationNoveltyActive(start - 1), false);
  assert.equal(module.isApiWriteSimulationNoveltyActive(start), true);
  assert.equal(module.isApiWriteSimulationNoveltyActive(end - 1), true);
  assert.equal(module.isApiWriteSimulationNoveltyActive(end), false);
});
