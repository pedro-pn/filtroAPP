import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeSnapshot } from '../src/lib/efetivo/planning/audit.js';

test('auditoria remove segredos de snapshots aninhados', () => {
  assert.deepEqual(sanitizeSnapshot({ name: 'Ana', token: 'secret', nested: { passwordHash: 'x', role: 'Operador' } }), { name: 'Ana', nested: { role: 'Operador' } });
});

test('auditoria converte objetos Prisma serializáveis sem copiar funções internas', () => {
  const decimal = {
    constructor: function Decimal() {},
    s: 1,
    e: 1,
    d: [80],
    toJSON: () => '80'
  };
  const snapshot = sanitizeSnapshot({ project: { manualProgressPct: decimal }, internal: () => 'não serializar' });
  assert.deepEqual(snapshot, { project: { manualProgressPct: '80' } });
  assert.doesNotThrow(() => JSON.stringify(snapshot));
});
