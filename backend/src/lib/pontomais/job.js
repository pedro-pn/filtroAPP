import { runTrackedJob } from '../jobs/runner.js';
import prisma from '../prisma.js';
import { createPontoMaisClient, pontomaisConfigured } from './client.js';
import {
  createPontoMaisSyncService,
  PONTO_SYNC_TRIGGER,
  PontoSyncError
} from './sync.js';

const AUTOMATION_STATE_ID = 'pontomais';
const BUSINESS_TIME_ZONE = 'America/Sao_Paulo';
const DAILY_HOUR = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const JOB_LOCK_TTL_MS = 3 * 60 * 60 * 1000;
const CURRENT_DATA_REVISION = 2;

function dateFromKey(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateKey(value) {
  if (!value) return null;
  return new Date(value).toISOString().slice(0, 10);
}

function addDays(value, days) {
  return new Date(dateFromKey(value).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function minDateKey(left, right) {
  return left <= right ? left : right;
}

export function buildPontoMaisSyncWindow(startDate, targetDate) {
  const endDate = minDateKey(addDays(startDate, 30), targetDate);
  return { startDate, endDate, nextDate: addDays(endDate, 1) };
}

export function pontoMaisDailySchedule(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  const businessDate = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour);
  return {
    businessDate,
    hour,
    targetDate: addDays(businessDate, -1),
    dueByTime: hour >= DAILY_HOUR
  };
}

function safeAutomationError(error) {
  const messages = {
    PONTOMAIS_NOT_CONFIGURED: 'A integração com o Ponto Mais não está configurada.',
    PONTOMAIS_AUTH: 'O Ponto Mais recusou a credencial configurada.',
    PONTOMAIS_INVALID_RESPONSE: 'O Ponto Mais retornou dados incompatíveis com a integração.',
    PONTOMAIS_UNAVAILABLE: 'Não foi possível consultar o Ponto Mais. Os dados anteriores foram preservados.',
    SYNC_IN_PROGRESS: 'Já existe uma sincronização do Ponto Mais em andamento.'
  };
  const upstreamCodes = {
    NOT_CONFIGURED: 'PONTOMAIS_NOT_CONFIGURED',
    AUTH: 'PONTOMAIS_AUTH',
    INVALID_RESPONSE: 'PONTOMAIS_INVALID_RESPONSE',
    INVALID_REQUEST: 'PONTOMAIS_INVALID_RESPONSE',
    RATE_LIMIT: 'PONTOMAIS_UNAVAILABLE',
    UNAVAILABLE: 'PONTOMAIS_UNAVAILABLE'
  };
  const rawCode = String(error?.code || 'PONTOMAIS_UNAVAILABLE');
  const code = upstreamCodes[rawCode] || rawCode;
  if (error instanceof PontoSyncError && messages[code]) return { code, message: messages[code] };
  if (messages[code]) return { code, message: messages[code] };
  return { code: 'PONTOMAIS_UNAVAILABLE', message: messages.PONTOMAIS_UNAVAILABLE };
}

export function createPontoMaisAutomationService({
  db = prisma,
  syncService = createPontoMaisSyncService({ db }),
  clientFactory = () => createPontoMaisClient(),
  now = () => new Date()
} = {}) {
  async function ensureState() {
    return db.pontoSyncState.upsert({
      where: { id: AUTOMATION_STATE_ID },
      create: {
        id: AUTOMATION_STATE_ID,
        bootstrapStatus: 'PENDING',
        dataRevision: CURRENT_DATA_REVISION,
        targetDataRevision: null
      },
      update: {}
    });
  }

  async function updateState(data) {
    return db.pontoSyncState.update({ where: { id: AUTOMATION_STATE_ID }, data });
  }

  async function runCycle() {
    const attemptedAt = now();
    const schedule = pontoMaisDailySchedule(attemptedAt);
    let state = await ensureState();
    state = await updateState({ lastAttemptAt: attemptedAt });

    try {
      // Estados criados por versões anteriores não expõem dataRevision nos mocks.
      // No banco real a migration os marca como revisão 1, disparando um único replay.
      const storedDataRevision = state.dataRevision == null
        ? CURRENT_DATA_REVISION
        : Number(state.dataRevision);
      const targetDataRevision = state.targetDataRevision == null
        ? null
        : Number(state.targetDataRevision);
      if (storedDataRevision < CURRENT_DATA_REVISION && targetDataRevision !== CURRENT_DATA_REVISION) {
        state = await updateState({
          bootstrapStatus: 'RUNNING',
          historyThrough: null,
          nextPeriodStart: state.historyStart,
          targetDataRevision: CURRENT_DATA_REVISION,
          lastErrorCode: null,
          lastErrorMessage: null
        });
      }

      if (!state.historyStart) {
        const historyStart = await clientFactory().getHistoryStartDate();
        state = await updateState({
          bootstrapStatus: 'RUNNING',
          historyStart: dateFromKey(historyStart),
          nextPeriodStart: dateFromKey(historyStart),
          lastErrorCode: null,
          lastErrorMessage: null
        });
      }

      if (state.bootstrapStatus !== 'SUCCEEDED') {
        const bootstrapTargetDate = schedule.businessDate;
        state = await updateState({
          bootstrapStatus: 'RUNNING',
          lastErrorCode: null,
          lastErrorMessage: null
        });
        let cursor = dateKey(state.nextPeriodStart || state.historyStart);
        if (cursor > bootstrapTargetDate) {
          await updateState({
            bootstrapStatus: 'SUCCEEDED',
            nextPeriodStart: null,
            dataRevision: Math.max(
              Number(state.dataRevision) || CURRENT_DATA_REVISION,
              Number(state.targetDataRevision) || CURRENT_DATA_REVISION
            ),
            targetDataRevision: null,
            lastDailySyncDate: dateFromKey(schedule.targetDate),
            lastSuccessfulAt: now(),
            lastErrorCode: null,
            lastErrorMessage: null
          });
          return { status: 'BOOTSTRAP_COMPLETED', batches: 0, through: state.historyThrough ? dateKey(state.historyThrough) : null };
        }

        const results = [];
        while (cursor <= bootstrapTargetDate) {
          const window = buildPontoMaisSyncWindow(cursor, bootstrapTargetDate);
          const result = await syncService.runSync({
            startDate: window.startDate,
            endDate: window.endDate,
            requestedByUserId: null,
            trigger: PONTO_SYNC_TRIGGER.AUTOMATIC_BOOTSTRAP
          });
          results.push(result);
          const completed = window.nextDate > bootstrapTargetDate;
          state = await updateState({
            bootstrapStatus: completed ? 'SUCCEEDED' : 'RUNNING',
            historyThrough: dateFromKey(window.endDate),
            nextPeriodStart: completed ? null : dateFromKey(window.nextDate),
            dataRevision: completed
              ? Math.max(
                  Number(state.dataRevision) || CURRENT_DATA_REVISION,
                  Number(state.targetDataRevision) || CURRENT_DATA_REVISION
                )
              : state.dataRevision,
            targetDataRevision: completed ? null : state.targetDataRevision,
            lastDailySyncDate: completed ? dateFromKey(schedule.targetDate) : state.lastDailySyncDate,
            lastSuccessfulAt: now(),
            lastErrorCode: null,
            lastErrorMessage: null
          });
          cursor = window.nextDate;
          if (completed) {
            return { status: 'BOOTSTRAP_COMPLETED', batches: results.length, through: window.endDate, results };
          }
        }
      }

      const lastDailySyncDate = dateKey(state.lastDailySyncDate);
      if (!schedule.dueByTime || (lastDailySyncDate && lastDailySyncDate >= schedule.targetDate)) {
        return { status: 'NOT_DUE', targetDate: schedule.targetDate };
      }

      const dailyStart = addDays(schedule.targetDate, -30);
      const result = await syncService.runSync({
        startDate: dailyStart,
        endDate: schedule.targetDate,
        requestedByUserId: null,
        trigger: PONTO_SYNC_TRIGGER.AUTOMATIC_DAILY
      });
      await updateState({
        historyThrough: dateFromKey(schedule.targetDate),
        lastDailySyncDate: dateFromKey(schedule.targetDate),
        lastSuccessfulAt: now(),
        lastErrorCode: null,
        lastErrorMessage: null
      });
      return { status: 'DAILY_COMPLETED', targetDate: schedule.targetDate, result };
    } catch (error) {
      const descriptor = safeAutomationError(error);
      await updateState({
        bootstrapStatus: state.bootstrapStatus === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED',
        lastErrorCode: descriptor.code,
        lastErrorMessage: descriptor.message
      });
      throw error;
    }
  }

  return { runCycle };
}

export function startPontoMaisSyncJob({
  enabled = pontomaisConfigured(),
  intervalMs = DEFAULT_INTERVAL_MS,
  automation = createPontoMaisAutomationService(),
  runJob = runTrackedJob,
  logger = console
} = {}) {
  if (!enabled) {
    logger.warn('[pontomais-sync] PONTOMAIS_API_TOKEN ausente; job não iniciado.');
    return null;
  }

  const safeIntervalMs = Math.max(60_000, Number(intervalMs) || DEFAULT_INTERVAL_MS);
  const run = () => runJob('pontomais-sync', () => automation.runCycle(), {
    lockTtlMs: JOB_LOCK_TTL_MS,
    metadata: {
      intervalMs: safeIntervalMs,
      scheduledTime: '03:00',
      timeZone: BUSINESS_TIME_ZONE
    },
    logger
  }).catch(error => {
    logger.error(`[pontomais-sync] ${safeAutomationError(error).message}`);
  });

  const timer = setInterval(run, safeIntervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  const kickoff = setTimeout(run, 60_000);
  if (typeof kickoff.unref === 'function') kickoff.unref();
  logger.log('[pontomais-sync] carga histórica e atualização diária agendadas.');
  return { timer, kickoff, run };
}

export const PONTOMAIS_AUTOMATION = Object.freeze({
  stateId: AUTOMATION_STATE_ID,
  dataRevision: CURRENT_DATA_REVISION,
  timeZone: BUSINESS_TIME_ZONE,
  dailyHour: DAILY_HOUR,
  intervalMs: DEFAULT_INTERVAL_MS
});
