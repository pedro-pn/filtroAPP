import assert from 'node:assert/strict';
import test from 'node:test';

import {
  consumeTwoFactorBypass,
  createTwoFactorChallenge,
  deliverTwoFactorCode,
  maskEmail,
  normalizeTwoFactorCode,
  refreshTwoFactorChallenge,
  revokeTrustedDevices,
  issueTrustedDevice,
  TRUSTED_DEVICE_TTL_MS,
  TWO_FACTOR_CODE_TTL_MS,
  TWO_FACTOR_MAX_ATTEMPTS,
  TWO_FACTOR_MAX_SENDS,
  TwoFactorRequirement,
  twoFactorChallengeNeeded,
  twoFactorRequirement,
  validateTrustedDevice,
  verifyTwoFactorChallenge
} from '../src/lib/accounts/two-factor.js';

// Prisma falso em memória: só o que a biblioteca usa (where simples por igualdade e lt/gt).
function matches(row, where = {}) {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key];
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if ('lt' in condition) return value < condition.lt;
      if ('gt' in condition) return value !== null && value !== undefined && value > condition.gt;
      if ('not' in condition) return value !== condition.not;
      return true;
    }
    return value === condition;
  });
}

function applyData(row, data) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) row[key] += value.increment;
    else row[key] = value;
  }
}

function fakeModel(rows) {
  let seq = 0;
  return {
    rows,
    async create({ data }) {
      const row = { id: `id-${++seq}`, attempts: 0, sendCount: 1, consumedAt: null, createdAt: new Date(), ...data };
      rows.push(row);
      return { ...row };
    },
    async findUnique({ where }) {
      const row = rows.find(item => matches(item, where));
      return row ? { ...row } : null;
    },
    async updateMany({ where, data }) {
      const hit = rows.filter(item => matches(item, where));
      hit.forEach(row => applyData(row, data));
      return { count: hit.length };
    },
    async update({ where, data }) {
      const row = rows.find(item => matches(item, where));
      applyData(row, data);
      return { ...row };
    },
    async deleteMany({ where }) {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i -= 1) if (matches(rows[i], where)) rows.splice(i, 1);
      return { count: before - rows.length };
    }
  };
}

function fakePrisma() {
  return {
    twoFactorChallenge: fakeModel([]),
    trustedDevice: fakeModel([]),
    user: fakeModel([])
  };
}

const ON = { twoFactorEnforcement: 'on' };
const OFF = { twoFactorEnforcement: 'off' };

test('enforcement rules: ADMIN required, INTERNAL optional, CLIENT never, kill switch disables all', () => {
  assert.equal(twoFactorRequirement({ accountType: 'ADMIN', role: 'MANAGER' }, ON), TwoFactorRequirement.REQUIRED);
  assert.equal(twoFactorRequirement({ accountType: 'INTERNAL', role: 'COORDINATOR' }, ON), TwoFactorRequirement.AVAILABLE);
  assert.equal(twoFactorRequirement({ accountType: 'INTERNAL', role: 'COLLABORATOR', twoFactorEnabled: true }, ON), TwoFactorRequirement.ENABLED);
  assert.equal(twoFactorRequirement({ accountType: 'CLIENT', role: 'CLIENT', twoFactorEnabled: true }, ON), TwoFactorRequirement.NONE);
  assert.equal(twoFactorRequirement({ accountType: 'ADMIN', role: 'MANAGER' }, OFF), TwoFactorRequirement.NONE);
  assert.equal(twoFactorChallengeNeeded({ accountType: 'ADMIN' }, ON), true);
  assert.equal(twoFactorChallengeNeeded({ accountType: 'INTERNAL' }, ON), false);
  assert.equal(twoFactorChallengeNeeded({ accountType: 'INTERNAL', twoFactorEnabled: true }, ON), true);
});

test('codes and e-mails are normalized and masked', () => {
  assert.equal(normalizeTwoFactorCode(' 123 456 '), '123456');
  assert.equal(normalizeTwoFactorCode('12345'), '');
  assert.equal(maskEmail('pedro.paulo@filtrovali.com.br'), 'pe*********@filtrovali.com.br');
  assert.equal(maskEmail('a@x.com'), 'a***@x.com');
  assert.equal(maskEmail(''), '');
});

test('a challenge accepts the right code once, and never twice', async () => {
  const db = fakePrisma();
  const now = new Date('2026-11-19T12:00:00Z');
  const { challengeToken } = await createTwoFactorChallenge(db, { userId: 'u1', now, code: '424242' });
  assert.equal(db.twoFactorChallenge.rows[0].codeHash.includes('424242'), false, 'only the hash is stored');

  const ok = await verifyTwoFactorChallenge(db, { challengeToken, code: '424242', now });
  assert.equal(ok.ok, true);
  assert.equal(ok.challenge.userId, 'u1');

  const again = await verifyTwoFactorChallenge(db, { challengeToken, code: '424242', now });
  assert.deepEqual([again.ok, again.reason], [false, 'INVALID']);
});

test('wrong codes count attempts and lock the challenge after the limit', async () => {
  const db = fakePrisma();
  const now = new Date('2026-11-19T12:00:00Z');
  const { challengeToken } = await createTwoFactorChallenge(db, { userId: 'u1', now, code: '111111' });
  for (let attempt = 1; attempt < TWO_FACTOR_MAX_ATTEMPTS; attempt += 1) {
    const result = await verifyTwoFactorChallenge(db, { challengeToken, code: '000000', now });
    assert.equal(result.reason, 'INVALID');
    assert.equal(result.remainingAttempts, TWO_FACTOR_MAX_ATTEMPTS - attempt);
  }
  const last = await verifyTwoFactorChallenge(db, { challengeToken, code: '000000', now });
  assert.equal(last.reason, 'LOCKED');
  const right = await verifyTwoFactorChallenge(db, { challengeToken, code: '111111', now });
  assert.deepEqual([right.ok, right.reason], [false, 'LOCKED'], 'the right code no longer works once locked');
});

test('expired challenges and challenges of another purpose are rejected', async () => {
  const db = fakePrisma();
  const now = new Date('2026-11-19T12:00:00Z');
  const { challengeToken } = await createTwoFactorChallenge(db, { userId: 'u1', now, code: '222222' });
  const later = new Date(now.getTime() + TWO_FACTOR_CODE_TTL_MS + 1);
  assert.equal((await verifyTwoFactorChallenge(db, { challengeToken, code: '222222', now: later })).reason, 'EXPIRED');
  assert.equal((await verifyTwoFactorChallenge(db, { challengeToken, code: '222222', now, purpose: 'ENABLE' })).reason, 'INVALID');
  assert.equal((await verifyTwoFactorChallenge(db, { challengeToken: 'nao-existe', code: '222222', now })).reason, 'INVALID');
});

test('a new challenge replaces the open one; a code from one challenge does not unlock another', async () => {
  const db = fakePrisma();
  const now = new Date('2026-11-19T12:00:00Z');
  const first = await createTwoFactorChallenge(db, { userId: 'u1', now, code: '333333' });
  const second = await createTwoFactorChallenge(db, { userId: 'u1', now, code: '444444' });
  assert.equal(db.twoFactorChallenge.rows.length, 1);
  assert.equal((await verifyTwoFactorChallenge(db, { challengeToken: first.challengeToken, code: '333333', now })).ok, false);
  assert.equal((await verifyTwoFactorChallenge(db, { challengeToken: second.challengeToken, code: '333333', now })).ok, false);
  assert.equal((await verifyTwoFactorChallenge(db, { challengeToken: second.challengeToken, code: '444444', now })).ok, true);
});

test('resend issues a new code, respects the cooldown and the send limit', async () => {
  const db = fakePrisma();
  const t0 = new Date('2026-11-19T12:00:00Z');
  const { challengeToken } = await createTwoFactorChallenge(db, { userId: 'u1', now: t0, code: '555555' });
  assert.equal((await refreshTwoFactorChallenge(db, { challengeToken, now: new Date(t0.getTime() + 5_000), code: '666666' })).reason, 'COOLDOWN');

  let clock = t0.getTime();
  for (let send = 2; send <= TWO_FACTOR_MAX_SENDS; send += 1) {
    clock += 31_000;
    const result = await refreshTwoFactorChallenge(db, { challengeToken, now: new Date(clock), code: `77777${send}` });
    assert.equal(result.ok, true);
  }
  clock += 31_000;
  assert.equal((await refreshTwoFactorChallenge(db, { challengeToken, now: new Date(clock), code: '888888' })).reason, 'SEND_LIMIT');

  const now = new Date(clock);
  assert.equal((await verifyTwoFactorChallenge(db, { challengeToken, code: '555555', now })).ok, false, 'old code is gone');
  assert.equal((await verifyTwoFactorChallenge(db, { challengeToken, code: `77777${TWO_FACTOR_MAX_SENDS}`, now })).ok, true);
});

test('trusted devices only work for their own account, within 30 days, until revoked', async () => {
  const db = fakePrisma();
  const now = new Date('2026-11-19T12:00:00Z');
  const { token, device } = await issueTrustedDevice(db, { userId: 'u1', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130', now });
  assert.equal(device.label, 'Chrome · Windows');
  assert.equal(db.trustedDevice.rows[0].tokenHash === token, false, 'only the hash is stored');

  assert.ok(await validateTrustedDevice(db, { userId: 'u1', token, now }));
  assert.equal(await validateTrustedDevice(db, { userId: 'u2', token, now }), null, 'another account cannot reuse it');
  assert.equal(await validateTrustedDevice(db, { userId: 'u1', token, now: new Date(now.getTime() + TRUSTED_DEVICE_TTL_MS + 1) }), null);
  assert.equal(await validateTrustedDevice(db, { userId: 'u1', token: '', now }), null);

  await revokeTrustedDevices(db, 'u1');
  assert.equal(await validateTrustedDevice(db, { userId: 'u1', token, now }), null);
});

test('break-glass bypass works once and only before it expires', async () => {
  const db = fakePrisma();
  const now = new Date('2026-11-19T12:00:00Z');
  db.user.rows.push({ id: 'admin', twoFactorBypassUntil: new Date(now.getTime() + 60_000) });
  const user = { ...db.user.rows[0] };
  assert.equal(await consumeTwoFactorBypass(db, user, now), true);
  assert.equal(db.user.rows[0].twoFactorBypassUntil, null);
  assert.equal(await consumeTwoFactorBypass(db, user, now), false, 'second use is refused');

  db.user.rows.push({ id: 'late', twoFactorBypassUntil: new Date(now.getTime() - 1) });
  assert.equal(await consumeTwoFactorBypass(db, { ...db.user.rows[1] }, now), false);
});

test('code delivery reports disabled e-mail, missing e-mail, SMTP errors and timeouts as not delivered', async () => {
  const user = { name: 'Admin', username: 'admin', email: 'admin@example.com' };
  const sent = [];
  assert.deepEqual(await deliverTwoFactorCode({ user, code: '123456' }, { sendMailImpl: async message => { sent.push(message); return {}; } }), { delivered: true });
  assert.equal(sent[0].to, 'admin@example.com');
  assert.match(sent[0].text, /123456/);
  assert.equal((await deliverTwoFactorCode({ user, code: '1' }, { sendMailImpl: async () => ({ skipped: true }) })).reason, 'EMAIL_DISABLED');
  assert.equal((await deliverTwoFactorCode({ user: { ...user, email: null }, code: '1' })).reason, 'NO_EMAIL');
  const quiet = { warn() {} };
  assert.equal((await deliverTwoFactorCode({ user, code: '1' }, { sendMailImpl: async () => { throw new Error('smtp'); }, logger: quiet })).reason, 'SEND_ERROR');
  assert.equal((await deliverTwoFactorCode({ user, code: '1' }, { sendMailImpl: () => new Promise(() => {}), timeoutMs: 10, logger: quiet })).reason, 'TIMEOUT');
});

test('break-glass script parses arguments and grants a time-boxed, audited bypass', async () => {
  const { parseBreakGlassArgs, grantTwoFactorBypass } = await import('../scripts/disable-2fa.js');
  assert.deepEqual(parseBreakGlassArgs(['--username', 'admin']), { username: 'admin', minutes: 60 });
  assert.deepEqual(parseBreakGlassArgs(['--username=admin', '--minutes=15']), { username: 'admin', minutes: 15 });
  assert.throws(() => parseBreakGlassArgs([]), /--username/);
  assert.throws(() => parseBreakGlassArgs(['--username', 'a', '--minutes', '0']), /minutes/);

  const updates = [];
  const events = [];
  const db = {
    user: {
      findFirst: async () => ({ id: 'u1', username: 'admin', isActive: true }),
      update: async args => updates.push(args)
    },
    authSecurityEvent: { create: async args => events.push(args) }
  };
  const now = new Date('2026-11-19T12:00:00Z');
  const result = await grantTwoFactorBypass(db, { username: 'admin', minutes: 30, now });
  assert.equal(result.until.toISOString(), '2026-11-19T12:30:00.000Z');
  assert.equal(updates[0].data.twoFactorBypassUntil.toISOString(), '2026-11-19T12:30:00.000Z');
  assert.equal(events[0].data.type, 'TWO_FACTOR_BREAK_GLASS');

  db.user.findFirst = async () => ({ id: 'u2', username: 'ex', isActive: false });
  await assert.rejects(grantTwoFactorBypass(db, { username: 'ex', minutes: 5, now }), /desativada/);
});
