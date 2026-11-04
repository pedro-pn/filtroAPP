import assert from 'node:assert/strict';
import test from 'node:test';

import { createAllocationReviewRouter } from '../src/routes/resources/allocation-review.js';
import { AllocationReviewError } from '../src/lib/efetivo/allocation-review/service.js';

const USERS = {
  reviewer: { id: 'u-rev', accountType: 'INTERNAL', moduleRoles: ['efetivo:allocation-review'] },
  viewer: { id: 'u-view', accountType: 'INTERNAL', moduleRoles: ['efetivo:viewer'] },
  admin: { id: 'u-admin', accountType: 'ADMIN', moduleRoles: [] }
};

function authenticate(req, res, next) {
  const user = USERS[req.headers['x-test-user']];
  if (!user) return res.status(401).json({ error: 'Sessão ausente.' });
  req.auth = { user };
  return next();
}

async function dispatch(router, path, { method = 'GET', headers = {}, body } = {}) {
  const parsedUrl = new URL(path, 'http://local.test');
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  const request = {
    method,
    url: `${parsedUrl.pathname}${parsedUrl.search}`,
    originalUrl: `${parsedUrl.pathname}${parsedUrl.search}`,
    headers: normalized,
    get: name => normalized[String(name).toLowerCase()],
    query: Object.fromEntries(parsedUrl.searchParams),
    body
  };
  return new Promise((resolve, reject) => {
    let completed = false;
    const finish = (status, payload) => {
      if (completed) return;
      completed = true;
      resolve({ status, body: payload });
    };
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { finish(this.statusCode, payload); return this; },
      send(payload) { finish(this.statusCode, payload); return this; },
      end(payload) { finish(this.statusCode, payload); return this; },
      setHeader() {},
      getHeader() { return undefined; }
    };
    router.handle(request, response, error => (error ? reject(error) : finish(404, null)));
  });
}

function fixture(overrides = {}) {
  const calls = [];
  const record = name => async input => { calls.push([name, input]); return { ok: name, version: 2 }; };
  const services = {
    getReviewWeek: record('week'),
    getReviewMonth: record('month'),
    getReviewPendingCount: record('count'),
    saveReviewDays: record('save'),
    discardReviewDays: record('discard'),
    confirmReviewRows: record('confirm'),
    unconfirmReviewRows: record('unconfirm'),
    closeReviewWeek: record('close'),
    reopenReviewWeek: record('reopen'),
    ...overrides
  };
  return { calls, router: createAllocationReviewRouter({ authenticate, services }) };
}

const write = (user, body, version = '0') => ({
  headers: { 'x-test-user': user, ...(version === null ? {} : { 'If-Match-Version': version }) },
  body
});

test('sem sessão 401; sem o papel 403 (efetivo:viewer não basta); com o papel 200', async () => {
  const { router, calls } = fixture();
  assert.equal((await dispatch(router, '/semanas/2026-10-26')).status, 401);
  const forbidden = await dispatch(router, '/semanas/2026-10-26', { headers: { 'x-test-user': 'viewer' } });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.code, 'ALLOCATION_REVIEW_FORBIDDEN');
  const ok = await dispatch(router, '/semanas/2026-10-26', { headers: { 'x-test-user': 'reviewer' } });
  assert.equal(ok.status, 200);
  assert.equal(calls[0][1].weekStart, '2026-10-26');
  assert.equal((await dispatch(router, '/semanas/2026-10-26', { headers: { 'x-test-user': 'admin' } })).status, 200);
});

test('semana precisa começar numa segunda-feira', async () => {
  const { router } = fixture();
  const response = await dispatch(router, '/semanas/2026-10-27', { headers: { 'x-test-user': 'reviewer' } });
  assert.equal(response.status, 400);
  assert.equal(response.body.code, 'INVALID_WEEK_START');
});

test('escritas exigem If-Match-Version e corpo válido', async () => {
  const { router, calls } = fixture();
  const item = { collaboratorId: 'c1', date: '2026-10-27', kind: 'PROJECT', projectIds: ['p1'] };
  const missing = await dispatch(router, '/semanas/2026-10-26/dias', { method: 'PUT', ...write('reviewer', { items: [item] }, null) });
  assert.equal(missing.status, 428);
  const travel = await dispatch(router, '/semanas/2026-10-26/dias', {
    method: 'PUT', ...write('reviewer', { items: [{ ...item, kind: 'TRAVEL', projectIds: ['a', 'b'] }] })
  });
  assert.equal(travel.status, 400);
  const sede = await dispatch(router, '/semanas/2026-10-26/dias', {
    method: 'PUT', ...write('reviewer', { items: [{ ...item, kind: 'SEDE' }] })
  });
  assert.equal(sede.status, 400);
  const ok = await dispatch(router, '/semanas/2026-10-26/dias', { method: 'PUT', ...write('reviewer', { items: [item] }, '3') });
  assert.equal(ok.status, 200);
  assert.equal(calls.at(-1)[0], 'save');
  assert.equal(calls.at(-1)[1].expectedVersion, 3);
  assert.equal(calls.at(-1)[1].user.id, 'u-rev');
});

test('conferir aceita lista ou allReady; desconferir, fechar e reabrir chegam ao serviço', async () => {
  const { router, calls } = fixture();
  assert.equal((await dispatch(router, '/semanas/2026-10-26/linhas/conferir', { method: 'POST', ...write('reviewer', { allReady: true }) })).status, 200);
  assert.equal(calls.at(-1)[1].allReady, true);
  assert.equal((await dispatch(router, '/semanas/2026-10-26/linhas/conferir', { method: 'POST', ...write('reviewer', { collaboratorIds: ['c1'] }) })).status, 200);
  assert.deepEqual(calls.at(-1)[1].collaboratorIds, ['c1']);
  assert.equal((await dispatch(router, '/semanas/2026-10-26/linhas/conferir', { method: 'POST', ...write('reviewer', {}) })).status, 400);
  assert.equal((await dispatch(router, '/semanas/2026-10-26/linhas/desconferir', { method: 'POST', ...write('reviewer', { collaboratorIds: ['c1'] }) })).status, 200);
  assert.equal((await dispatch(router, '/semanas/2026-10-26/fechar', { method: 'POST', ...write('reviewer', {}) })).status, 200);
  assert.equal((await dispatch(router, '/semanas/2026-10-26/reabrir', { method: 'POST', ...write('admin', { note: 'ok' }) })).status, 200);
  assert.equal(calls.at(-1)[1].note, 'ok');
  assert.equal((await dispatch(router, '/semanas/2026-10-26/dias', { method: 'DELETE', ...write('reviewer', { items: [{ collaboratorId: 'c1', date: '2026-10-27' }] }) })).status, 200);
});

test('erros do serviço viram status e código do contrato', async () => {
  const cases = [
    [new AllocationReviewError('WEEK_VERSION_CONFLICT', 'Atualize.', 409, { currentVersion: 4 }), 409],
    [new AllocationReviewError('ADMIN_REQUIRED', 'Só admin.', 403), 403],
    [new AllocationReviewError('PROJECT_NOT_FOUND', 'Não encontrado.', 404), 404],
    [new AllocationReviewError('ROW_HAS_PENDING', 'Pendente.', 409, { collaboratorIds: ['c1'] }), 409]
  ];
  for (const [error, status] of cases) {
    const { router } = fixture({ reopenReviewWeek: async () => { throw error; } });
    const response = await dispatch(router, '/semanas/2026-10-26/reabrir', { method: 'POST', ...write('reviewer', {}) });
    assert.equal(response.status, status);
    assert.equal(response.body.code, error.code);
    for (const [key, value] of Object.entries(error.details)) assert.deepEqual(response.body[key], value);
  }
});

test('contagem de pendências', async () => {
  const { router, calls } = fixture();
  const response = await dispatch(router, '/pendencias/contagem', { headers: { 'x-test-user': 'reviewer' } });
  assert.equal(response.status, 200);
  assert.equal(calls[0][0], 'count');
});

test('visão do mês valida AAAA-MM', async () => {
  const { router, calls } = fixture();
  assert.equal((await dispatch(router, '/meses/2026-13', { headers: { 'x-test-user': 'reviewer' } })).status, 400);
  const ok = await dispatch(router, '/meses/2026-10', { headers: { 'x-test-user': 'reviewer' } });
  assert.equal(ok.status, 200);
  assert.equal(calls.at(-1)[1].yearMonth, '2026-10');
});
