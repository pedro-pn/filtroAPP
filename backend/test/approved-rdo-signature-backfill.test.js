import assert from 'node:assert/strict';
import test from 'node:test';

import prisma from '../src/lib/prisma.js';
import {
  ensureApprovedRdoSignatureRounds,
  reconcileProjectClientSignatureRequirements
} from '../src/routes/resources/reports.js';

function project(overrides = {}) {
  return {
    id: 'project-1', code: '5841', name: 'Projeto', isActive: true, managerOnly: false,
    clientName: 'Cliente', clientEmailPrimary: 'cliente@example.com', clientSigners: [],
    ...overrides
  };
}

function rdo(id, overrides = {}) {
  return {
    id, projectId: 'project-1', reportType: 'RDO', status: 'APPROVED', deletedAt: null,
    specialConditions: {}, clientReviews: [], versions: [], project: project(), ...overrides
  };
}

function stubFindMany(t, implementation) {
  const original = prisma.report.findMany;
  prisma.report.findMany = implementation;
  t.after(() => { prisma.report.findMany = original; });
}

test('RDO aprovado antes do cadastro do signatário ganha rodada, em ordem cronológica', async t => {
  const queries = [];
  stubFindMany(t, async args => { queries.push(args); return [rdo('rdo-1'), rdo('rdo-2')]; });
  const calls = [];
  const result = await ensureApprovedRdoSignatureRounds('project-1', {
    userId: 'manager-1', evidence: { ip: '1.1.1.1' },
    ensureRound: async (report, userId, evidence) => { calls.push([report.id, userId, evidence]); return { version: { id: `${report.id}-v1` } }; }
  });

  assert.deepEqual(result, { createdRounds: 2 });
  assert.deepEqual(calls, [['rdo-1', 'manager-1', { ip: '1.1.1.1' }], ['rdo-2', 'manager-1', { ip: '1.1.1.1' }]]);
  const where = queries[0].where;
  assert.equal(where.reportType, 'RDO');
  assert.equal(where.status, 'APPROVED');
  assert.equal(where.deletedAt, null);
  assert.equal(where.physicalSignedAt, null);
  assert.equal(where.zapsignDocToken, null);
  assert.deepEqual(where.versions, { none: { status: 'ACTIVE' } });
  assert.deepEqual(queries[0].orderBy, [{ reportDate: 'asc' }, { sequenceNumber: 'asc' }]);
});

test('sem signatário, projeto oculto ou rejeição ativa não cria rodada; falha de um não interrompe os demais', async t => {
  stubFindMany(t, async () => [
    rdo('sem-signatario', { project: project({ clientEmailPrimary: '' }) }),
    rdo('oculto', { project: project({ managerOnly: true }) }),
    rdo('falha'),
    rdo('ok')
  ]);
  const calls = [];
  const originalError = console.error;
  console.error = () => {};
  t.after(() => { console.error = originalError; });
  const result = await ensureApprovedRdoSignatureRounds('project-1', {
    ensureRound: async report => {
      calls.push(report.id);
      if (report.id === 'falha') throw new Error('PDF indisponível');
      return { version: { id: 'v1' } };
    }
  });
  assert.deepEqual(calls, ['falha', 'ok']);
  assert.deepEqual(result, { createdRounds: 1 });
});

test('reconciliação só procura RDOs sem rodada quando pedida explicitamente', async t => {
  const queries = [];
  stubFindMany(t, async args => { queries.push(args.where); return []; });
  const ensureRound = async () => { throw new Error('não deveria criar rodada'); };

  assert.deepEqual(await reconcileProjectClientSignatureRequirements('project-1', { ensureRound }),
    { updatedReports: 0, finalizedReports: 0, createdRounds: 0 });
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].versions, { some: { status: 'ACTIVE' } });

  await reconcileProjectClientSignatureRequirements('project-1', { ensureRound, includeApprovedWithoutRound: true });
  assert.equal(queries.length, 3);
  assert.deepEqual(queries[2].versions, { none: { status: 'ACTIVE' } });
});
