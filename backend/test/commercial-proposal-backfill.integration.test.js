import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import prisma from '../src/lib/prisma.js';

test('migração completa apenas buscas antigas de projetos ativos e não encerrados', {
  skip: !process.env.TEST_DATABASE_URL
}, async t => {
  assert.equal(process.env.DATABASE_URL, process.env.TEST_DATABASE_URL);
  assert.equal(new URL(process.env.TEST_DATABASE_URL).pathname, '/filtroapp_bridge_test');
  const projects = [];
  const leader = await prisma.user.create({ data: {
    username: `backfill-${randomUUID()}`, name: 'Gestor QA', passwordHash: 'synthetic', role: 'MANAGER'
  } });
  t.after(async () => {
    await prisma.projectWorkflow.deleteMany({ where: { projectId: { in: projects.map(project => project.id) } } });
    await prisma.project.deleteMany({ where: { id: { in: projects.map(project => project.id) } } });
    await prisma.user.delete({ where: { id: leader.id } });
    await prisma.$disconnect();
  });
  const state = { requestId: randomUUID(), status: 'SYNCED', proposalCode: '4638', revisionNumber: 0 };
  for (const kind of ['legacy', 'inactive', 'finished', 'complete', 'without-request']) {
    projects.push(await prisma.project.create({ data: {
      code: `BACKFILL-${kind}-${randomUUID()}`, name: 'Projeto sintético',
      clientName: 'Cliente QA', clientCnpj: '', contractCode: '4638', location: 'Sede',
      isActive: kind !== 'inactive',
      commercialProposalSync: kind === 'without-request' ? undefined
        : { ...state, ...(kind === 'complete' ? { commercialDataVersion: 1 } : {}) },
      ...(kind === 'finished' ? { workflow: { create: { stage: 'FINISHED', leaderUserId: leader.id } } } : {})
    } }));
  }
  const migration = await readFile(new URL('../prisma/migrations/20261013190000_commercialapp_complete_proposal/migration.sql', import.meta.url), 'utf8');
  await prisma.$executeRawUnsafe(migration.slice(migration.indexOf('UPDATE "Project" p')));
  for (const [index, project] of projects.entries()) {
    const current = await prisma.project.findUnique({ where: { id: project.id } });
    assert.equal(current.commercialProposalSync?.status, index === 0 ? 'PENDING' : index === 4 ? undefined : 'SYNCED');
    assert.equal(Boolean(current.commercialProposalSyncNextAttemptAt), index === 0);
  }
  await prisma.project.update({ where: { id: projects[0].id }, data: {
    commercialProposalSync: { ...state, commercialDataVersion: 1 }, commercialProposalSyncNextAttemptAt: null
  } });
  await prisma.$executeRawUnsafe(migration.slice(migration.indexOf('UPDATE "Project" p')));
  assert.equal((await prisma.project.findUnique({ where: { id: projects[0].id } })).commercialProposalSync.status, 'SYNCED');
});
