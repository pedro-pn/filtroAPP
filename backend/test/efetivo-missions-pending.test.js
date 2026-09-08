import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { listPendingMissionProjects } from '../src/lib/efetivo/planning/read-model.js';

function fakeDatabase({ plan = null, onFindMany = () => [] } = {}) {
  const created = [];
  return {
    created,
    efetivoPlan: {
      findFirst: async () => plan,
      findUnique: async ({ where }) => (plan && plan.id === where.id ? plan : null),
      create: async data => { created.push(data); return { id: 'novo', ...data.data }; }
    },
    project: { findMany: async args => onFindMany(args) }
  };
}

test('projetos ativos sem programação no plano viram missões pendentes', async () => {
  let received = null;
  const database = fakeDatabase({
    plan: { id: 'plan-1', kind: 'OFFICIAL', status: 'ACTIVE' },
    onFindMany: args => { received = args; return [{ id: 'p1', code: '0001', name: 'Missão A' }]; }
  });
  const rows = await listPendingMissionProjects({}, { database });
  assert.deepEqual(rows, [{ id: 'p1', code: '0001', name: 'Missão A' }]);
  assert.equal(received.where.isActive, true);
  assert.equal(received.where.deletedAt, null);
  assert.deepEqual(received.where.efetivoMissionPlans, { none: { planId: 'plan-1', deletedAt: null } });
  assert.ok(received.select.mobilizationDate && received.select.startDate);
});

test('leitura de pendências não cria plano oficial e lista tudo quando não há plano', async () => {
  let received = null;
  const database = fakeDatabase({ plan: null, onFindMany: args => { received = args; return []; } });
  await listPendingMissionProjects({}, { database });
  assert.equal(database.created.length, 0);
  assert.equal('efetivoMissionPlans' in received.where, false);
});

test('lista todos os projetos pendentes sem truncar após duzentos registros', async () => {
  const projects = Array.from({ length: 201 }, (_, index) => ({
    id: `p${index + 1}`,
    code: String(index + 1).padStart(4, '0'),
    name: `Projeto ${index + 1}`
  }));
  let received = null;
  const database = fakeDatabase({
    plan: { id: 'plan-1', kind: 'OFFICIAL', status: 'ACTIVE' },
    onFindMany: args => {
      received = args;
      return projects.slice(0, args.take ?? projects.length);
    }
  });

  const rows = await listPendingMissionProjects({}, { database });

  assert.equal(rows.length, 201);
  assert.equal(received.take, undefined);
});

test('rota de pendentes precede a rota por id da missão', () => {
  const routes = fs.readFileSync(new URL('../src/routes/efetivo-planning.js', import.meta.url), 'utf8');
  assert.ok(routes.indexOf("'/missions/pending'") < routes.indexOf("'/missions/:missionId'"));
});

test('contrato documenta a origem das missões pendentes', () => {
  const contract = fs.readFileSync(new URL('../../specs/012-planejamento-efetivo/contracts/efetivo-planning.openapi.yaml', import.meta.url), 'utf8');
  assert.ok(contract.includes('/planning/missions/pending:'));
  assert.ok(contract.includes('PendingMissionProject:'));
});
