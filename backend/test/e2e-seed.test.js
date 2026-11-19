import assert from 'node:assert/strict';
import test from 'node:test';

import { assertDisposableDatabase, E2E_ACCOUNTS } from '../prisma/e2e-seed.js';

// O seed dos testes ponta a ponta (spec 040) só roda em banco descartável.
test('e2e-seed recusa bancos que não terminam em _e2e', () => {
  assert.equal(assertDisposableDatabase('postgresql://u:p@localhost:5432/filtrovali_e2e'), 'filtrovali_e2e');
  for (const url of [
    'postgresql://u:p@localhost:5432/filtrovali',
    'postgresql://u:p@localhost:5432/filtrovali_test',
    'postgresql://u:p@localhost:5432/filtrovali_e2e_old',
    'não é url'
  ]) {
    assert.throws(() => assertDisposableDatabase(url), /banco descartável/);
  }
});

test('contas do seed e2e são fictícias e com senha de pelo menos 10 caracteres', () => {
  for (const account of Object.values(E2E_ACCOUNTS)) {
    assert.match(account.email, /@e2e\.test$/);
    assert.ok(account.password.length >= 10, account.username);
  }
});
