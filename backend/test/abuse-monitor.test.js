import assert from 'node:assert/strict';
import test from 'node:test';

import {
  abuseAlertMessage,
  clearAbuseBuffer,
  detectAbuse,
  flushAbuseEvents,
  recordLoginFailure,
  recordRateLimitHit
} from '../src/lib/abuse/monitor.js';
import { recordOpenAiTokens, reserveOpenAiCall, openAiUsageSummary } from '../src/lib/abuse/openai-budget.js';
import { COUNTER_KINDS, abuseBucketStart, brasiliaDayStart, brasiliaMonthStart } from '../src/lib/abuse/usage-counters.js';
import { EXPENSIVE_ROUTE_LIMITS, createMemoryRateLimit, expensiveRouteLimit, setRateLimitObserver } from '../src/lib/rate-limit.js';
import { getOperationalStatus } from '../src/lib/operations/status.js';

// UsageCounter em memória, com a mesma semântica de upsert/increment do Prisma.
function fakeCounters() {
  const rows = new Map();
  const keyOf = ({ kind, subject, periodStart }) => `${kind}|${subject}|${new Date(periodStart).toISOString()}`;
  return {
    rows,
    usageCounter: {
      async upsert({ where, create, update }) {
        const key = keyOf(where.kind_subject_periodStart);
        const current = rows.get(key);
        if (!current) {
          rows.set(key, { ...create });
          return rows.get(key);
        }
        current.count += update.count.increment;
        current.tokens += update.tokens.increment;
        return current;
      },
      async findUnique({ where }) {
        return rows.get(keyOf(where.kind_subject_periodStart)) || null;
      },
      async groupBy({ where }) {
        const grouped = new Map();
        for (const row of rows.values()) {
          if (!where.kind.in.includes(row.kind)) continue;
          if (new Date(row.periodStart) < where.periodStart.gte) continue;
          if (where.subject?.in && !where.subject.in.includes(row.subject)) continue;
          const key = `${row.kind}|${row.subject}`;
          const item = grouped.get(key) || { kind: row.kind, subject: row.subject, _sum: { count: 0, tokens: 0 } };
          item._sum.count += row.count;
          item._sum.tokens += row.tokens;
          grouped.set(key, item);
        }
        return [...grouped.values()];
      },
      async deleteMany({ where }) {
        let count = 0;
        for (const [key, row] of rows) {
          if (row.kind.startsWith(where.kind.startsWith) && new Date(row.periodStart) < where.periodStart.lt) {
            rows.delete(key);
            count += 1;
          }
        }
        return { count };
      }
    },
    user: {
      async findUnique({ where }) {
        return where.id === 'u-admin' ? { username: 'admin' } : null;
      }
    }
  };
}

const config = {
  nodeEnv: 'test',
  abuseWindowMs: 15 * 60 * 1000,
  abuseLoginFailuresTotal: 100,
  abuseLoginFailuresPerIp: 30,
  abuseLoginFailuresPerAccount: 15,
  abuseRateLimitHits: 50,
  openaiDailyTokenBudget: 10_000,
  openaiMonthlyTokenBudget: 100_000,
  openaiUserDailyCalls: 2,
  openaiBudgetAlertPercent: 80,
  openaiUsdPerMillionTokens: 2
};

test.beforeEach(() => clearAbuseBuffer());

test('períodos: balde de 5 min e dia/mês no horário de Brasília (UTC−3)', () => {
  const now = new Date('2026-11-19T02:59:00Z'); // 23:59 de 18/11 em Brasília
  assert.equal(abuseBucketStart(now).toISOString(), '2026-11-19T02:55:00.000Z');
  assert.equal(brasiliaDayStart(now).toISOString(), '2026-11-18T03:00:00.000Z');
  assert.equal(brasiliaMonthStart(now).toISOString(), '2026-11-01T03:00:00.000Z');
  assert.equal(brasiliaMonthStart(new Date('2026-12-01T02:00:00Z')).toISOString(), '2026-11-01T03:00:00.000Z');
});

test('detecção: limites por total, IP, conta existente e limitador; conta desconhecida não alerta sozinha', () => {
  const thresholds = { loginFailuresTotal: 100, loginFailuresPerIp: 30, loginFailuresPerAccount: 15, rateLimitHits: 50 };
  const findings = detectAbuse([
    { kind: COUNTER_KINDS.LOGIN_FAILURE, subject: 'global', count: 120 },
    { kind: COUNTER_KINDS.LOGIN_FAILURE, subject: 'ip:203.0.113.9', count: 31 },
    { kind: COUNTER_KINDS.LOGIN_FAILURE, subject: 'ip:198.51.100.1', count: 3 },
    { kind: COUNTER_KINDS.LOGIN_FAILURE, subject: 'user:u-admin', count: 16 },
    { kind: COUNTER_KINDS.LOGIN_FAILURE, subject: 'user:unknown', count: 90 },
    { kind: COUNTER_KINDS.RATE_LIMITED, subject: 'document-usuario', count: 50 },
    { kind: COUNTER_KINDS.RATE_LIMITED, subject: 'upload-ip', count: 2 }
  ], thresholds);
  assert.deepEqual(findings.map(f => `${f.type}:${f.subject}`), [
    'login-failures-total:global',
    'rate-limited:document-usuario',
    'login-failures-ip:ip:203.0.113.9',
    'login-failures-account:user:u-admin'
  ]);
});

test('monitor: falhas de login vão em lote para o banco e geram um alerta por sinal, sem o texto digitado', async () => {
  const prismaClient = fakeCounters();
  const now = new Date('2026-11-18T12:00:00Z');
  for (let i = 0; i < 31; i += 1) recordLoginFailure({ ip: '::ffff:203.0.113.9', userId: i < 16 ? 'u-admin' : null, now });
  const sent = [];
  const result = await flushAbuseEvents({ prismaClient, now, config, sendAlert: async alert => { sent.push(alert); return { sent: true }; }, logger: { warn() {} } });
  assert.equal(result.written, 4); // global, ip, user:u-admin e user:unknown
  assert.ok(prismaClient.rows.size >= 3);
  const types = sent.map(alert => alert.fingerprint).sort();
  assert.deepEqual(types, ['abuse|login-failures-account|user:u-admin', 'abuse|login-failures-ip|ip:203.0.113.9']);
  const accountAlert = sent.find(alert => alert.fingerprint.includes('account'));
  assert.match(accountAlert.subject, /conta admin/);
  assert.match(sent.find(alert => alert.fingerprint.includes('ip')).text, /IP 203\.0\.113\.9/);
  for (const alert of sent) assert.doesNotMatch(alert.text, /senha:|password/i);
});

test('monitor: contagem soma entre lotes (janela lida do banco, não da memória)', async () => {
  const prismaClient = fakeCounters();
  const now = new Date('2026-11-18T12:00:00Z');
  const sent = [];
  const sendAlert = async alert => { sent.push(alert); return { sent: true }; };
  for (let i = 0; i < 40; i += 1) recordRateLimitHit({ name: 'login-ip', now });
  await flushAbuseEvents({ prismaClient, now, config, sendAlert, logger: { warn() {} } });
  assert.equal(sent.length, 0);
  const later = new Date(now.getTime() + 6 * 60 * 1000);
  for (let i = 0; i < 10; i += 1) recordRateLimitHit({ name: 'login-ip', now: later });
  await flushAbuseEvents({ prismaClient, now: later, config, sendAlert, logger: { warn() {} } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].fingerprint, 'abuse|rate-limited|login-ip');
});

test('rate-limit: observador recebe o nome do limitador a cada 429', async () => {
  const seen = [];
  setRateLimitObserver(event => seen.push(event.name));
  try {
    const limiter = createMemoryRateLimit({ name: 'teste', windowMs: 60_000, max: 1, keyGenerator: () => 'k' });
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json() { return this; } };
    limiter({}, res, () => {});
    limiter({}, res, () => {});
    assert.equal(res.statusCode, 429);
    assert.deepEqual(seen, ['teste']);
  } finally {
    setRateLimitObserver(null);
  }
});

test('rotas caras: limite por usuário e por IP com a mesma resposta 429', () => {
  assert.throws(() => expensiveRouteLimit('inexistente'), /Categoria/);
  const [perUser, perIp] = expensiveRouteLimit('generation');
  assert.equal(expensiveRouteLimit('generation')[0], perUser, 'mesma categoria compartilha contadores');
  const max = EXPENSIVE_ROUTE_LIMITS.generation.perUser;
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  const req = { auth: { user: { id: 'gera-muito' } }, ip: '198.51.100.7' };
  let passed = 0;
  for (let i = 0; i < max + 1; i += 1) perUser(req, res, () => { passed += 1; });
  assert.equal(passed, max);
  assert.equal(res.statusCode, 429);
  assert.match(res.body.error, /Aguarde alguns minutos/);
  assert.equal(typeof perIp, 'function');
});

test('OpenAI: limite diário por usuário e teto diário de tokens no banco; alerta a partir de 80%', async () => {
  const prismaClient = fakeCounters();
  const now = new Date('2026-11-18T15:00:00Z');
  const sent = [];
  const sendAlert = async alert => { sent.push(alert); return { sent: true }; };

  await reserveOpenAiCall({ userId: 'u1', prismaClient, now, config, sendAlert });
  await reserveOpenAiCall({ userId: 'u1', prismaClient, now, config, sendAlert });
  await assert.rejects(reserveOpenAiCall({ userId: 'u1', prismaClient, now, config, sendAlert }),
    e => e.status === 429 && e.codigo === 'LIMITE_DIARIO');
  await reserveOpenAiCall({ userId: 'u2', prismaClient, now, config, sendAlert });

  await recordOpenAiTokens({ tokens: 7000, prismaClient, now, config, sendAlert, logger: { warn() {} } });
  assert.equal(sent.length, 0);
  await recordOpenAiTokens({ tokens: 1500, prismaClient, now, config, sendAlert, logger: { warn() {} } });
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /85% do teto diário/);

  await recordOpenAiTokens({ tokens: 2000, prismaClient, now, config, sendAlert, logger: { warn() {} } });
  await assert.rejects(reserveOpenAiCall({ userId: 'u3', prismaClient, now, config, sendAlert }),
    e => e.status === 429 && e.codigo === 'ORCAMENTO_DIARIO');

  const summary = await openAiUsageSummary({ prismaClient, now, config });
  assert.equal(summary.day.tokens, 10_500);
  assert.equal(summary.day.calls, 3);
  assert.equal(summary.month.tokens, 10_500);
  assert.equal(summary.day.estimatedUsd, 0.02);

  // Dia seguinte (Brasília): o teto diário zera, o mensal continua.
  const tomorrow = new Date('2026-11-19T15:00:00Z');
  await reserveOpenAiCall({ userId: 'u3', prismaClient, now: tomorrow, config, sendAlert });
  assert.equal((await openAiUsageSummary({ prismaClient, now: tomorrow, config })).month.tokens, 10_500);
});

test('status operacional: seção de abuso e problemas; sem a tabela fica UNAVAILABLE', async () => {
  const base = () => ({
    jobRun: { async findMany() { return []; } },
    dataRetentionRun: { async findFirst() { return null; } },
    reportApprovalPostProcessingJob: { async groupBy() { return []; }, async findFirst() { return null; } },
    jobLock: { async findMany() { return []; } },
    integrationSyncRun: { async findMany() { return []; } },
    accessImport: { async findFirst() { return null; } }
  });
  const statusConfig = {
    ...config,
    operationsBackupStatusFile: '',
    operationsRestoreStatusFile: '',
    operationsDeployStatusFile: '',
    operationsRequireBackupStatus: false,
    operationsRequireRestoreStatus: false,
    operationsRequireDeployStatus: false,
    operationsBackupMaxAgeHours: 24,
    operationsRestoreMaxAgeDays: 30,
    operationsAlertJobEnabled: false,
    operationsAlertWebhookUrl: '',
    operationsAlertIntervalMs: 60 * 60 * 1000,
    errorTrackingWebhookUrl: '',
    omieSyncEnabled: false,
    commercialImportToken: ''
  };

  const without = await getOperationalStatus({ prismaClient: base(), config: statusConfig });
  assert.equal(without.abuse.status, 'UNAVAILABLE');

  const counters = fakeCounters();
  const now = new Date();
  for (let i = 0; i < 35; i += 1) recordLoginFailure({ ip: '203.0.113.50', now });
  await flushAbuseEvents({ prismaClient: counters, now, config, sendAlert: async () => ({ sent: false }), logger: { warn() {} } });
  const status = await getOperationalStatus({ prismaClient: { ...base(), ...counters }, config: statusConfig, now });
  assert.equal(status.abuse.status, 'ALERT');
  assert.equal(status.abuse.loginFailures, 35);
  assert.ok(status.problems.some(problem => problem.scope === 'abuse' && problem.source === 'ip:203.0.113.50'));
  assert.equal(status.abuse.openai.day.budget, 10_000);
});

test('mensagem de abuso aponta o runbook e não traz senha', () => {
  const message = abuseAlertMessage({ type: 'login-failures-ip', subject: 'ip:203.0.113.9', count: 40, threshold: 30 }, 'IP 203.0.113.9', { windowMs: 15 * 60 * 1000, environment: 'production' });
  assert.match(message.subject, /\[filtroAPP production\] Abuso/);
  assert.match(message.text, /RUNBOOK_INCIDENTES/);
  assert.match(message.text, /últimos 15 min: 40/);
});
