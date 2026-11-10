import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import prisma from '../src/lib/prisma.js';
import { requireAuth } from '../src/middleware/auth.js';

test('authentication skips absent collaborators and preserves linked profiles and retries', async t => {
  const originals = [prisma.userSession.findUnique, prisma.collaborator.findUnique];
  let stored = { id: 'session', expiresAt: new Date(Date.now() + 60000), user: {
    id: 'u', username: 'u', name: 'Pessoa', accountType: 'ADMIN', role: 'MANAGER', isActive: true, moduleRoles: [], collaboratorId: null
  } };
  let sessionReads = 0, collaboratorReads = 0, failed = false;
  prisma.userSession.findUnique = async args => {
    sessionReads++; assert.equal(Object.hasOwn(args.include.user.include, 'collaborator'), false); return stored;
  };
  prisma.collaborator.findUnique = async ({ where }) => {
    collaboratorReads++;
    if (failed) throw new Error('profile temporarily unavailable');
    assert.deepEqual(where, { id: 'c' });
    return { id: 'c', name: 'Pessoa vinculada', code: '1', jobRoleId: 'r', jobRole: { id: 'r', name: 'Operadora' } };
  };
  const app = express(); app.get('/me', requireAuth, (req, res) => res.json(req.auth.user));
  app.use((error, _req, res, _next) => res.status(503).json({ error: error.message }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(async () => {
    [prisma.userSession.findUnique, prisma.collaborator.findUnique] = originals;
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  });
  const request = async () => { const response = await fetch('http://127.0.0.1:' + server.address().port + '/me', { headers: { authorization: 'Bearer synthetic-auth-test' } }); return { status: response.status, body: await response.json() }; };
  assert.equal((await request()).body.collaborator, null);
  assert.equal(collaboratorReads, 0);
  stored = { ...stored, user: { ...stored.user, collaboratorId: 'c' } };
  assert.equal((await request()).body.collaborator.role, 'Operadora');
  assert.equal(collaboratorReads, 1);
  assert.equal(Object.hasOwn(stored.user, 'collaborator'), false);
  failed = true;
  const before = sessionReads;
  assert.equal((await request()).status, 503);
  assert.equal(sessionReads - before, 3, 'The full session/profile read retains its existing retry policy');
  failed = false;
  assert.equal((await request()).status, 200);
  stored = { ...stored, user: { ...stored.user, isActive: false, collaboratorId: null } };
  assert.equal((await request()).status, 401);
});
