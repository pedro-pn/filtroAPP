import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { assertLocalPerformanceDatabase } from '../scripts/lib/http-performance-report.js';
import { captureLaborQueries } from '../scripts/fixtures/labor-query-profile.js';

test('PostgreSQL: authenticated pages skip two empty reads and reload changed collaborator roles', {
  skip: !process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL
}, async t => {
  const url = process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL; assertLocalPerformanceDatabase(url); process.env.DATABASE_URL = url;
  const { default: db } = await import('../src/lib/prisma.js');
  const { hashToken } = await import('../src/lib/auth.js');
  const { requireAuth } = await import('../src/middleware/auth.js');
  const prefix = 'auth-page-' + randomUUID(), token = randomUUID();
  const app = express(); app.get('/me', requireAuth, (req, res) => res.json(req.auth.user));
  let server;
  t.after(async () => {
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await db.user.deleteMany({ where: { id: prefix } });
    await db.collaborator.deleteMany({ where: { id: prefix } });
    await db.jobRole.deleteMany({ where: { id: prefix } });
    await db.$disconnect();
  });
  await db.user.create({ data: { id: prefix, username: prefix, name: 'Pessoa sintética', passwordHash: 'synthetic', accountType: 'ADMIN', role: 'MANAGER' } });
  await db.userSession.create({ data: { userId: prefix, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60000) } });
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const request = async () => { const response = await fetch('http://127.0.0.1:' + server.address().port + '/me', { headers: { authorization: 'Bearer ' + token } }); assert.equal(response.status, 200); return response.json(); };
  const capture = captureLaborQueries();
  let queries;
  try { assert.equal((await request()).collaborator, null); queries = await capture.finish(0); }
  finally { capture.restore(); }
  assert.equal(queries.length, 3, 'Session, user and module roles only');
  assert.ok(queries.every(query => !query.sqlSnippet.includes('"public"."Collaborator"') && !query.sqlSnippet.includes('"public"."JobRole"')));
  await db.jobRole.create({ data: { id: prefix, name: prefix, normalizedKey: prefix } });
  await db.collaborator.create({ data: { id: prefix, name: 'Pessoa vinculada', code: prefix, jobRoleId: prefix } });
  await db.user.update({ where: { id: prefix }, data: { collaboratorId: prefix } });
  assert.equal((await request()).collaborator.jobRole.name, prefix);
  await db.jobRole.update({ where: { id: prefix }, data: { name: prefix + '-updated' } });
  assert.equal((await request()).collaborator.role, prefix + '-updated');
  await db.user.update({ where: { id: prefix }, data: { collaboratorId: null } });
  assert.equal((await request()).collaborator, null);
});
