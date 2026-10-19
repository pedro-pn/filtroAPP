import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';

import { createPrismaClient } from '../src/lib/prisma.js';
import { saveRdoDraft } from '../src/routes/resources/drafts.js';

const databaseUrl = process.env.DRAFTS_TEST_DATABASE_URL;

test('PostgreSQL serializes repeated draft creation across independent connections', {
  skip: !databaseUrl
}, async t => {
  const url = new URL(databaseUrl);
  assert.match(url.hostname, /^(localhost|127\.0\.0\.1)$/);
  assert.ok(url.pathname.endsWith('_test') || (process.env.CI === 'true' && url.pathname === '/filtrovali'));
  const database = createPrismaClient({ pool: new pg.Pool({ connectionString: databaseUrl, max: 6 }) });
  const suffix = randomUUID();
  let user, project;
  t.after(async () => {
    try {
      if (user) await database.reportDraft.deleteMany({ where: { userId: user.id } });
      if (project) await database.project.delete({ where: { id: project.id } });
      if (user) await database.user.delete({ where: { id: user.id } });
    } finally {
      await database.$disconnect();
    }
  });
  user = await database.user.create({ data: {
    username: `draft-race-${suffix}`, name: 'Teste de rascunho', passwordHash: 'test-only', role: 'COLLABORATOR'
  } });
  project = await database.project.create({ data: {
    code: `draft-race-${suffix}`, name: 'Projeto de teste', clientName: 'Cliente de teste',
    clientCnpj: '00000000000000', contractCode: 'TEST', location: 'Oficina'
  } });
  const input = { projectId: project.id, reportDate: '2026-10-17', payload: { dailyDescription: 'Inicial' } };
  const saves = await Promise.all(Array.from({ length: 12 }, (_, index) =>
    saveRdoDraft(database, user.id, { ...input, payload: { dailyDescription: `Edição ${index}` } })
  ));
  assert.equal(new Set(saves.map(save => save.item.id)).size, 1, 'all responses retain the same usable ID');
  assert.equal(saves.filter(save => save.created).length, 1);
  assert.equal(await database.reportDraft.count({ where: { userId: user.id } }), 1);

  const draftId = saves[0].item.id;
  await saveRdoDraft(database, user.id, { ...input, payload: { dailyDescription: 'Última edição' } }, draftId);
  const saved = await database.reportDraft.findUniqueOrThrow({ where: { id: draftId } });
  assert.equal(saved.payload.dailyDescription, 'Última edição', 'the ID remains editable after concurrent retries');

  const independent = await saveRdoDraft(database, user.id, { ...input, payload: { serviceOnly: true } });
  assert.notEqual(independent.item.id, draftId);
  assert.equal(await database.reportDraft.count({ where: { userId: user.id } }), 2);
});
