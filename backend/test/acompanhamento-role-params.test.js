import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRoleParamsResolver, getRoleParamsResolver } from '../src/lib/acompanhamento/labor-cost.js';

test('catálogo único preserva modelos, vigências, desempates, cargo sem perfil e leitura após alteração', async () => {
  const sets = [
    { version: 1, effectiveDate: '2026-01-01', params: { salarioBase: 3000, baseModel: 'operador' } },
    { version: 2, effectiveDate: '2026-09-10', params: { salarioBase: 4000, baseModel: 'offshore' } },
    { version: 3, effectiveDate: '2026-09-10', params: { salarioBase: 4100, baseModel: 'offshore' } }
  ];
  const defaultSets = [
    { version: 1, effectiveDate: '2026-01-01', params: { salarioBase: 1000, transferenciaPct: .3 } },
    { version: 2, effectiveDate: '2026-09-15', params: { salarioBase: 1200, transferenciaPct: .4 } }
  ];
  const offshoreSets = [{ version: 1, effectiveDate: '2026-01-01', params: { salarioBase: 2000, confinamentoPct: .5 } }];
  const fallbackSets = [{ version: 1, effectiveDate: '2026-01-01', params: { salarioBase: 3500, baseModel: 'missing' } }];
  const roles = [{ id: 'r1', name: 'Operadora' }, { id: 'r2', name: 'Supervisor' }, { id: 'r3', name: 'Sem perfil' }, { id: 'r4', name: 'Sem parâmetros' }];
  const models = [{ key: 'empty', jobRoleId: null, parameterSets: [] },
    { key: 'operador', jobRoleId: null, parameterSets: defaultSets },
    { key: 'offshore', jobRoleId: null, parameterSets: offshoreSets }];
  const profiles = [
    { key: 'role-r1', jobRoleId: 'r1', parameterSets: sets }, ...models,
    { key: 'role-r2', jobRoleId: 'r2', parameterSets: fallbackSets },
    { key: 'role-r4', jobRoleId: 'r4', parameterSets: [] }
  ];
  const legacy = buildRoleParamsResolver({ models, roles: [
    { name: 'Operadora', costProfile: { parameterSets: sets } },
    { name: 'Supervisor', costProfile: { parameterSets: fallbackSets } },
    { name: 'Sem perfil', costProfile: null },
    { name: 'Sem parâmetros', costProfile: { parameterSets: [] } }
  ] });
  let roleReads = 0, catalogReads = 0;
  const database = {
    jobRole: { findMany: async () => { roleReads++; return roles; } },
    costProfile: { findMany: async () => { catalogReads++; return profiles; } }
  };
  const current = await getRoleParamsResolver(database);
  assert.equal(roleReads, 1);
  assert.equal(catalogReads, 1);
  for (const role of [...roles.map(role => role.name), 'Desconhecido']) {
    assert.equal(current.hasProfile(role), legacy.hasProfile(role));
    assert.deepEqual(current.segmentsFor(role, '2026-09-01', '2026-09-30'), legacy.segmentsFor(role, '2026-09-01', '2026-09-30'));
    for (const date of ['2025-12-31', '2026-01-01', '2026-09-09', '2026-09-10', '2026-09-15']) {
      assert.deepEqual(current.paramsFor(role, date), legacy.paramsFor(role, date));
    }
  }
  assert.equal(current.paramsFor('Operadora', '2026-09-10').salarioBase, 4100);
  sets.push({ version: 4, effectiveDate: '2026-09-20', params: { salarioBase: 5000 } });
  const refreshed = await getRoleParamsResolver(database);
  assert.equal(refreshed.paramsFor('Operadora', '2026-09-20').salarioBase, 5000);
  assert.equal(current.paramsFor('Operadora', '2026-09-20').salarioBase, 4100);
  assert.equal(catalogReads, 2);
});

test('falha no catálogo rejeita a leitura e a próxima consulta pode recuperar', async () => {
  let fail = true;
  const database = {
    jobRole: { findMany: async () => [] },
    costProfile: { findMany: async () => { if (fail) throw new Error('catalog unavailable'); return []; } }
  };
  await assert.rejects(getRoleParamsResolver(database), /catalog unavailable/);
  fail = false;
  assert.equal((await getRoleParamsResolver(database)).paramsFor('Operadora', '2026-09-01'), null);
});
