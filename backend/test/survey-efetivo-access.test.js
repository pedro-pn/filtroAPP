import assert from 'node:assert/strict';
import test from 'node:test';

import prisma from '../src/lib/prisma.js';
import { requireProjectSurveySender } from '../src/routes/resources/surveys.js';

test('envio no Efetivo permite responsáveis pelo encerramento e preserva a restrição por projeto', async t => {
  const original = prisma.project.findFirst;
  t.after(() => { prisma.project.findFirst = original; });
  let project = {
    workflow: { stage: 'FINISHED', leaderUserId: 'leader', plannerUserId: 'planner' },
    efetivoMissionPlans: []
  };
  let queries = 0;
  prisma.project.findFirst = async ({ where }) => {
    queries += 1;
    assert.equal(where.id, 'project-1');
    assert.equal(where.isActive, false);
    assert.equal(where.deletedAt, null);
    assert.ok(where.AND.length, 'respeita a distribuição do projeto para o Efetivo');
    return project;
  };
  async function allowed(id, moduleRoles, accountType = 'INTERNAL') {
    let passed = false;
    let status = 200;
    const res = { status(code) { status = code; return this; }, json() {} };
    await requireProjectSurveySender({ auth: { user: { id, moduleRoles, accountType } }, params: { projectId: 'project-1' } }, res, () => { passed = true; });
    assert.equal(status, passed ? 200 : 403);
    return passed;
  }
  assert.equal(await allowed('leader', ['efetivo:viewer']), true);
  assert.equal(await allowed('planner', ['efetivo:viewer']), true);
  assert.equal(await allowed('manager', ['efetivo:manager']), true);
  assert.equal(await allowed('unrelated', ['efetivo:viewer']), false);
  assert.equal(await allowed('leader', ['efetivo:commercial']), false);
  assert.equal(await allowed('leader', []), false);
  project.workflow.stage = 'FINAL_MEASUREMENT';
  project.efetivoMissionPlans = [{ id: 'old-finished-mission' }];
  assert.equal(await allowed('leader', ['efetivo:viewer']), false);
  assert.equal(await allowed('manager', ['efetivo:manager']), false);
  project.workflow = null;
  assert.equal(await allowed('manager', ['efetivo:manager']), true, 'missão antiga encerrada');
  assert.equal(await allowed('leader', ['efetivo:viewer']), false);
  project = null;
  assert.equal(await allowed('manager', ['efetivo:manager']), false, 'projeto indisponível');
  const before = queries;
  assert.equal(await allowed('admin', ['rdo:manager'], 'ADMIN'), true);
  assert.equal(queries, before, 'preserva o acesso existente de Relatórios');
});
