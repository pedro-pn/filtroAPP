import assert from 'node:assert/strict';
import test from 'node:test';

import { JOB_RUN_STATUS, acquireJobLock, runTrackedJob } from '../src/lib/jobs/runner.js';

function fakePrismaClient() {
  const locks = new Map();
  const runs = new Map();
  let runSeq = 0;
  const calls = [];

  return {
    calls,
    locks,
    runs,
    jobLock: {
      async updateMany(args) {
        calls.push(['jobLock', 'updateMany', args]);
        const lock = locks.get(args.where.name);
        const expiresBefore = args.where.OR?.[0]?.expiresAt?.lte;
        const owner = args.where.OR?.[1]?.owner;
        if (!lock || !(lock.expiresAt <= expiresBefore || lock.owner === owner)) {
          return { count: 0 };
        }
        locks.set(args.where.name, { ...lock, ...args.data });
        return { count: 1 };
      },
      async create(args) {
        calls.push(['jobLock', 'create', args]);
        if (locks.has(args.data.name)) {
          const error = new Error('unique');
          error.code = 'P2002';
          throw error;
        }
        locks.set(args.data.name, { ...args.data });
        return args.data;
      },
      async deleteMany(args) {
        calls.push(['jobLock', 'deleteMany', args]);
        const lock = locks.get(args.where.name);
        if (!lock || lock.owner !== args.where.owner) return { count: 0 };
        locks.delete(args.where.name);
        return { count: 1 };
      }
    },
    jobRun: {
      async create(args) {
        calls.push(['jobRun', 'create', args]);
        const id = `run-${runSeq += 1}`;
        const row = { id, ...args.data };
        runs.set(id, row);
        return row;
      },
      async update(args) {
        calls.push(['jobRun', 'update', args]);
        const current = runs.get(args.where.id);
        const row = { ...current, ...args.data };
        runs.set(args.where.id, row);
        return row;
      }
    }
  };
}

test('acquireJobLock claims expired locks', async () => {
  const client = fakePrismaClient();
  client.locks.set('daily', {
    name: 'daily',
    owner: 'old-owner',
    lockedAt: new Date('2026-07-02T09:00:00.000Z'),
    expiresAt: new Date('2026-07-02T10:00:00.000Z')
  });

  const result = await acquireJobLock('daily', {
    prismaClient: client,
    owner: 'new-owner',
    now: new Date('2026-07-02T11:00:00.000Z'),
    ttlMs: 60_000
  });

  assert.equal(result.acquired, true);
  assert.equal(client.locks.get('daily').owner, 'new-owner');
});

test('runTrackedJob records completion and releases lock', async () => {
  const client = fakePrismaClient();

  const result = await runTrackedJob('survey-reminders', async () => ({ sent: 2 }), {
    prismaClient: client,
    metadata: { intervalMs: 1000 },
    nowFn: () => new Date('2026-07-02T12:00:00.000Z')
  });

  assert.equal(result.status, JOB_RUN_STATUS.COMPLETED);
  assert.equal(client.runs.get('run-1').status, JOB_RUN_STATUS.COMPLETED);
  assert.deepEqual(client.runs.get('run-1').result, { sent: 2 });
  assert.equal(client.locks.size, 0);
});

test('runTrackedJob skips concurrent execution in the same process', async () => {
  const client = fakePrismaClient();
  let release;
  const first = runTrackedJob('survey-reminders', () => new Promise(resolve => {
    release = () => resolve({ sent: 1 });
  }), {
    prismaClient: client,
    nowFn: () => new Date('2026-07-02T12:00:00.000Z')
  });
  await new Promise(resolve => setImmediate(resolve));

  const second = await runTrackedJob('survey-reminders', async () => ({ sent: 2 }), {
    prismaClient: client,
    nowFn: () => new Date('2026-07-02T12:00:00.000Z')
  });
  release();
  await first;

  assert.equal(second.status, JOB_RUN_STATUS.SKIPPED);
  assert.equal(second.reason, 'in-process');
  assert.equal(client.runs.get('run-2').status, JOB_RUN_STATUS.SKIPPED);
});

test('runTrackedJob records failures and releases lock', async () => {
  const client = fakePrismaClient();

  await assert.rejects(
    () => runTrackedJob('signature-reminders', async () => {
      throw new Error('mail service unavailable');
    }, {
      prismaClient: client,
      nowFn: () => new Date('2026-07-02T12:00:00.000Z')
    }),
    /mail service unavailable/
  );

  assert.equal(client.runs.get('run-1').status, JOB_RUN_STATUS.FAILED);
  assert.match(client.runs.get('run-1').error, /mail service unavailable/);
  assert.equal(client.locks.size, 0);
});
