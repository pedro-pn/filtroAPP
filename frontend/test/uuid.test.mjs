import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { createUuid } from '../src/utils/uuid.ts';

test('UUID nativo preserva o receptor da API do navegador', () => {
  const api = { randomUUID() { assert.equal(this, api); return '42aab084-1f6f-4e84-bbca-3cf188738ff1'; },
    getRandomValues() { assert.fail('O caminho nativo está disponível'); } };
  assert.equal(createUuid(api), '42aab084-1f6f-4e84-bbca-3cf188738ff1');
});

test('sem randomUUID gera UUID v4 aceito pelo contrato de idempotência', () => {
  for (const fill of [0, 255]) {
    const api = { getRandomValues(bytes) { assert.equal(this, api); assert.equal(bytes.byteLength, 16); bytes.fill(fill); return bytes; } };
    const value = createUuid(api);
    assert.equal(z.uuidv4().safeParse(value).success, true);
    assert.equal(value, fill === 0 ? '00000000-0000-4000-8000-000000000000' : 'ffffffff-ffff-4fff-bfff-ffffffffffff');
  }
});

test('fallback usa novos bytes criptográficos a cada tentativa lógica', () => {
  let calls = 0;
  const api = { getRandomValues(bytes) { bytes.fill(++calls); return bytes; } };
  const first = createUuid(api), second = createUuid(api);
  assert.notEqual(first, second);
  assert.equal(calls, 2);
});

test('sem fonte criptográfica não emite identificador previsível', () => {
  assert.throws(() => createUuid({}), /geração segura de identificadores/);
});
