import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPontoMaisSyncWindow,
  createPontoMaisAutomationService,
  pontoMaisDailySchedule,
  startPontoMaisSyncJob
} from '../src/lib/pontomais/job.js';

function fakeAutomationDb(initialState = null) {
  let state = initialState ? { id: 'pontomais', ...initialState } : null;
  return {
    pontoSyncState: {
      async upsert({ create }) {
        if (!state) state = { ...create };
        return { ...state };
      },
      async update({ data }) {
        state = { ...state, ...data };
        return { ...state };
      }
    },
    readState() { return state ? { ...state } : null; }
  };
}

test('lotes históricos têm no máximo 31 dias inclusivos', () => {
  assert.deepEqual(buildPontoMaisSyncWindow('2026-01-01', '2026-02-15'), {
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    nextDate: '2026-02-01'
  });
  assert.deepEqual(buildPontoMaisSyncWindow('2026-02-01', '2026-02-15'), {
    startDate: '2026-02-01',
    endDate: '2026-02-15',
    nextDate: '2026-02-16'
  });
});

test('bootstrap processa todos os lotes até hoje em um único ciclo', async () => {
  const db = fakeAutomationDb();
  const calls = [];
  const options = {
    db,
    now: () => new Date('2026-08-17T12:00:00.000Z'),
    clientFactory: () => ({ async getHistoryStartDate() { return '2026-06-01'; } }),
    syncService: {
      async runSync(input) {
        calls.push(input);
        return { runId: `run-${calls.length}`, status: 'SUCCEEDED' };
      }
    }
  };

  const result = await createPontoMaisAutomationService(options).runCycle();

  assert.equal(result.status, 'BOOTSTRAP_COMPLETED');
  assert.equal(result.batches, 3);
  assert.equal(result.through, '2026-08-17');

  assert.deepEqual(calls.map(({ startDate, endDate, trigger }) => ({ startDate, endDate, trigger })), [
    { startDate: '2026-06-01', endDate: '2026-07-01', trigger: 'AUTOMATIC_BOOTSTRAP' },
    { startDate: '2026-07-02', endDate: '2026-08-01', trigger: 'AUTOMATIC_BOOTSTRAP' },
    { startDate: '2026-08-02', endDate: '2026-08-17', trigger: 'AUTOMATIC_BOOTSTRAP' }
  ]);
  assert.equal(db.readState().bootstrapStatus, 'SUCCEEDED');
  assert.equal(db.readState().historyThrough.toISOString().slice(0, 10), '2026-08-17');
  assert.equal(db.readState().lastDailySyncDate.toISOString().slice(0, 10), '2026-08-16');
  assert.equal(db.readState().nextPeriodStart, null);
});

test('reprocessa uma única vez todo o histórico quando a revisão canônica aumenta', async () => {
  const db = fakeAutomationDb({
    bootstrapStatus: 'SUCCEEDED',
    historyStart: new Date('2026-06-01T00:00:00.000Z'),
    historyThrough: new Date('2026-08-17T00:00:00.000Z'),
    nextPeriodStart: null,
    lastDailySyncDate: new Date('2026-08-16T00:00:00.000Z'),
    dataRevision: 1,
    targetDataRevision: null
  });
  const calls = [];
  const service = createPontoMaisAutomationService({
    db,
    now: () => new Date('2026-08-17T12:00:00.000Z'),
    syncService: {
      async runSync(input) {
        calls.push(input);
        return { runId: `repair-${calls.length}`, status: 'SUCCEEDED' };
      }
    }
  });

  const repaired = await service.runCycle();
  assert.equal(repaired.status, 'BOOTSTRAP_COMPLETED');
  assert.deepEqual(calls.map(({ startDate, endDate }) => ({ startDate, endDate })), [
    { startDate: '2026-06-01', endDate: '2026-07-01' },
    { startDate: '2026-07-02', endDate: '2026-08-01' },
    { startDate: '2026-08-02', endDate: '2026-08-17' }
  ]);
  assert.equal(db.readState().dataRevision, 2);
  assert.equal(db.readState().targetDataRevision, null);

  assert.equal((await service.runCycle()).status, 'NOT_DUE');
  assert.equal(calls.length, 3, 'a revisão concluída não pode reiniciar outro replay');
});

test('reprocessamento histórico retoma o lote que falhou sem voltar ao início', async () => {
  const db = fakeAutomationDb({
    bootstrapStatus: 'SUCCEEDED',
    historyStart: new Date('2026-06-01T00:00:00.000Z'),
    historyThrough: new Date('2026-08-17T00:00:00.000Z'),
    nextPeriodStart: null,
    lastDailySyncDate: new Date('2026-08-16T00:00:00.000Z'),
    dataRevision: 1,
    targetDataRevision: null
  });
  const failedCalls = [];
  const firstAttempt = createPontoMaisAutomationService({
    db,
    now: () => new Date('2026-08-17T12:00:00.000Z'),
    syncService: {
      async runSync(input) {
        failedCalls.push(input);
        if (failedCalls.length === 2) {
          throw Object.assign(new Error('Falha sanitizada.'), { code: 'PONTOMAIS_UNAVAILABLE' });
        }
        return { runId: 'repair-first', status: 'SUCCEEDED' };
      }
    }
  });

  await assert.rejects(() => firstAttempt.runCycle(), /Falha sanitizada/);
  assert.equal(db.readState().targetDataRevision, 2);
  assert.equal(db.readState().nextPeriodStart.toISOString().slice(0, 10), '2026-07-02');

  const resumedCalls = [];
  const resumed = createPontoMaisAutomationService({
    db,
    now: () => new Date('2026-08-17T12:00:00.000Z'),
    syncService: {
      async runSync(input) {
        resumedCalls.push(input);
        return { runId: `repair-resume-${resumedCalls.length}`, status: 'SUCCEEDED' };
      }
    }
  });
  await resumed.runCycle();

  assert.equal(resumedCalls[0].startDate, '2026-07-02');
  assert.equal(db.readState().dataRevision, 2);
  assert.equal(db.readState().targetDataRevision, null);
});

test('falha não avança o cursor e o ciclo seguinte tenta o mesmo lote', async () => {
  const db = fakeAutomationDb({
    bootstrapStatus: 'RUNNING',
    historyStart: new Date('2026-07-01T00:00:00.000Z'),
    historyThrough: null,
    nextPeriodStart: new Date('2026-07-01T00:00:00.000Z')
  });
  const calls = [];
  const service = createPontoMaisAutomationService({
    db,
    now: () => new Date('2026-08-17T12:00:00.000Z'),
    syncService: {
      async runSync(input) {
        calls.push(input);
        throw Object.assign(new Error('Falha sanitizada.'), { code: 'PONTOMAIS_UNAVAILABLE' });
      }
    }
  });

  await assert.rejects(() => service.runCycle(), /Falha sanitizada/);
  assert.equal(db.readState().bootstrapStatus, 'FAILED');
  assert.equal(db.readState().nextPeriodStart.toISOString().slice(0, 10), '2026-07-01');
  assert.equal(db.readState().lastErrorCode, 'PONTOMAIS_UNAVAILABLE');
  assert.equal(calls.length, 1);
});

test('janela diária roda uma vez após 03:00 BRT, termina ontem e relê 31 dias', async () => {
  const baseState = {
    bootstrapStatus: 'SUCCEEDED',
    historyStart: new Date('2025-01-01T00:00:00.000Z'),
    historyThrough: new Date('2026-08-15T00:00:00.000Z'),
    nextPeriodStart: null,
    lastDailySyncDate: new Date('2026-08-15T00:00:00.000Z')
  };
  const beforeDb = fakeAutomationDb(baseState);
  const beforeCalls = [];
  const before = createPontoMaisAutomationService({
    db: beforeDb,
    now: () => new Date('2026-08-17T05:59:00.000Z'),
    syncService: { async runSync(input) { beforeCalls.push(input); } }
  });
  assert.equal((await before.runCycle()).status, 'NOT_DUE');
  assert.deepEqual(beforeCalls, []);

  const db = fakeAutomationDb(baseState);
  const calls = [];
  const after = createPontoMaisAutomationService({
    db,
    now: () => new Date('2026-08-17T06:00:00.000Z'),
    syncService: {
      async runSync(input) {
        calls.push(input);
        return { runId: 'daily-1', status: 'SUCCEEDED' };
      }
    }
  });
  assert.equal((await after.runCycle()).status, 'DAILY_COMPLETED');
  assert.equal((await after.runCycle()).status, 'NOT_DUE');
  assert.deepEqual(calls, [{
    startDate: '2026-07-17',
    endDate: '2026-08-16',
    requestedByUserId: null,
    trigger: 'AUTOMATIC_DAILY'
  }]);
  assert.equal(db.readState().lastDailySyncDate.toISOString().slice(0, 10), '2026-08-16');
  assert.equal(db.readState().historyThrough.toISOString().slice(0, 10), '2026-08-16');
});

test('regra de horário usa explicitamente America/Sao_Paulo', () => {
  assert.deepEqual(pontoMaisDailySchedule(new Date('2026-08-17T06:00:00.000Z')), {
    businessDate: '2026-08-17',
    hour: 3,
    targetDate: '2026-08-16',
    dueByTime: true
  });
});

test('job automático usa o runner compartilhado com lock distribuído', async () => {
  const calls = [];
  const scheduled = startPontoMaisSyncJob({
    enabled: true,
    intervalMs: 60_000,
    automation: { async runCycle() { calls.push(['cycle']); return { status: 'NOT_DUE' }; } },
    async runJob(name, runFn, options) {
      calls.push(['job', name, options]);
      return { status: 'COMPLETED', result: await runFn() };
    },
    logger: { log() {}, warn() {}, error() {} }
  });
  try {
    await scheduled.run();
  } finally {
    clearInterval(scheduled.timer);
    clearTimeout(scheduled.kickoff);
  }

  assert.equal(calls[0][0], 'job');
  assert.equal(calls[0][1], 'pontomais-sync');
  assert.ok(calls[0][2].lockTtlMs >= 60 * 60 * 1000);
  assert.equal(calls[0][2].metadata.timeZone, 'America/Sao_Paulo');
  assert.deepEqual(calls[1], ['cycle']);
});
