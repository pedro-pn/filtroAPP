import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getProjectInvoices, getMissionGroupInvoices } from '../src/lib/acompanhamento/project-invoices.js';

function database({ project = { id: 'p1', code: '5800', name: 'Reframax', clientCnpj: '11.111.111/0001-11' }, run = 'SUCCESS', synced = true } = {}) {
  const calls = [];
  return { calls, db: {
    project: { findFirst: async args => { calls.push(args); return project; } },
    omieProject: { findMany: async args => { calls.push(args); return [{ codigo: '30', projectId: 'p1' }]; } },
    omieInvoice: { findMany: async args => {
      calls.push(args);
      return [{ id: 'NFSE:10', source: 'NFSE', codigoProjeto: '30', numero: '10', serie: null,
        dataEmissao: new Date('2026-07-03T00:00:00Z'), valor: '770355.60', clienteNome: 'Companhia Siderúrgica',
        clienteCnpj: '22.222.222/0001-22', receiptStatus: 'RECEIVED', installmentCount: 1 }];
    } },
    integrationSyncRun: { findFirst: async args => args.where.status
      ? synced ? { finishedAt: new Date('2026-09-09T10:00:00Z') } : null
      : run ? { status: run } : null }
  } };
}

test('consulta isola a missão pelo vínculo Omie e explicita tomador diferente', async () => {
  const { db, calls } = database();
  const result = await getProjectInvoices('p1', { db });
  assert.equal(result.count, 1);
  assert.equal(result.total, 770355.60);
  assert.equal(result.invoices[0].customerDiffers, true);
  assert.equal(result.invoices[0].project.code, '5800');
  assert.deepEqual(calls[0].where, { id: 'p1', deletedAt: null, managerOnly: false });
  assert.deepEqual(calls[1].where.project, { deletedAt: null, managerOnly: false });
  assert.deepEqual(calls[2].where, { codigoProjeto: { in: ['30'] } });
  assert.equal(result.syncStatus, 'READY');
});

test('projeto inexistente, excluído ou oculto não consulta notas', async () => {
  const { db, calls } = database({ project: null });
  assert.equal(await getProjectInvoices('deleted', { db }), null);
  assert.equal(calls.length, 1);
});

test('ausência de vínculo não retorna notas de outras missões', async () => {
  const { db } = database();
  db.omieProject.findMany = async () => [];
  db.omieInvoice.findMany = async () => assert.fail('não deve consultar todas as notas');
  const result = await getProjectInvoices('p1', { db });
  assert.equal(result.linkedProjectCount, 0);
  assert.equal(result.count, 0);
});

test('ausência de histórico, atualização e falha ficam distintas de zero faturado', async () => {
  for (const [run, synced, expected] of [[null, false, 'WAITING'], ['RUNNING', false, 'UPDATING'], ['ERROR', false, 'ERROR'], ['ERROR', true, 'STALE']]) {
    const { db } = database({ run, synced });
    const result = await getProjectInvoices('p1', { db });
    assert.equal(result.syncStatus, expected);
    assert.equal(Boolean(result.lastSyncedAt), synced);
  }
});

test('grupo consulta membros visíveis ativos sem duplicar e mantém identificação da missão', async () => {
  const { db, calls } = database();
  db.acompanhamentoMissionGroup = { findUnique: async args => {
    assert.equal(args.include.members.where.project.managerOnly, false);
    return { status: 'ACTIVE', members: [
      { projectId: 'p1', project: { id: 'p1', code: '5800', name: 'Reframax' } },
      { projectId: 'p1', project: { id: 'p1', code: '5800', name: 'Reframax' } },
      { projectId: 'deleted', project: { deletedAt: new Date() } }
    ] };
  } };
  const result = await getMissionGroupInvoices('g1', { db });
  assert.equal(result.projectCount, 1);
  assert.equal(result.invoices[0].project.code, '5800');
  assert.deepEqual(calls[0].where.projectId.in, ['p1']);
});
